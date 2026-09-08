import type { CookieOptions } from 'express';
import { namespacedCookieName, type CookiePolicy } from '@app/session';
import { OAUTH_STATE_TTL_MS } from './auth-token.service';

// 웹 소셜 로그인의 푸시 등록 토큰을 **로그인 시작부터 콜백까지** 나르는 쿠키.
//
// 왜 쿠키인가: 네이티브 로그인과 웹 데모 로그인은 요청 body에 토큰을 실을 수 있지만,
// 웹 소셜 로그인은 세션이 **서버 콜백** 안에서 만들어져 실을 자리가 없다. 그렇다고
// 등록 경로를 따로 열면 살아 있는 세션 레코드를 고치게 되는데, 그건 하지 않기로 한
// 결정이다(plan/push.md §5-2).
//
// 왜 URL이 아닌가: 쿼리 파라미터는 **서버 접근 로그와 브라우저 히스토리에 남고**,
// OAuth `state`는 provider까지 갔다 온다. 토큰을 감추는 §5-3의 이유가 그대로 무너진다.
//
// 쿠키를 **서버가 심는다**(HttpOnly). JS가 심으면 형제 호스트가 `Domain=`으로 우리에게
// 실려 오는 쿠키를 만들어 *자기* 토큰을 피해자 브라우저에 심을 수 있고, 그러면 피해자의
// 통화 알림을 받아 간다. 페이로드가 `callId`와 기기 종류뿐이라 피해는 갇혀 있지만,
// 운영의 `__Host-` 접두어가 그 문까지 닫는다(oauth nonce 쿠키와 같은 이유).
export function pushPendingCookieName(policy: CookiePolicy): string {
  return namespacedCookieName('push_pending', policy);
}

// 수명·경로·SameSite는 **oauth nonce 쿠키와 같다.** 같은 여정(시작 → provider → 콜백)을
// 함께 지나야 하므로, 한쪽만 다르면 Apple의 교차 사이트 form_post에서 하나만 사라진다.
export function pushPendingCookieOptions(isProduction: boolean): CookieOptions {
  const base: CookieOptions = { httpOnly: true, maxAge: OAUTH_STATE_TTL_MS };
  return isProduction
    ? { ...base, path: '/', secure: true, sameSite: 'none' }
    : { ...base, path: '/auth', sameSite: 'lax' };
}
