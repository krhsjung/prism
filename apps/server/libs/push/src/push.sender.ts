import { Injectable, Logger } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import {
  decodeObject,
  fetchWithTimeout,
  jsonBodyOf,
  type JsonValue,
} from '@app/common';
import { PrismConfigService } from '@app/config';
import {
  buildFcmMessage,
  type PushPayload,
  type PushText,
} from './fcm-message';

// 전송의 결말. **FCM이 알려 주는 것은 "받아들였다"까지다** — 기기에 떴는지, 사람이
// 봤는지는 알 수 없다(plan/push.md §7).
//
//  - accepted: FCM이 접수했다
//  - rejected: 그 토큰이 죽었다(재설치·데이터 삭제로 회전됐다). **다시 보내도 소용없다**
//  - failed:   우리 쪽이나 FCM 쪽의 일시적 문제(5xx·타임아웃·할당량·설정 없음)
export type PushSendOutcome = 'accepted' | 'rejected' | 'failed';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// 전송 하나의 상한 — **자격증명 교환부터 FCM 응답까지** 한 시계로 잰다. 클라이언트는
// 발송 요청을 10초 안에 기다린다 — 그 안에 답이 돌아가려면 이쪽은 그보다 짧게 잘라야
// 한다(대상이 여럿이어도 동시에 보내므로 요청 전체가 이 값 안에 끝난다). FCM 왕복만
// 재면 액세스 토큰 교환이 느린 날 그 시간이 밖으로 샌다. 통화 알림은 답을 기다리지
// 않아 이 값과 무관하다.
const FCM_TIMEOUT_MS = 8_000;

// FCM v1 오류 본문의 `details[]`가 자기 종류를 밝히는 값. **종류를 보고 나서 필드를
// 읽는다** — 다른 종류의 detail에 우연히 같은 이름의 필드가 있어도 토큰의 문제로 읽지 않는다.
const FCM_ERROR_TYPE = 'type.googleapis.com/google.firebase.fcm.v1.FcmError';
const BAD_REQUEST_TYPE = 'type.googleapis.com/google.rpc.BadRequest';

// FCM v1 오류 본문의 `details[]`에 실리는 FCM 고유 오류(`FcmError.errorCode`) 중,
// **그 토큰으로는 다시 보내도 소용없는** 것들.
//
//  - UNREGISTERED:       앱 인스턴스가 등록을 해지했다(재설치·데이터 삭제·토큰 회전)
//  - SENDER_ID_MISMATCH: 다른 Firebase 프로젝트의 토큰이다 — 우리 자격증명으로는 영영 안 간다
//
// `INVALID_ARGUMENT`는 **여기 없다.** FCM은 같은 코드를 잘못된 페이로드 필드·크기
// 초과·TTL 문제에도 쓴다 — 우리 실수를 "토큰이 죽었다"로 읽으면 산 토큰을 세션에서
// 떼어 낸다(rejected는 저장소의 토큰을 지운다). 토큰 자리를 지목한 BadRequest가 함께
// 실렸을 때만 죽은 토큰으로 본다(아래 classify).
const DEAD_TOKEN_CODES = ['UNREGISTERED', 'SENDER_ID_MISMATCH'];
// 요청의 어느 필드가 틀렸는지 알려 주는 표준 detail(`google.rpc.BadRequest`)에서,
// 토큰이 틀렸다는 표현. FCM은 `message.token`으로 지목한다.
const TOKEN_FIELD = 'message.token';

@Injectable()
export class PushSender {
  private readonly logger = new Logger(PushSender.name);
  // 자격증명이 없으면 null이고 모든 전송이 즉시 'failed'다 — 키 없는 로컬·CI에서도
  // 서버는 뜬다(소셜 provider를 설정하지 않아도 데모 로그인이 도는 것과 같은 규칙).
  private readonly client: JWT | null;
  private readonly projectId: string;

