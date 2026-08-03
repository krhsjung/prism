import { JwtService } from '@nestjs/jwt';
import { SessionTokenService } from '@app/session';
import { AuthTokenService, OAUTH_STATE_TTL_MS } from './auth-token.service';

// state 토큰 계약: provider/nonce/flow 바인딩 · 수명 · 서명 · 토큰 용도 혼용 차단.
// (세션 토큰은 @app/session의 SessionTokenService가 소유한다)
describe('AuthTokenService (OAuth state)', () => {
  const svc = new AuthTokenService(new JwtService({ secret: 'test-secret' }));

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

  // state는 "지금 시작한 흐름"의 증표다. 만료가 없으면 한 번 새어 나간 state를
  // 몇 달 뒤에도 콜백에 밀어 넣을 수 있어, 흐름을 시작한 시점과의 연결이 끊긴다.
  it('readState: 수명(10분)이 지난 state는 거부한다', () => {
    jest.useFakeTimers();
    try {
      const state = svc.buildState('google', 'nonce-1', 'redirect');
      // 만료 직전까지는 유효해야 한다 — 창을 통째로 닫아버리는 회귀도 잡는다.
      jest.advanceTimersByTime(OAUTH_STATE_TTL_MS - 2_000);
      expect(svc.readState(state, 'google')).not.toBeNull();

      jest.advanceTimersByTime(4_000);
      expect(svc.readState(state, 'google')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  // 클레임 모양만 맞춘 state를 공격자가 자기 키로 서명해 보낼 수 있다.
  // 서명 검증이 빠지면 nonce·provider·flow를 전부 공격자가 고르게 된다.
  it('readState: 다른 키로 서명한 state는 거부한다', () => {
    const forged = new JwtService({ secret: 'attacker-secret' }).sign({
      typ: 'oauth_state',
      provider: 'google',
      nonce: 'attacker-nonce',
      flow: 'redirect',
    });
    expect(svc.readState(forged, 'google')).toBeNull();
  });

  // 두 토큰은 같은 키로 서명되므로, 서로의 자리에 못 쓰게 막는 것은 `typ` 클레임뿐이다.
  // (세션 토큰 쪽 방향은 라이브러리가 소유하지만, 키를 공유하는 이상 여기서도 확인한다)
  it('세션 토큰을 state로 쓸 수 없다', () => {
    const sessionToken = new SessionTokenService(
      new JwtService({ secret: 'test-secret' }),
    ).signSession('u-1', 'sess-1');
    expect(svc.readState(sessionToken, 'google')).toBeNull(); // typ 없음
  });
});
