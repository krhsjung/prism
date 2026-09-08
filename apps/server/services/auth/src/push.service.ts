import { Injectable } from '@nestjs/common';
import {
  SessionsRepository,
  translate,
  type Locale,
  type PushActionSet,
  type PushSendOutcome,
  type PushSendResult,
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
    locale: Locale,
  ): Promise<boolean> {
    return this.sessions.attachPushToken(userId, sessionId, { token, locale });
  }

  /**
   * 고른 세션들에 보낸다. **대상마다 결말을 따로 답한다.**
   *
   * 한 대상이 실패해도 나머지는 간다 — 요청 전체를 접으면 "하나가 방금 로그아웃해서
   * 아무에게도 안 갔다"가 된다. 그래서 남의 세션·없는 세션도 오류가 아니라 그 줄의
   * 결과(`unknown`)이고, **둘을 구별해 주지도 않는다**(존재를 떠보는 경로를 막는다).
   */
  async sendToSessions(
    userId: string,
    sessionIds: readonly string[],
    content: PushContent,
  ): Promise<PushSendOutcome[]> {
    const outcomes: PushSendOutcome[] = [];
    // **토큰 기준 중복 제거**(plan/push.md §5-5). 같은 설치가 여러 세션에 걸릴 수 있다
    // (로그아웃 후 재로그인) — 세션마다 보내면 한 기기에 알림이 두 번 뜬다.
    //
    // 여기가 그 규칙의 자리인 이유: 세션 → 토큰 지도를 아는 곳이 여기뿐이고, 화면에
    // 돌려줄 답도 **세션 단위**이기 때문이다. 전송기는 토큰 하나만 안다.
    const sentTokens = new Set<string>();

    for (const sessionId of sessionIds) {
      const lookup = await this.sessions.pushTargetFor(userId, sessionId);
      if (lookup.kind === 'not-owned') {
        outcomes.push({ sessionId, result: 'unknown' });
        continue;
      }
      if (lookup.kind === 'no-token') {
        outcomes.push({ sessionId, result: 'no-token' });
        continue;
      }
      if (sentTokens.has(lookup.target.token)) {
        // 실패가 아니라 "한 번만 보냈다"는 사실이다 — 화면이 "셋을 골랐는데 알림이
        // 둘"을 설명할 수 있어야 한다.
        outcomes.push({ sessionId, result: 'duplicate' });
        continue;
      }
      sentTokens.add(lookup.target.token);
      outcomes.push({
        sessionId,
        result: await this.sendOne(lookup.target, content),
      });
    }
    return outcomes;
  }

  private async sendOne(
    target: { token: string; locale: Parameters<typeof translate>[0] },
    content: PushContent,
  ): Promise<PushSendResult> {
    // 제목을 적어 보냈으면 **그대로 간다**. 사람이 적은 글자는 번역할 수 없고, 본문이
    // 이미 같은 성질이다. 비워 두면 서버가 받는 기기의 언어로 그린다 — 그 언어는
    // 세션에 담아 둔 값에서 온다(plan/push.md §5-7).
    const outcome = await this.sender.send(
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
      content.link ?? `${this.config.webAppUrl}/push`,
    );
    // FCM의 일시적 실패는 계약의 결과가 아니다 — 사용자가 할 일은 다시 눌러 보는
    // 것뿐이라 "토큰이 죽었다"와 갈라 말할 이유가 없다. 그 줄만 `rejected`로 접는
    // 대신 호출부가 502로 답할 수 있게 그대로 올린다.
    if (outcome === 'failed') throw new PushUnavailableError();
    return outcome;
  }
}

/** FCM이 지금 안 된다. 계약의 결과가 아니라 오류다 — 호출부가 502로 접는다. */
export class PushUnavailableError extends Error {}
