import { JwtService } from '@nestjs/jwt';
import { AuthTokenService } from './auth-token.service';
import type { User } from '@app/common';

// 토큰 계약: 세션 왕복 · state의 provider/nonce 바인딩 · 토큰 용도 혼용 차단.
describe('AuthTokenService', () => {
  const svc = new AuthTokenService(new JwtService({ secret: 'test-secret' }));
  const user: User = {
    id: 'u-1',
    provider: 'google',
    displayName: 'Alice',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('signSession ↔ verifySession 왕복', () => {
    expect(svc.verifySession(svc.signSession(user))).toEqual(user);
  });

  it('stateNonce: 서명·provider가 유효하면 바인딩된 nonce를 반환한다', () => {
    const state = svc.buildState('google', 'nonce-1');
    expect(svc.stateNonce(state, 'google')).toBe('nonce-1');
    expect(svc.stateNonce(state, 'apple')).toBeNull(); // provider 불일치
    expect(svc.stateNonce(undefined, 'google')).toBeNull();
    expect(svc.stateNonce('tampered.token.value', 'google')).toBeNull();
  });

  it('세션 토큰을 state로, state를 세션 토큰으로 쓸 수 없다', () => {
    const session = svc.signSession(user);
    expect(svc.stateNonce(session, 'google')).toBeNull(); // typ 없음
    const state = svc.buildState('google', 'nonce');
    expect(() => svc.verifySession(state)).toThrow(); // 세션 클레임 없음
  });
});
