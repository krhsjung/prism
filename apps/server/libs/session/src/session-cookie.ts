import type { CookieOptions, Request } from 'express';
import type { CookiePolicy } from '@app/config';

export type { CookiePolicy };

// 브라우저에 심는 쿠키의 이름/속성 정책을 여기서 소유한다.
//
// 정책의 핵심은 운영에서 모든 쿠키에 __Host- 접두어를 붙이는 것이다. 우리 도메인의
// 등록 가능 도메인(asuscomm.com)이 Public Suffix List에 없어 다른 사람들의
// *.asuscomm.com 호스트가 전부 우리와 same-site다 — 접두어가 없으면 그들이
// Domain=asuscomm.com으로 같은 이름의 쿠키를 심어 우리 요청에 실어 보낼 수 있다.
//
// auth 서비스와 API 서비스가 **같은 세션 쿠키를 읽는다.** 그래서 이름 규칙이
// 서비스별 코드가 아니라 공유 라이브러리에 있어야 한다 — 한쪽만 바뀌면 심는 이름과
// 읽는 이름이 갈려 인증이 조용히 깨진다.

// ──────────────── 수명 정책 ────────────────
//
// 세 값이 서로 다른 일을 한다:
//  - 액세스 토큰(짧게): 탈취돼도 오래 못 쓴다. 만료되면 리프레시로 조용히 갱신된다
//    → PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN (PrismConfigService.accessTokenTtlMs)
//  - idle: 활동이 없으면 끊는다. 리프레시할 때마다 다시 채워진다(sliding)
//    → PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN (PrismConfigService.refreshTokenTtlMs)
//  - absolute: 아무리 활동해도 여기서는 끝난다. 리프레시 무한 연장을 막는 상한
//
// 앞의 둘만 env로 연다. absolute를 열면 "무한에 가까운 세션"을 설정 한 줄로 만들 수 있고,
// 그건 배포 환경이 정할 문제가 아니라 이 서비스의 정책이다.
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ──────────────── 이름 규칙 ────────────────

// 이름 규칙의 입력은 CookiePolicy(@app/config) 하나뿐이다 — isProduction과 namespace가
// 따로 다니면 한쪽만 갱신된 호출부가 생기고, 그 순간 심는 이름과 읽는 이름이 갈린다.
//
// namespace는 같은 호스트에 앱이 둘 이상 올라갈 때 서로의 세션을 덮지 않게 이름을 가른다.
// __Host-는 호스트 단위 격리까지만 해주기 때문이다(Domain 금지 + Path=/) —
// 호스트가 갈리면 그것으로 충분하지만, 한 호스트에 여러 앱을 얹으면 이름이 겹친다.
const COOKIE_PREFIX = 'prism';

// `prism_session` · `prism_admin_session`(namespace='admin') ·
// 운영에서는 각각 `__Host-` 접두어가 붙는다.
//
// 로컬(http)에서 접두어를 쓸 수 없는 이유는 __Host-가 Secure를 요구하는데
// Secure 쿠키는 http에 저장되지 않기 때문이다.
export function namespacedCookieName(
  suffix: string,
  policy: CookiePolicy,
): string {
  const parts = policy.namespace
    ? [COOKIE_PREFIX, policy.namespace, suffix]
    : [COOKIE_PREFIX, suffix];
  const name = parts.join('_');
  return policy.isProduction ? `__Host-${name}` : name;
}

// 웹 세션 쿠키 — 액세스 토큰을 HttpOnly로 담아 브라우저 JS가 만질 수 없게 한다.
// (네이티브는 쿠키 저장소가 부자연스러워 Authorization: Bearer를 계속 쓴다)
export function sessionCookieName(policy: CookiePolicy): string {
  return namespacedCookieName('session', policy);
}

// 리프레시 자격증명 쿠키. 액세스 토큰과 분리하는 이유는 역할이 다르기 때문이다 —
// 액세스는 매 요청 실리고, 리프레시는 갱신할 때만 쓰인다.
export function refreshCookieName(policy: CookiePolicy): string {
  return namespacedCookieName('refresh', policy);
}

// ──────────────── 속성 ────────────────

// SameSite=Lax: 교차 사이트 POST(CSRF)에는 실리지 않고, 최상위 GET 이동에는 실린다.
// OAuth 복귀는 최상위 GET이라 Lax로 충분하며, 별도 CSRF 토큰 없이 쿠키 전환이 가능하다.
// (Apple form_post는 교차 사이트 POST지만 쿠키를 *심는* 것은 SameSite와 무관하고,
//  이어지는 웹 복귀가 최상위 GET이라 그때 정상 전송된다)
//
// maxAgeMs는 **리프레시 수명**(idle 만료)을 받는다 — 액세스 토큰 수명이 아니다.
// 쿠키는 액세스 토큰보다 오래 남겨둬야 한다. 만료된 토큰이라도 실려 와야 서버가
// "누구의 세션인지" 알고 갱신을 안내할 수 있기 때문이다(쿠키가 먼저 사라지면
// 갱신 가능한 세션인데도 첫 방문처럼 보인다).
export function sessionCookieOptions(
  isProduction: boolean,
  maxAgeMs: number,
): CookieOptions {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: isProduction, // 로컬 http에서는 Secure 쿠키가 저장되지 않는다
    maxAge: maxAgeMs,
  };
}

// 리프레시 쿠키는 세션 쿠키와 같은 정책·같은 수명을 쓴다.
// (Path를 /auth/refresh로 좁히고 싶지만 __Host-가 Path=/를 강제한다 —
//  접두어가 주는 cookie tossing 방어가 경로 축소보다 가치 있다고 판단했다)
export function refreshCookieOptions(
  isProduction: boolean,
  maxAgeMs: number,
): CookieOptions {
  return sessionCookieOptions(isProduction, maxAgeMs);
}

// ──────────────── 읽기 ────────────────

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
  policy: CookiePolicy,
): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return cookieOf(req, sessionCookieName(policy)) ?? null;
}
