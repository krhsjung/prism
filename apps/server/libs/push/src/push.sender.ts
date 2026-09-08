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

// 토큰이 죽었다는 FCM의 표현. 그 외는 전부 일시적인 것으로 본다 —
// 확실하지 않은 실패를 '토큰이 죽었다'로 읽으면 화면이 "다시 로그인하세요"라고
// 잘못 말하게 된다.
const DEAD_TOKEN_ERRORS = ['UNREGISTERED', 'INVALID_ARGUMENT'];

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

    try {
      const { token: accessToken } = await client.getAccessToken();
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
// `{ error: { status, details: [{ errorCode }] } }`
function classify(status: number, body: JsonValue | null): PushSendOutcome {
  if (status === 404) return 'rejected';
  if (!body) return 'failed';
  try {
    const error = decodeObject(
      decodeObject(body, 'FcmError').error,
      'FcmError.error',
    );
    if (
      typeof error.status === 'string' &&
      DEAD_TOKEN_ERRORS.includes(error.status)
    ) {
      return 'rejected';
    }
    const details = Array.isArray(error.details) ? error.details : [];
    for (const detail of details) {
      const obj = decodeObject(detail, 'FcmError.detail');
      if (
        typeof obj.errorCode === 'string' &&
        DEAD_TOKEN_ERRORS.includes(obj.errorCode)
      ) {
        return 'rejected';
      }
    }
  } catch {
    // 형식이 다르면 확실하지 않은 것이다 — 토큰을 죽은 것으로 단정하지 않는다.
  }
  return 'failed';
}

async function safeBody(res: Response): Promise<JsonValue | null> {
  try {
    return await jsonBodyOf(res);
  } catch {
    return null;
  }
}
