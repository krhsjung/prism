import type { CookieOptions, Request } from 'express';
import { OAUTH_STATE_TTL_MS } from './auth-token.service';

// auth 서비스가 브라우저에 심는 쿠키 전부와, 그 이름/속성 정책을 여기서 소유한다.
//
// 정책의 핵심은 운영에서 모든 쿠키에 __Host- 접두어를 붙이는 것이다. 우리 도메인의
// 등록 가능 도메인(asuscomm.com)이 Public Suffix List에 없어 다른 사람들의
// *.asuscomm.com 호스트가 전부 우리와 same-site다 — 접두어가 없으면 그들이
// Domain=asuscomm.com으로 같은 이름의 쿠키를 심어 우리 요청에 실어 보낼 수 있다.

// ──────────────── 수명 정책 ────────────────
//
// 세 값이 서로 다른 일을 한다:
//  - 액세스 토큰(짧게): 탈취돼도 오래 못 쓴다. 만료되면 리프레시로 조용히 갱신된다
//  - idle: 활동이 없으면 끊는다. 리프레시할 때마다 다시 채워진다(sliding)
//  - absolute: 아무리 활동해도 여기서는 끝난다. 리프레시 무한 연장을 막는 상한
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const SESSION_IDLE_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 웹 세션 쿠키 — 액세스 토큰을 HttpOnly로 담아 브라우저 JS가 만질 수 없게 한다.
// (네이티브는 쿠키 저장소가 부자연스러워 Authorization: Bearer를 계속 쓴다)
const SESSION_COOKIE_BASE = 'prism_session';

// 리프레시 자격증명 쿠키. 액세스 토큰과 분리하는 이유는 역할이 다르기 때문이다 —
// 액세스는 매 요청 실리고, 리프레시는 갱신할 때만 쓰인다.
const REFRESH_COOKIE_BASE = 'prism_refresh';

// __Host- 접두어는 "Secure + Path=/ + Domain 없음"을 브라우저가 강제하게 만든다.
// 이름만 같고 Domain이 다른 쿠키를 형제 서브도메인이 심어 덮어쓰는 것(cookie tossing)이
// 불가능해진다 — 접두어가 없으면 두 쿠키가 함께 실려 어느 쪽이 읽힐지 순서에 좌우된다.
// 로컬(http)은 Secure 쿠키가 저장되지 않아 접두어를 쓸 수 없다.
export function sessionCookieName(isProduction: boolean): string {
  return isProduction ? `__Host-${SESSION_COOKIE_BASE}` : SESSION_COOKIE_BASE;
}

export function refreshCookieName(isProduction: boolean): string {
  return isProduction ? `__Host-${REFRESH_COOKIE_BASE}` : REFRESH_COOKIE_BASE;
}

// SameSite=Lax: 교차 사이트 POST(CSRF)에는 실리지 않고, 최상위 GET 이동에는 실린다.
// OAuth 복귀는 최상위 GET이라 Lax로 충분하며, 별도 CSRF 토큰 없이 쿠키 전환이 가능하다.
// (Apple form_post는 교차 사이트 POST지만 쿠키를 *심는* 것은 SameSite와 무관하고,
//  이어지는 웹 복귀가 최상위 GET이라 그때 정상 전송된다)
export function sessionCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: isProduction, // 로컬 http에서는 Secure 쿠키가 저장되지 않는다
    // 쿠키는 액세스 토큰보다 오래 남겨둔다 — 만료된 토큰이라도 실려 와야
    // 서버가 "누구의 세션인지" 알고 리프레시를 안내할 수 있다.
    maxAge: SESSION_IDLE_TTL_MS,
  };
}

// 리프레시 쿠키는 세션 쿠키와 같은 정책을 쓰되 수명이 idle 만료와 같다.
// (Path를 /auth/refresh로 좁히고 싶지만 __Host-가 Path=/를 강제한다 —
//  접두어가 주는 cookie tossing 방어가 경로 축소보다 가치 있다고 판단했다)
export function refreshCookieOptions(isProduction: boolean): CookieOptions {
  return sessionCookieOptions(isProduction);
}

// ──────────────── OAuth 흐름 nonce 쿠키 ────────────────

// OAuth 시작 시 발급하는 브라우저 nonce 쿠키 — 서명된 state와 짝을 이뤄
// "이 브라우저가 시작한 흐름인가"를 확인한다(login-CSRF 방어).
// 흐름마다 독립 쿠키를 써서 병행 탭·동시 콜백이 서로를 간섭하지 않는다.
const OAUTH_COOKIE_BASE = 'prism_oauth_';

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
  isProduction: boolean,
): string {
  const name = `${OAUTH_COOKIE_BASE}${nonce}`;
  return isProduction ? `__Host-${name}` : name;
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

// ──────────────── 공통 ────────────────

// 요청의 Cookie 헤더에서 값 하나를 꺼낸다(필요한 게 이것뿐이라 cookie-parser 미도입).
//
// 값은 클라이언트가 마음대로 보낼 수 있다. `%zz` 같은 깨진 퍼센트 인코딩이 오면
// decodeURIComponent가 던지는데, 그대로 두면 인증 실패가 아니라 500이 된다.
// 읽을 수 없는 쿠키는 "없는 쿠키"로 다룬다.
export function cookieOf(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// 요청에서 세션 토큰을 찾는다 — Bearer(네이티브) 우선, 없으면 쿠키(웹).
//
// Bearer가 먼저인 이유는 **명시성**이다. Authorization 헤더는 클라이언트가 의도적으로
// 붙인 자격증명이고, 쿠키는 브라우저가 자동으로 싣는 ambient 값이다. 쿠키를 먼저 보면
// 남아 있던 오래된 쿠키 하나가 유효한 Bearer를 가려 401을 만든다.
// (브라우저는 Authorization을 ambient하게 붙일 수 없어 CSRF 관점에서도 이쪽이 안전하다)
//
// 운영에서는 __Host- 이름만 인정한다. 접두어 없는 동명 쿠키까지 받아주면 형제 서브도메인이
// 심은 쿠키가 그대로 통과해 접두어를 쓰는 의미가 사라진다.
export function sessionTokenOf(
  req: Request,
  isProduction: boolean,
): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return cookieOf(req, sessionCookieName(isProduction)) ?? null;
}
