import {
  MAX_PUSH_TOKEN_LENGTH,
  localeFrom,
  type DeviceKind,
  type PushRegistration,
} from '@app/common';
import { classifyDevice } from './device';

// 세션이 **어디서 왔는가.** 로그인 경로 여섯 개가 이 값 하나를 나른다.
//
// 원래는 `device` 하나만 흘렸는데 푸시가 붙으면서 실어야 할 것이 늘었다. 인자를 계속
// 더하면 여섯 자리에서 순서를 맞춰야 하고, 그중 하나만 빠뜨려도 조용히 기본값이 된다.
export interface SessionOrigin {
  // 이미 enum으로 접힌 값만 담는다 — UA 원문은 컨트롤러 밖으로 나가지 않는다.
  device: DeviceKind;
  // 로그인 요청이 실어 온 푸시 등록. **로그인 시점에만 들어온다**(plan/push.md §5-2) —
  // 없으면 그 세션은 재로그인 전까지 푸시 대상이 아니고, 목록에 `Notifications off`로
  // 정직하게 보인다.
  push?: PushRegistration;
}

// 요청을 알 수 없는 자리의 기본값(테스트·내부 호출).
export const ANONYMOUS_ORIGIN: SessionOrigin = { device: 'unknown' };

// 요청 하나에서 세션의 출신을 읽는다.
//
// 언어는 **`Accept-Language`가 나른다.** 계약에 필드를 더하지 않은 이유는 웹 소셜
// 로그인 때문이다 — 그 세션은 서버 콜백에서 만들어져 실을 body가 없는데, 브라우저는
// 이 헤더를 알아서 싣는다. 네이티브 앱은 앱 안에서 고른 언어를 이 헤더에 담아 보낸다.
export function originOf(
  headers: { 'user-agent'?: string; 'accept-language'?: string },
  pushToken?: string,
): SessionOrigin {
  const device = classifyDevice(headers['user-agent']);
  const token = normalizePushToken(pushToken);
  return token
    ? {
        device,
        push: { token, locale: localeFrom(headers['accept-language']) },
      }
    : { device };
}

// 토큰은 **해석하지 않고 형식만 본다** — 무엇이 유효한 등록인지는 FCM이 판단한다.
// 여기서 보는 것은 저장소에 담아도 되는 크기인가뿐이다(SDP에 상한을 두는 것과 같은 이유).
function normalizePushToken(raw?: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const token = raw.trim();
  if (!token || token.length > MAX_PUSH_TOKEN_LENGTH) return undefined;
  // 공백이 섞인 값은 FCM 토큰이 아니다 — 헤더·쿠키 조립 사고를 여기서 끊는다.
  if (/\s/.test(token)) return undefined;
  return token;
}