  constructor(private readonly config: PrismConfigService) {
    const fcm = config.fcmConfig;
    this.projectId = fcm?.projectId ?? '';
    // 액세스 토큰의 서명·교환·캐시·갱신을 이 클라이언트가 맡는다. 손으로 쓰면
    // 시계 오차와 만료 순간의 동시 갱신을 우리가 다시 다루게 된다(plan/push.md D3).
    this.client = fcm
      ? new JWT({
          email: fcm.clientEmail,
          key: fcm.privateKey,
          scopes: [FCM_SCOPE],
        })
      : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  // 한 기기에 보낸다.
  //
  // **절대 던지지 않는다.** 푸시 실패가 통화나 HTTP 요청을 무너뜨리면 안 된다 —
  // 통화 쪽은 결말이 어차피 `Call expired`로 같고(plan/webrtc.md §8-10), 화면 쪽은
  // 결과 한 줄로 사실만 말한다.
  async send(
    token: string,
    text: PushText,
    payload: PushPayload,
    webLink: string,
  ): Promise<PushSendOutcome> {
    const client = this.client;
    if (!client) return 'failed';

    const deadline = Date.now() + FCM_TIMEOUT_MS;
    try {
      const { token: accessToken } = await withDeadline(
        client.getAccessToken(),
        deadline,
      );
      if (!accessToken) {
        this.logger.warn('fcm access token unavailable');
        return 'failed';
      }
      const res = await fetchWithTimeout(
        `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(buildFcmMessage(token, text, payload, webLink)),
        },
        // 남은 시간만 준다 — 교환이 오래 걸렸으면 그만큼 짧게.
        Math.max(1, deadline - Date.now()),
      );
      if (res.ok) return 'accepted';

      const outcome = classify(res.status, await safeBody(res));
      // **오류 본문을 그대로 남기지 않는다** — 등록 토큰이 섞여 나올 수 있고,
      // 로그는 세션보다 오래 산다. 남기는 것은 갈래와 상태 코드뿐이다.
      this.logger.warn(`fcm send ${outcome} (${res.status})`);
      return outcome;
    } catch {
      // 타임아웃·네트워크·자격증명 교환 실패. 사유를 로그에 싣지 않는 이유는 위와 같다.
      this.logger.warn('fcm send failed');
      return 'failed';
    }
  }
}

// FCM v1의 오류 본문에서 갈래만 읽는다.
// `{ error: { status, details: [{ errorCode } | { fieldViolations: [{ field }] }] } }`
//
// **확실할 때만 rejected다.** 이 값은 저장소의 토큰을 지우게 하므로, 모르는 형식·
// 애매한 코드는 전부 `failed`로 접는다 — 산 토큰을 잘못 지우는 것이 죽은 토큰을 한 번
// 더 겨누는 것보다 비싸다(사용자가 껐다 켜야 돌아온다). 404라는 상태 코드만으로도
// 판단하지 않는다: 프로젝트 경로가 틀린 배포에서는 모든 전송이 404라, 그것을 거부로
// 읽으면 첫 발송이 등록된 토큰을 전부 지운다.
function classify(_status: number, body: JsonValue | null): PushSendOutcome {
  if (!body) return 'failed';
  try {
    const error = decodeObject(
      decodeObject(body, 'FcmError').error,
      'FcmError.error',
    );
    const details = (Array.isArray(error.details) ? error.details : []).map(
      (detail) => decodeObject(detail, 'FcmError.detail'),
    );
    const codes = details
      .filter((detail) => detail['@type'] === FCM_ERROR_TYPE)
      .map((detail) => detail.errorCode)
      .filter((code): code is string => typeof code === 'string');
    if (codes.some((code) => DEAD_TOKEN_CODES.includes(code)))
      return 'rejected';

    // INVALID_ARGUMENT는 토큰 자리를 지목했을 때만 토큰의 문제다.
    const invalidArgument =
      error.status === 'INVALID_ARGUMENT' || codes.includes('INVALID_ARGUMENT');
    const blamesToken = details.some(
      (detail) =>
        detail['@type'] === BAD_REQUEST_TYPE &&
        Array.isArray(detail.fieldViolations) &&
        detail.fieldViolations.some(
          (violation) =>
            decodeObject(violation, 'BadRequest.fieldViolation').field ===
            TOKEN_FIELD,
        ),
    );
    if (invalidArgument && blamesToken) return 'rejected';
  } catch {
    // 형식이 다르면 확실하지 않은 것이다 — 토큰을 죽은 것으로 단정하지 않는다.
  }
  return 'failed';
}

// 일을 마감 시각까지만 기다린다. 넘기면 던진다 — 부르는 쪽이 `failed`로 접는다.
// 타이머는 일이 먼저 끝나면 바로 푼다(프로세스를 붙들지 않게 unref도 건다).
function withDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(new Error('deadline exceeded'));
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('deadline exceeded')), left);
    timer.unref?.();
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

async function safeBody(res: Response): Promise<JsonValue | null> {
  try {
    return await jsonBodyOf(res);
  } catch {
    return null;
  }
}
