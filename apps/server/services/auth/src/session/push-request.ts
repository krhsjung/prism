import { HttpException } from '@nestjs/common';
import {
  AUTH_ERROR_CODES,
  type JsonValue,
  MAX_PUSH_MESSAGE_LENGTH,
  MAX_PUSH_TARGETS,
  MAX_PUSH_URL_LENGTH,
  PUSH_ACTION_SETS,
  type PushActionSet,
} from '@app/common';

/** 요청 body의 날것. 아래 디코더를 지나기 전까지는 아무것도 믿지 않는다. */
export interface PushSendBody {
  sessionIds?: JsonValue;
  message?: JsonValue;
  imageUrl?: JsonValue;
  link?: JsonValue;
  actions?: JsonValue;
}

export interface PushRequest {
  sessionIds: string[];
  message: string;
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
export function decodePushRequest(body: PushSendBody): PushRequest {
  const message = str(body.message).trim();
  if (!message || message.length > MAX_PUSH_MESSAGE_LENGTH) reject();

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
  return {
    sessionIds: unique,
    message,
    ...optionalUrl('imageUrl', body.imageUrl),
    ...optionalUrl('link', body.link),
    actions,
  };
}

function optionalUrl(key: 'imageUrl' | 'link', value?: JsonValue) {
  const raw = str(value).trim();
  if (!raw) return {};
  if (raw.length > MAX_PUSH_URL_LENGTH) reject();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return reject();
  }
  if (parsed.protocol !== 'https:') reject();
  return { [key]: raw };
}

const str = (v?: JsonValue): string => (typeof v === 'string' ? v : '');

function reject(): never {
  throw new HttpException({ error: AUTH_ERROR_CODES.INVALID_TOKEN }, 400);
}
