import type { Request } from 'express';
import {
  refreshCookieName,
  sessionCookieName,
  sessionCookieOptions,
  sessionTokenOf,
  type CookiePolicy,
} from './session-cookie';

// 이름 규칙의 입력은 CookiePolicy 하나뿐이다 — 테스트도 같은 값을 쓴다.
const PROD: CookiePolicy = { isProduction: true, namespace: '' };
const LOCAL: CookiePolicy = { isProduction: false, namespace: '' };

const reqWith = (cookie?: string, authorization?: string) =>
  ({
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    },
  }) as object as Request;

describe('session cookie', () => {
  it('운영에서는 __Host- 접두어 이름을 쓴다', () => {
    expect(sessionCookieName(PROD)).toBe('__Host-prism_session');
  });

  // 로컬(http)은 Secure 쿠키가 저장되지 않아 __Host- 요건을 만족할 수 없다.
  it('로컬에서는 접두어 없는 이름을 쓴다', () => {
    expect(sessionCookieName(LOCAL)).toBe('prism_session');
  });

  // __Host-의 성립 조건: Secure + Path=/ + Domain 없음. 하나라도 어긋나면 브라우저가 거부한다.
  it('운영 쿠키 옵션이 __Host- 요건을 만족한다', () => {
    const options = sessionCookieOptions(true, 60_000);
    expect(options.secure).toBe(true);
    expect(options.path).toBe('/');
    expect(options.domain).toBeUndefined();
  });

  // 수명은 배포 환경이 정한다(PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN) — 하드코딩된 값이 아니다.
  it('쿠키 수명은 인자로 받은 값을 그대로 쓴다', () => {
    expect(sessionCookieOptions(false, 90_000).maxAge).toBe(90_000);
  });

  it('쿠키에서 세션 토큰을 읽는다', () => {
    expect(sessionTokenOf(reqWith('prism_session=tok-dev'), LOCAL)).toBe(
      'tok-dev',
    );
    expect(sessionTokenOf(reqWith('__Host-prism_session=tok-prod'), PROD)).toBe(
      'tok-prod',
    );
  });

  // 회귀 방지: 이걸 받아주면 형제 서브도메인이 심은 쿠키가 그대로 통과해
  // __Host- 접두어를 쓰는 의미가 사라진다(cookie tossing).
  it('운영에서 접두어 없는 동명 쿠키는 무시한다', () => {
    expect(sessionTokenOf(reqWith('prism_session=tossed'), PROD)).toBeNull();
  });

  // 두 쿠키가 함께 실려도 운영은 __Host- 쪽만 본다.
  it('접두어 쿠키와 동명 쿠키가 함께 와도 __Host- 값을 쓴다', () => {
    const both = 'prism_session=tossed; __Host-prism_session=real';
    expect(sessionTokenOf(reqWith(both), PROD)).toBe('real');
  });

  it('쿠키가 없으면 Bearer를 쓴다(네이티브)', () => {
    expect(sessionTokenOf(reqWith(undefined, 'Bearer tok-native'), PROD)).toBe(
      'tok-native',
    );
  });

  // 회귀 방지: 쿠키를 먼저 보면 남아 있던 오래된 쿠키가 유효한 Bearer를 가려 401이 된다.
  // 명시적으로 붙인 자격증명이 자동으로 딸려온 값에 밀리면 안 된다.
  it('둘 다 있으면 명시적인 Bearer가 쿠키를 이긴다', () => {
    const req = reqWith('__Host-prism_session=stale', 'Bearer tok-native');
    expect(sessionTokenOf(req, PROD)).toBe('tok-native');
  });

  it('로컬에서도 Bearer가 우선한다', () => {
    const req = reqWith('prism_session=stale', 'Bearer tok-native');
    expect(sessionTokenOf(req, LOCAL)).toBe('tok-native');
  });

  // Bearer가 아닌 Authorization은 무시하고 쿠키로 넘어간다.
  it('Bearer가 아닌 Authorization은 쿠키를 가리지 않는다', () => {
    const req = reqWith('prism_session=tok-web', 'Basic nope');
    expect(sessionTokenOf(req, LOCAL)).toBe('tok-web');
  });

  // 값은 클라이언트가 정하는 것이라 깨진 인코딩이 올 수 있다.
  // 500이 아니라 "인증 안 됨"으로 떨어져야 한다.
  it('깨진 퍼센트 인코딩 쿠키는 없는 것으로 다룬다', () => {
    expect(sessionTokenOf(reqWith('prism_session=%zz'), LOCAL)).toBeNull();
    // 같은 헤더에 유효한 Bearer가 있으면 그쪽으로 넘어간다.
    expect(
      sessionTokenOf(reqWith('prism_session=%zz', 'Bearer tok'), LOCAL),
    ).toBe('tok');
  });

  it('자격증명이 전혀 없으면 null', () => {
    expect(sessionTokenOf(reqWith(), PROD)).toBeNull();
    expect(sessionTokenOf(reqWith(undefined, 'Basic nope'), PROD)).toBeNull();
  });
});

// __Host-는 호스트 단위 격리까지만 해준다. 한 호스트에 앱이 둘 이상 올라가면
// 같은 이름의 쿠키를 함께 쓰게 되므로 이름 자체를 갈라야 한다.
describe('cookie namespace', () => {
  const ADMIN: CookiePolicy = { isProduction: true, namespace: 'admin' };
  const ADMIN_LOCAL: CookiePolicy = {
    isProduction: false,
    namespace: 'admin',
  };

  it('네임스페이스가 있으면 이름에 끼워 넣는다', () => {
    expect(sessionCookieName(ADMIN)).toBe('__Host-prism_admin_session');
    expect(sessionCookieName(ADMIN_LOCAL)).toBe('prism_admin_session');
    expect(refreshCookieName(ADMIN)).toBe('__Host-prism_admin_refresh');
  });

  // 기본값(미설정)은 기존 이름 그대로여야 한다 — 아니면 배포하는 순간 전원 로그아웃된다.
  it('네임스페이스가 없으면 기존 이름을 그대로 쓴다', () => {
    expect(sessionCookieName(PROD)).toBe('__Host-prism_session');
    expect(refreshCookieName(LOCAL)).toBe('prism_refresh');
  });

  // 이게 깨지면 네임스페이스를 나눈 의미가 없다 — 두 앱이 서로의 세션을 읽는다.
  it('다른 네임스페이스의 쿠키는 읽지 않는다', () => {
    const req = reqWith('__Host-prism_session=other-app');
    expect(sessionTokenOf(req, ADMIN)).toBeNull();
    // 자기 이름의 쿠키만 읽는다.
    expect(
      sessionTokenOf(reqWith('__Host-prism_admin_session=mine'), ADMIN),
    ).toBe('mine');
  });
});
