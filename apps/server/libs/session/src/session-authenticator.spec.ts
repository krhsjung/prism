import { AUTH_ERROR_CODES, SessionsRepository, type User } from '@app/common';
import { SessionAuthenticator } from './session-authenticator';
import { SessionTokenService } from './session-token.service';

const user: User = {
  id: 'u-1',
  provider: 'google',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// 인증 판단은 HTTP·WebSocket이 함께 쓰는 한 곳이다. 여기서 갈래가 잘못되면 가드의 401도
// 소켓의 close 코드도 함께 틀린다 — 네 갈래를 전부 못 박아 둔다.
describe('SessionAuthenticator', () => {
  let tokens: { verifySession: jest.Mock };
  let sessions: { findValid: jest.Mock; findValidSession: jest.Mock };
  let auth: SessionAuthenticator;

  // 고정값을 쓴다 — "숫자가 왔다"가 아니라 **읽은 값이 그대로 실려 왔는지**를 봐야
  // 창을 미는 쪽이 다시 읽지 않아도 된다는 계약이 지켜진다.
  const ABSOLUTE_EXPIRES_AT = 2_000_000_000_000;

  beforeEach(() => {
    tokens = { verifySession: jest.fn(() => ({ sub: user.id, jti: 's-1' })) };
    sessions = {
      findValid: jest.fn(() => Promise.resolve(user)),
      // 인증은 상한도 함께 읽는다 — 창을 미는 쪽이 다시 읽지 않게(jwt-auth.guard.ts).
      findValidSession: jest.fn(() =>
        Promise.resolve({ user, absoluteExpiresAt: ABSOLUTE_EXPIRES_AT }),
      ),
    };
    auth = new SessionAuthenticator(
      tokens as object as SessionTokenService,
      sessions as object as SessionsRepository,
    );
  });

  it('서명이 유효하고 세션이 살아 있으면 사용자와 세션 id를 준다', async () => {
    const result = await auth.authenticate('tok');
    // 상한도 함께 준다 — 창을 미는 쪽이 세션을 다시 읽지 않게(jwt-auth.guard.ts).
    expect(result).toEqual({
      ok: true,
      user,
      sessionId: 's-1',
      absoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    });
    expect(sessions.findValidSession).toHaveBeenCalledWith('s-1');
  });

  // 자격증명이 아예 없으면 갱신해도 소용없다 — SESSION_EXPIRED가 아니어야 한다.
  it('토큰이 없으면 UNAUTHORIZED다', async () => {
    expect(await auth.authenticate(null)).toEqual({
      ok: false,
      code: AUTH_ERROR_CODES.UNAUTHORIZED,
    });
    expect(tokens.verifySession).not.toHaveBeenCalled();
  });

  // 만료만이 "갱신하면 살아나는" 실패다. 이 구분이 없으면 클라이언트가 헛 왕복을 하거나,
  // 반대로 살릴 수 있는 세션을 버린다.
  it('만료된 토큰은 SESSION_EXPIRED다', async () => {
    const expired = new Error('jwt expired');
    expired.name = 'TokenExpiredError';
    tokens.verifySession.mockImplementation(() => {
      throw expired;
    });

    expect(await auth.authenticate('tok')).toEqual({
      ok: false,
      code: AUTH_ERROR_CODES.SESSION_EXPIRED,
    });
    expect(sessions.findValidSession).not.toHaveBeenCalled();
  });

  // 서명이 깨진 토큰은 정상 클라이언트가 만들 수 없다(변조·쿠키 주입) — 갱신을 권하지 않는다.
  it('서명이 깨진 토큰은 INVALID_TOKEN이다', async () => {
    tokens.verifySession.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    expect(await auth.authenticate('tok')).toEqual({
      ok: false,
      code: AUTH_ERROR_CODES.INVALID_TOKEN,
    });
  });

  // 서명이 유효해도 세션 행이 없으면(로그아웃·폐기·만료) 인증이 아니다.
  // 이 확인이 인증의 핵심이다 — 없으면 로그아웃한 토큰이 만료까지 계속 통한다.
  it('세션이 폐기됐으면 서명이 멀쩡해도 UNAUTHORIZED다', async () => {
    sessions.findValidSession.mockResolvedValue(null);

    expect(await auth.authenticate('tok')).toEqual({
      ok: false,
      code: AUTH_ERROR_CODES.UNAUTHORIZED,
    });
  });
});
