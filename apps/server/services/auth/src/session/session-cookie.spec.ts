import type { Request } from 'express';
import {
  oauthNonceCookieName,
  oauthNonceCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
  sessionTokenOf,
} from './session-cookie';

const reqWith = (cookie?: string, authorization?: string) =>
  ({
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    },
  }) as object as Request;

describe('session cookie', () => {
  it('운영에서는 __Host- 접두어 이름을 쓴다', () => {
    expect(sessionCookieName(true)).toBe('__Host-prism_session');
  });

  // 로컬(http)은 Secure 쿠키가 저장되지 않아 __Host- 요건을 만족할 수 없다.
  it('로컬에서는 접두어 없는 이름을 쓴다', () => {
    expect(sessionCookieName(false)).toBe('prism_session');
  });

  // __Host-의 성립 조건: Secure + Path=/ + Domain 없음. 하나라도 어긋나면 브라우저가 거부한다.
  it('운영 쿠키 옵션이 __Host- 요건을 만족한다', () => {
    const options = sessionCookieOptions(true);
    expect(options.secure).toBe(true);
    expect(options.path).toBe('/');
    expect(options.domain).toBeUndefined();
  });

  it('쿠키에서 세션 토큰을 읽는다', () => {
    expect(sessionTokenOf(reqWith('prism_session=tok-dev'), false)).toBe(
      'tok-dev',
    );
    expect(sessionTokenOf(reqWith('__Host-prism_session=tok-prod'), true)).toBe(
      'tok-prod',
    );
  });

  // 회귀 방지: 이걸 받아주면 형제 서브도메인이 심은 쿠키가 그대로 통과해
  // __Host- 접두어를 쓰는 의미가 사라진다(cookie tossing).
  it('운영에서 접두어 없는 동명 쿠키는 무시한다', () => {
    expect(sessionTokenOf(reqWith('prism_session=tossed'), true)).toBeNull();
  });

  // 두 쿠키가 함께 실려도 운영은 __Host- 쪽만 본다.
  it('접두어 쿠키와 동명 쿠키가 함께 와도 __Host- 값을 쓴다', () => {
    const both = 'prism_session=tossed; __Host-prism_session=real';
    expect(sessionTokenOf(reqWith(both), true)).toBe('real');
  });

  it('쿠키가 없으면 Bearer를 쓴다(네이티브)', () => {
    expect(sessionTokenOf(reqWith(undefined, 'Bearer tok-native'), true)).toBe(
      'tok-native',
    );
  });

  // 회귀 방지: 쿠키를 먼저 보면 남아 있던 오래된 쿠키가 유효한 Bearer를 가려 401이 된다.
  // 명시적으로 붙인 자격증명이 자동으로 딸려온 값에 밀리면 안 된다.
  it('둘 다 있으면 명시적인 Bearer가 쿠키를 이긴다', () => {
    const req = reqWith('__Host-prism_session=stale', 'Bearer tok-native');
    expect(sessionTokenOf(req, true)).toBe('tok-native');
  });

  it('로컬에서도 Bearer가 우선한다', () => {
    const req = reqWith('prism_session=stale', 'Bearer tok-native');
    expect(sessionTokenOf(req, false)).toBe('tok-native');
  });

  // Bearer가 아닌 Authorization은 무시하고 쿠키로 넘어간다.
  it('Bearer가 아닌 Authorization은 쿠키를 가리지 않는다', () => {
    const req = reqWith('prism_session=tok-web', 'Basic nope');
    expect(sessionTokenOf(req, false)).toBe('tok-web');
  });

  // 값은 클라이언트가 정하는 것이라 깨진 인코딩이 올 수 있다.
  // 500이 아니라 "인증 안 됨"으로 떨어져야 한다.
  it('깨진 퍼센트 인코딩 쿠키는 없는 것으로 다룬다', () => {
    expect(sessionTokenOf(reqWith('prism_session=%zz'), false)).toBeNull();
    // 같은 헤더에 유효한 Bearer가 있으면 그쪽으로 넘어간다.
    expect(
      sessionTokenOf(reqWith('prism_session=%zz', 'Bearer tok'), false),
    ).toBe('tok');
  });

  it('자격증명이 전혀 없으면 null', () => {
    expect(sessionTokenOf(reqWith(), true)).toBeNull();
    expect(sessionTokenOf(reqWith(undefined, 'Basic nope'), true)).toBeNull();
  });
});

// OAuth 흐름 nonce 쿠키도 세션 쿠키와 같은 이유로 접두어가 필요하다 —
// 이쪽이 뚫리면 세션 쿠키를 __Host-로 바꿔도 login-CSRF가 되살아난다.
describe('oauth nonce cookie', () => {
  it('운영에서는 __Host- 접두어를 붙인다', () => {
    expect(oauthNonceCookieName('n-1', true)).toBe('__Host-prism_oauth_n-1');
  });

  it('로컬에서는 접두어 없는 이름을 쓴다', () => {
    expect(oauthNonceCookieName('n-1', false)).toBe('prism_oauth_n-1');
  });

  // 흐름마다 이름이 갈려야 병행 탭이 서로를 소진하지 않는다.
  it('nonce가 다르면 쿠키 이름도 다르다', () => {
    expect(oauthNonceCookieName('a', true)).not.toBe(
      oauthNonceCookieName('b', true),
    );
  });

  // __Host-는 Path=/를 강제하므로 운영에서 Path=/auth를 쓸 수 없다.
  // Apple form_post(교차 사이트 POST)에는 SameSite=None이 필요하고 None은 Secure를 요구한다.
  it('운영 옵션이 __Host- 요건과 Apple form_post 요구를 함께 만족한다', () => {
    const options = oauthNonceCookieOptions(true);
    expect(options.secure).toBe(true);
    expect(options.path).toBe('/');
    expect(options.domain).toBeUndefined();
    expect(options.sameSite).toBe('none');
    expect(options.httpOnly).toBe(true);
  });

  // 로컬은 http라 Secure 쿠키가 저장되지 않으므로 None을 쓸 수 없다.
  it('로컬 옵션은 Lax + Path=/auth를 유지한다', () => {
    const options = oauthNonceCookieOptions(false);
    expect(options.secure).toBeUndefined();
    expect(options.path).toBe('/auth');
    expect(options.sameSite).toBe('lax');
  });
});
