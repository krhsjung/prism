import { HttpException } from '@nestjs/common';
import { deliveredBytes } from '@app/push';
import {
  AUTH_ERROR_CODES,
  type JsonValue,
  MAX_PUSH_CONTENT_BYTES,
  MAX_PUSH_MESSAGE_LENGTH,
  MAX_PUSH_TITLE_LENGTH,
  MAX_PUSH_TARGETS,
  MAX_PUSH_URL_LENGTH,
  PUSH_ACTION_SETS,
  type PushActionSet,
} from '@app/common';

/** 요청 body의 날것. 아래 디코더를 지나기 전까지는 아무것도 믿지 않는다. */
export interface PushSendBody {
  sessionIds?: JsonValue;
  message?: JsonValue;
  title?: JsonValue;
  imageUrl?: JsonValue;
  link?: JsonValue;
  actions?: JsonValue;
}

export interface PushRequest {
  sessionIds: string[];
  message: string;
  title?: string;
  imageUrl?: string;
  link?: string;
  actions: PushActionSet;
}

/**
 * 경계에서 파싱·검증한다(parse, don't validate) — 지나온 값은 형식이 맞다.
 *
 * 주소 둘은 **https만** 받는다. 서버가 가져오지 않으므로(이미지는 FCM이, 링크는 기기가
 * 연다) SSRF 문제는 아니지만, `javascript:` 같은 스킴이 기기에서 열리는 길을 열지
 * 않는다. 알림을 여는 것은 사람이고, 사람은 주소를 보지 않는다.
 */
export function decodePushRequest(
  body: PushSendBody,
  // 링크가 없을 때 웹이 열 기본 주소 — 보내는 쪽(`PushNotificationService.demoLink`)과 같은
  // 값이어야 크기 검증이 실제 전송과 같은 것을 잰다.
  defaultLink: string,
): PushRequest {
  const message = str(body.message).trim();
  if (!message || message.length > MAX_PUSH_MESSAGE_LENGTH) reject();

  // 제목은 선택이다 — 비면 서버가 받는 기기의 언어로 그린다. 빈 문자열과 미지정을
  // 가르지 않는다: 둘 다 "안 적었다"이고, 화면에서도 같은 상태다.
  const title = str(body.title).trim();
  if (title.length > MAX_PUSH_TITLE_LENGTH) reject();

  const sessionIds = Array.isArray(body.sessionIds)
    ? body.sessionIds.filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      )
    : [];
  // 중복은 여기서 접는다 — 같은 세션을 두 번 고를 수 있는 화면은 없지만, 그것이
  // 요청까지 오면 대상별 결과가 두 줄이 되어 화면이 같은 줄을 두 번 그린다.
  const unique = [...new Set(sessionIds)];
  if (unique.length === 0 || unique.length > MAX_PUSH_TARGETS) reject();

  const actions = PUSH_ACTION_SETS.find((a) => a === body.actions) ?? 'none';
  const request: PushRequest = {
    sessionIds: unique,
    message,
    ...(title ? { title } : {}),
    ...optionalUrl('imageUrl', body.imageUrl),
    ...optionalUrl('link', body.link),
    actions,
  };
  // 필드마다는 상한 안이어도 **합**이 FCM의 4 KB를 넘길 수 있다 — 그 요청은 대상마다
  // `failed`가 되고 다시 눌러도 낫지 않으므로, 여기서 400으로 접는다.
  const bytes = [request.message, request.title, request.imageUrl, request.link]
    .filter((value): value is string => value !== undefined)
    .reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0);
  if (bytes > MAX_PUSH_CONTENT_BYTES) reject();
  // 바이트 합이 상한 안이어도 **직렬화하면** 넘칠 수 있다 — JSON 이스케이프(따옴표·백슬래시·
  // 제어 문자)가 글자마다 바이트를 더하고, 문구는 data와 플랫폼 블록에 여러 번 실린다.
  // 보내는 쪽과 **같은 재료**로 지어 기기 하나가 받는 몫을 잰다(`deliveredBytes`): 기본 주소는
  // 실제 배포의 것이고(견본을 재면 짧아 통과시킨다), 제목이 비면 서버가 그릴 기본 제목 대신
  // 상한만큼의 글자를 넣어 보수적으로 잰다.
  const delivered = deliveredBytes(
    {
      title: request.title ?? 'x'.repeat(MAX_PUSH_TITLE_LENGTH),
      body: request.message,
    },
    {
      kind: 'demo',
      imageUrl: request.imageUrl,
      link: request.link,
      actions: request.actions,
    },
    request.link ?? defaultLink,
  );
  if (delivered > MAX_FCM_MESSAGE_BYTES - FCM_HEADROOM) reject();
  return request;
}

// FCM/APNs가 기기 하나에 전하는 payload의 상한과, 계산에 넣지 않은 것(전송 시 붙는 몇
// 바이트)을 위한 여유.
const MAX_FCM_MESSAGE_BYTES = 4096;
const FCM_HEADROOM = 128;

function str(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

// https 주소만 받는다. 비었으면(미지정·빈 문자열) 키 자체를 만들지 않는다.
function optionalUrl(
  key: 'imageUrl' | 'link',
  value: JsonValue | undefined,
): { imageUrl?: string; link?: string } {
  const raw = str(value).trim();
  if (!raw) return {};
  if (raw.length > MAX_PUSH_URL_LENGTH) reject();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    reject();
  }
  if (url.protocol !== 'https:') reject();
  return { [key]: raw };
}

function reject(): never {
  throw new HttpException(
    { error: AUTH_ERROR_CODES.INVALID_PUSH_REQUEST },
    400,
  );
}
