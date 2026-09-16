import { Injectable, Logger } from '@nestjs/common';
import {
  SessionsRepository,
  translate,
  type Locale,
  type PushActionSet,
  type PushSendOutcome,
  type PushSendResult,
  type PushTarget,
} from '@app/common';
import { PrismConfigService } from '@app/config';
import { PushSender } from '@app/push';

// 사람이 채워 보내는 알림의 내용. 문구 외에는 **전부 선택이다**.
export interface PushContent {
  message: string;
  title?: string;
  imageUrl?: string;
  link?: string;
  actions: PushActionSet;
}

// 푸시 화면이 보내는 알림.
//
// **클라이언트는 "이 세션들에 보내줘"라고만 한다** — 토큰은 서버가 레코드에서 꺼낸다
// (plan/push.md §5-3). 목록에 토큰이 실리지 않으므로 클라이언트가 그것으로 할 수 있는
// 일도 없다(전송에는 서버 자격증명이 필요하다).
@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(
    private readonly sessions: SessionsRepository,
    private readonly sender: PushSender,
    private readonly config: PrismConfigService,
  ) {}

  /**
   * 지금 세션에 등록 토큰을 붙인다(푸시 화면의 `알림 켜기`).
   *
   * 저장소를 이미 들고 있는 쪽에 둔다 — 컨트롤러가 저장소를 직접 알 이유가 없다.
   * 소유권 확인과 수명 보존은 저장소가 한다(plan/push.md §5-2).
   */
  async registerToken(
    userId: string,
    sessionId: string,
    token: string,
  ): Promise<boolean> {
    return this.sessions.attachPushToken(userId, sessionId, token);
  }

  /**
   * 이 세션을 푸시 대상에서 뺀다(푸시 화면의 `알림 끄기`).
   *
   * 브라우저·OS 권한은 앱이 끌 수 없다 — 끄는 것은 등록뿐이다(§5-15).
   */
  async unregisterToken(userId: string, sessionId: string): Promise<boolean> {
    return this.sessions.clearPushToken(userId, sessionId);
  }

  /**
   * 고른 세션들에 보낸다. **대상마다 결말을 따로 답한다.**
   *
   * 한 대상이 실패해도 나머지는 간다 — 요청 전체를 접으면 "하나가 방금 로그아웃해서
   * 아무에게도 안 갔다"가 된다. 그래서 남의 세션·없는 세션도 오류가 아니라 그 줄의
   * 결과(`unknown`)이고, **둘을 구별해 주지도 않는다**(존재를 떠보는 경로를 막는다).
   * FCM의 일시적 실패도 같은 규칙이다 — 그 줄만 `failed`이고, 이미 접수된 나머지의
   * 결과는 그대로 돌아간다. 요청 전체가 오류인 것은 전송기가 아예 없을 때뿐이다.
   *
   * **대상을 전부 해석한 뒤 한꺼번에 보낸다.** 하나씩 기다리면 대상 수만큼 FCM 왕복이
   * 이어져(하나에 최대 FCM 타임아웃) 클라이언트의 요청 타임아웃을 쉽게 넘긴다. 동시
   * 전송의 상한은 요청의 대상 상한(MAX_PUSH_TARGETS)이 곧 그것이다.
   */
  async sendToSessions(
    userId: string,
    sessionIds: readonly string[],
    content: PushContent,
  ): Promise<PushSendOutcome[]> {
    // 전송기가 없으면 어느 대상에도 갈 수 없다 — 대상별 `failed` 스무 줄이 아니라
    // 요청 하나의 오류다(호출부가 502로 접는다).
    if (!this.sender.enabled) throw new PushUnavailableError();

    const lookups = await Promise.all(
      sessionIds.map((sessionId) =>
        this.sessions.pushTargetFor(userId, sessionId),
      ),
    );

    // **토큰 기준 중복 제거**(plan/push.md §5-5). 같은 설치가 여러 세션에 걸릴 수 있다
    // (로그아웃 후 재로그인) — 세션마다 보내면 한 기기에 알림이 두 번 뜬다.
    //
    // 여기가 그 규칙의 자리인 이유: 세션 → 토큰 지도를 아는 곳이 여기뿐이고, 화면에
    // 돌려줄 답도 **세션 단위**이기 때문이다. 전송기는 토큰 하나만 안다.
    const byToken = new Map<
      string,
      { target: PushTarget; sessionIds: string[] }
    >();
    for (const [i, lookup] of lookups.entries()) {
      if (lookup.kind !== 'ok') continue;
      const sessionId = sessionIds[i] as string;
      const entry = byToken.get(lookup.target.token);
      if (entry) entry.sessionIds.push(sessionId);
      else
        byToken.set(lookup.target.token, {
          target: lookup.target,
          sessionIds: [sessionId],
        });
    }

    const sent = new Map<string, PushSendResult>();
    await Promise.all(
      [...byToken.values()].map(async ({ target, sessionIds: owners }) => {
        const result = await this.sendOne(target, content);
        sent.set(target.token, result);
        // 죽은 토큰은 세션에서 뗀다 — 두면 목록이 계속 `Will notify`를 그리고 다음
        // 발송도 같은 토큰을 겨눈다. 같은 토큰을 가진 세션 전부가 대상이다.
        //
        // **떼기의 실패는 결과를 지우지 않는다.** 여기서 새면 요청 전체가 500이 되어 이미
        // 접수된 대상의 결과까지 잃고, 다시 누르면 그쪽에 알림이 두 번 간다. 못 뗀
        // 토큰은 다음 거부에서 다시 시도된다.
        if (result === 'rejected') {
          await Promise.all(
            owners.map(async (sessionId) => {
              try {
                await this.sessions.clearPushTokenIfMatches(
                  userId,
                  sessionId,
                  target.token,
                );
              } catch (error) {
                this.logger.warn(
                  `failed to clear rejected token: ${String(error)}`,
                );
              }
            }),
          );
        }
      }),
    );

    // 답은 **요청의 순서대로** 세션 단위로 돌아간다 — 화면이 고른 줄 옆에 그대로 그린다.
    const seen = new Set<string>();
    return lookups.map((lookup, i) => {
      const sessionId = sessionIds[i] as string;
      if (lookup.kind === 'not-owned') return { sessionId, result: 'unknown' };
      if (lookup.kind === 'no-token') return { sessionId, result: 'no-token' };
      const result = sent.get(lookup.target.token) ?? 'failed';
      // 같은 토큰의 두 번째 세션. 첫 시도가 접수됐을 때만 `duplicate`다 — "다른 세션이
      // 이미 받았다"는 뜻이라, 거부·실패였다면 아무도 받지 않았으므로 그 결과가 간다.
      const first = !seen.has(lookup.target.token);
      seen.add(lookup.target.token);
      return {
        sessionId,
        result: first || result !== 'accepted' ? result : 'duplicate',
      };
    });
  }

  private sendOne(
    target: { token: string; locale: Locale },
    content: PushContent,
  ): Promise<PushSendResult> {
    // 제목을 적어 보냈으면 **그대로 간다**. 사람이 적은 글자는 번역할 수 없고, 본문이
    // 이미 같은 성질이다. 비워 두면 서버가 받는 기기의 언어로 그린다 — 그 언어는
    // 세션에 담아 둔 값에서 온다(plan/push.md §5-7).
    return this.sender.send(
      target.token,
      {
        title: content.title ?? translate(target.locale, 'push.demo_title'),
        body: content.message,
      },
      {
        kind: 'demo',
        imageUrl: content.imageUrl,
        link: content.link,
        actions: content.actions,
      },
      content.link ?? this.demoLink(),
    );
  }

  /** 링크 없는 데모 알림을 웹이 눌렀을 때 열 곳. 요청 검증도 같은 값으로 크기를 잰다. */
  demoLink(): string {
    return `${this.config.webAppUrl}/push`;
  }
}

/** 전송기가 이 배포에 없다(자격증명 미설정). 계약의 결과가 아니라 오류다 — 호출부가 502로 접는다. */
export class PushUnavailableError extends Error {}
