import type { CookieOptions } from 'express';
import { namespacedCookieName, type CookiePolicy } from '@app/session';
import { OAUTH_STATE_TTL_MS } from '../session/auth-token.service';

// OAuth 흐름 nonce 쿠키 — auth 서비스에만 있는 개념이라 공유 라이브러리에 두지 않는다.
// (세션 쿠키는 모든 서비스가 읽으므로 @app/session에 있다)

// OAuth 시작 시 발급하는 브라우저 nonce 쿠키 — 서명된 state와 짝을 이뤄
// "이 브라우저가 시작한 흐름인가"를 확인한다(login-CSRF 방어).
// 흐름마다 독립 쿠키를 써서 병행 탭·동시 콜백이 서로를 간섭하지 않는다.
//
// 세션 쿠키와 같은 이유로 운영에서는 __Host- 접두어가 **필수**다.
// 이게 없으면 형제 호스트가 자기가 시작한 흐름의 nonce로 쿠키를 심어
// "피해자가 시작한 흐름"인 척할 수 있고, 그러면 세션 쿠키를 __Host-로 바꿔도
// login-CSRF가 이 경로로 그대로 되살아난다.
//
// 값(현재 '1')을 state에 바인딩하는 것으로는 막을 수 없다 — 공격자는 자기가 시작한
// 흐름의 정상적인 (state, 값) 쌍을 알고 있어 짝이 맞는 값을 심으면 그만이다.
// 심는 것 자체를 불가능하게 만드는 접두어만이 유효한 방어다.
export function oauthNonceCookieName(
  nonce: string,
  policy: CookiePolicy,
): string {
  return namespacedCookieName(`oauth_${nonce}`, policy);
}

// __Host- 요건이 Path=/를 강제하므로 운영에서는 Path=/auth를 쓸 수 없다.
// Apple form_post 콜백은 교차 사이트 POST라 SameSite=None이 필요한데, None은 Secure를
// 요구하고 __Host-도 Secure를 요구하므로 셋이 함께 성립한다.
// 로컬(http)은 Secure 쿠키가 저장되지 않아 접두어 없이 Lax + Path=/auth를 유지한다.
export function oauthNonceCookieOptions(isProduction: boolean): CookieOptions {
  const base: CookieOptions = { httpOnly: true, maxAge: OAUTH_STATE_TTL_MS };
  return isProduction
    ? { ...base, path: '/', secure: true, sameSite: 'none' }
    : { ...base, path: '/auth', sameSite: 'lax' };
}
