import { JwtService } from '@nestjs/jwt';
import { decodeObject, parseJsonValue, type JsonValue } from '@app/common';
import { AuthTokenService } from './auth-token.service';

// 토큰 계약: 세션 참조 왕복 · state의 provider/nonce/flow 바인딩 · 토큰 용도 혼용 차단.
describe('AuthTokenService', () => {
  const svc = new AuthTokenService(new JwtService({ secret: 'test-secret' }));

  it('signSession ↔ verifySession 왕복', () => {
    expect(svc.verifySession(svc.signSession('u-1', 'sess-1'))).toEqual({
      sub: 'u-1',
      jti: 'sess-1',
    });
  });

  // 회귀 방지: 토큰은 서명일 뿐 암호화가 아니다. 표시 이름 같은 값이 클레임에 있으면
  // 쿠키를 얻은 사람이 base64 디코드만으로 읽는다 — 신원은 서버 세션에만 둔다.
  it('토큰 클레임에 사용자 정보가 담기지 않는다', () => {
    const token = svc.signSession('u-1', 'sess-1');
    const decoded: JsonValue = parseJsonValue(
      Buffer.from(token.split('.')[1] ?? '', 'base64').toString(),
    );
    const claims = decodeObject(decoded, 'claims');

    // 세션을 가리키는 값 외에는 아무것도 없어야 한다.
    expect(claims.name).toBeUndefined();
    expect(claims.provider).toBeUndefined();
    expect(claims.createdAt).toBeUndefined();
    expect(Object.keys(claims).sort()).toEqual(['iat', 'jti', 'sub']);
  });

  it('readState: 서명·provider가 유효하면 바인딩된 nonce와 flow를 반환한다', () => {
    const state = svc.buildState('google', 'nonce-1', 'popup');
    expect(svc.readState(state, 'google')).toEqual({
      nonce: 'nonce-1',
      flow: 'popup',
    });
    expect(svc.readState(state, 'apple')).toBeNull(); // provider 불일치
    expect(svc.readState(undefined, 'google')).toBeNull();
    expect(svc.readState('tampered.token.value', 'google')).toBeNull();
  });

  // flow는 서명 안에 있어야 한다 — 콜백 시점에 바꿔치기하면 결과 전달 경로가 바뀐다.
  it('readState: flow가 state의 서명에 포함된다', () => {
    expect(
      svc.readState(svc.buildState('google', 'n', 'redirect'), 'google')?.flow,
    ).toBe('redirect');
    expect(
      svc.readState(svc.buildState('google', 'n', 'popup'), 'google')?.flow,
    ).toBe('popup');
  });

  // 배포 교차 구간: flow 없이 발급된 state가 콜백으로 돌아올 수 있다.
  it('readState: flow가 없는 구 state는 redirect로 본다', () => {
    const legacy = new JwtService({ secret: 'test-secret' }).sign({
      typ: 'oauth_state',
      provider: 'google',
      nonce: 'n-legacy',
    });
    expect(svc.readState(legacy, 'google')).toEqual({
      nonce: 'n-legacy',
      flow: 'redirect',
    });
  });

  it('세션 토큰을 state로, state를 세션 토큰으로 쓸 수 없다', () => {
    const session = svc.signSession('u-1', 'sess-1');
    expect(svc.readState(session, 'google')).toBeNull(); // typ 없음
    const state = svc.buildState('google', 'nonce', 'redirect');
    expect(() => svc.verifySession(state)).toThrow(); // 세션 클레임 없음
  });
});
