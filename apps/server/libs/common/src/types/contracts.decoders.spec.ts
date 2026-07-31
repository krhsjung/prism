import { decodeAuthSession, decodeUser, type JsonValue } from './contracts';
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
    expect(() => decodeAuthSession({ accessToken: '', user })).toThrow(
      /accessToken/,
    );
  });

  it('decodeAuthSession: 중첩 user까지 검증한다', () => {
    expect(decodeAuthSession({ accessToken: 't', user })).toEqual({
      accessToken: 't',
      user,
    });
    expect(() => decodeAuthSession({ accessToken: 't', user: null })).toThrow(
      /expected object/,
    );
    expect(() => decodeAuthSession({ user })).toThrow(/accessToken/);
  });

  it('decodeJwtPayload: 클레임 형식 검증', () => {
    const claims: JsonValue = {
      sub: 'u-1',
      provider: 'apple',
      name: 'Alice',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(decodeJwtPayload(claims)).toEqual(claims);
    expect(() => decodeJwtPayload({ ...claims, provider: 'x' })).toThrow(
      /unknown provider/,
    );
    expect(() => decodeJwtPayload({ ...claims, sub: 7 })).toThrow(/sub/);
  });
});
