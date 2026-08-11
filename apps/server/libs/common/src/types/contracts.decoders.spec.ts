import {
  decodeAuthSession,
  decodeSessionUser,
  decodeUser,
  type JsonValue,
} from './contracts';
import { decodeJwtPayload } from './user';

// 경계 디코더 계약: 계약 형식이면 그대로 구성, 어긋나면 throw(조용한 오염 금지).
describe('contract decoders', () => {
  const user: JsonValue = {
    id: 'u-1',
    provider: 'google',
    displayName: 'Alice',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('decodeUser: 계약 형식이면 User로 구성한다', () => {
    expect(decodeUser(user)).toEqual(user);
  });

  it('decodeUser: 미지의 provider는 throw', () => {
    expect(() => decodeUser({ ...user, provider: 'github' })).toThrow(
      /unknown provider/,
    );
  });

  it('decodeUser: 필드 타입이 다르면 throw (숫자 displayName 등)', () => {
    expect(() => decodeUser({ ...user, displayName: 42 })).toThrow(
      /displayName/,
    );
    expect(() => decodeUser('not-an-object')).toThrow(/expected object/);
  });

  it('빈 문자열 필드는 형식 오류다 (빈 id·빈 accessToken)', () => {
    expect(() => decodeUser({ ...user, id: '' })).toThrow(/User.id/);
    expect(() =>
      decodeAuthSession({ accessToken: '', refreshToken: 'r', user }),
    ).toThrow(/accessToken/);
  });

  // 쿠키 흐름 응답 — 토큰이 없어야 하고, 중첩 user와 액세스 토큰 수명이 검증된다.
  it('decodeSessionUser: user와 accessTokenTtlMs를 검증한다', () => {
    expect(decodeSessionUser({ user, accessTokenTtlMs: 900_000 })).toEqual({
      user,
      accessTokenTtlMs: 900_000,
    });
    expect(() => decodeSessionUser({})).toThrow(/User/);
    expect(() => decodeSessionUser({ user: null })).toThrow(/expected object/);
    // 수명은 필수 — 없거나 양의 정수가 아니면 형식 오류다(선제 갱신 스케줄이 의존한다).
    expect(() => decodeSessionUser({ user })).toThrow(/accessTokenTtlMs/);
    expect(() => decodeSessionUser({ user, accessTokenTtlMs: 0 })).toThrow(
      /accessTokenTtlMs/,
    );
    // 소수·안전 정수 범위 밖의 값도 거부한다 — 네이티브(Swift Int)와 해석이 갈리지 않게.
    expect(() => decodeSessionUser({ user, accessTokenTtlMs: 1.5 })).toThrow(
      /accessTokenTtlMs/,
    );
    expect(() =>
      decodeSessionUser({ user, accessTokenTtlMs: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(/accessTokenTtlMs/);
    // 서버가 실수로 토큰을 실어도 계약 타입에는 들어오지 않는다.
    expect(
      decodeSessionUser({
        user,
        accessTokenTtlMs: 900_000,
        accessToken: 'leak',
      }),
    ).toEqual({ user, accessTokenTtlMs: 900_000 });
  });

  it('decodeAuthSession: 중첩 user까지 검증한다', () => {
    expect(
      decodeAuthSession({ accessToken: 't', refreshToken: 'r', user }),
    ).toEqual({
      accessToken: 't',
      refreshToken: 'r',
      user,
    });
    expect(() =>
      decodeAuthSession({ accessToken: 't', refreshToken: 'r', user: null }),
    ).toThrow(/expected object/);
    // 리프레시 자격증명이 없으면 세션을 이어갈 수 없다 — 형식 오류로 잡는다.
    expect(() => decodeAuthSession({ accessToken: 't', user })).toThrow(
      /refreshToken/,
    );
    expect(() => decodeAuthSession({ user })).toThrow(/accessToken/);
  });

  it('decodeJwtPayload: 클레임 형식 검증', () => {
    const claims: JsonValue = { sub: 'u-1', jti: 'sess-1' };
    expect(decodeJwtPayload(claims)).toEqual(claims);
    expect(() => decodeJwtPayload({ ...claims, sub: 7 })).toThrow(/sub/);
    expect(() => decodeJwtPayload({ sub: 'u-1' })).toThrow(/jti/);
  });

  // 구 토큰(신원 클레임을 담고 jti가 없던 시절)은 세션을 가리키지 못하므로 거부돼야 한다.
  it('decodeJwtPayload: jti 없는 구 토큰은 거부한다', () => {
    expect(() =>
      decodeJwtPayload({
        sub: 'u-1',
        provider: 'apple',
        name: 'Alice',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/jti/);
  });
});
