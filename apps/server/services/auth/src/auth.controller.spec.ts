import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { PrismConfigService } from '@app/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './session/auth-token.service';
import type { AuthSession } from '@app/common';

// jose는 ESM 전용이라 jest(CJS)가 파싱하지 못한다 — 이 스펙은 AppleOAuthClient를
// 인스턴스화하지 않으므로(auth.service import 경유로만 닿음) 모듈 로드만 차단한다.
jest.mock('jose', () => ({}));

// 인증 HTTP 경계 계약: nonce 쿠키 발급/소진 · state 검증 차단 · 성공 fragment redirect.
// (AuthService는 stub — 오케스트레이션 내부는 auth.service 몫, 여기선 경계만 본다)
describe('AuthController', () => {
  const tokens = new AuthTokenService(
    new JwtService({ secret: 'test-secret' }),
  );
  const session: AuthSession = {
    accessToken: 'token-1',
    user: {
      id: 'u-1',
      provider: 'google',
      displayName: 'Alice',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };

  const getAuthUrl = jest.fn(() => 'https://provider/authorize');
  const loginWithSocial = jest.fn();
  const issueDemoSession = jest.fn(() => session);
  const authStub = {
    getAuthUrl,
    loginWithSocial,
    issueDemoSession,
  } as object as AuthService;

  const makeConfig = (demoEnabled = true) =>
    ({
      demoEnabled,
      webAppUrl: 'http://web',
      isProduction: false,
      socialConfigured: () => true,
    }) as object as PrismConfigService;

  const controller = new AuthController(authStub, tokens, makeConfig());

  const makeRes = () => {
    const fns = {
      redirect: jest.fn(),
      // 시그니처를 부여해 mock.calls가 타입을 갖게 한다(unsafe-assignment 방지).
      cookie: jest.fn<undefined, [name: string, value: string]>(),
      clearCookie: jest.fn(),
    };
    return { fns, res: fns as object as Response };
  };

  const reqWith = (cookieHeader?: string) =>
    ({
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    }) as object as Request;

  beforeEach(() => jest.clearAllMocks());

  it('socialStart: 흐름 전용 nonce 쿠키(prism_oauth_<nonce>)를 발급한다', () => {
    const { fns, res } = makeRes();
    controller.socialStart('google', res);

    const [cookieName] = fns.cookie.mock.calls[0] ?? [];
    const nonce = cookieName?.slice('prism_oauth_'.length);
    expect(cookieName?.startsWith('prism_oauth_')).toBe(true);
    expect(getAuthUrl).toHaveBeenCalledWith('google', nonce);
    expect(fns.redirect).toHaveBeenCalledWith('https://provider/authorize');
  });

  it('socialStart: 미지의 provider는 쿠키 발급 없이 실패 redirect', () => {
    const { fns, res } = makeRes();
    controller.socialStart('kakao', res);
    expect(fns.cookie).not.toHaveBeenCalled();
    expect(fns.redirect).toHaveBeenCalledWith(
      'http://web/login?error=SIGNIN_FAILED',
    );
  });

  it('콜백: 흐름 쿠키가 없으면 code 교환에 도달하지 못한다 (login-CSRF 차단)', async () => {
    const state = tokens.buildState('google', 'n1');
    const { fns, res } = makeRes();
    await controller.googleCallback(reqWith(), res, 'code-1', state, undefined);

    expect(loginWithSocial).not.toHaveBeenCalled();
    expect(fns.clearCookie).not.toHaveBeenCalled(); // 소진할 흐름 자체가 없음
    expect(fns.redirect).toHaveBeenCalledWith(
      'http://web/login?error=SIGNIN_FAILED',
    );
  });

  it('콜백 성공: 자기 흐름의 쿠키만 소진하고 다른 탭의 쿠키는 건드리지 않는다', async () => {
    loginWithSocial.mockResolvedValueOnce(session);
    const state = tokens.buildState('google', 'nA');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_nA=1; prism_oauth_nB=1'),
      res,
      'code-1',
      state,
      undefined,
    );
    expect(fns.clearCookie).toHaveBeenCalledWith(
      'prism_oauth_nA',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(fns.clearCookie).not.toHaveBeenCalledWith(
      'prism_oauth_nB',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('소진된 흐름의 콜백 재사용은 차단된다', async () => {
    const state = tokens.buildState('google', 'nA');
    const { fns, res } = makeRes();
    // 쿠키가 이미 소진된(없는) 상태에서 같은 state 재사용.
    await controller.googleCallback(
      reqWith('prism_oauth_nB=1'),
      res,
      'code-1',
      state,
      undefined,
    );
    expect(loginWithSocial).not.toHaveBeenCalled();
    expect(fns.redirect).toHaveBeenCalledWith(
      'http://web/login?error=SIGNIN_FAILED',
    );
  });

  it('취소/오류 콜백도 시작했던 흐름의 쿠키를 소진한다', async () => {
    const state = tokens.buildState('google', 'nA');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_nA=1'),
      res,
      undefined,
      state,
      'access_denied',
    );
    expect(fns.redirect).toHaveBeenCalledWith('http://web/login'); // 조용한 복귀
    expect(fns.clearCookie).toHaveBeenCalledWith(
      'prism_oauth_nA',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('콜백: 쿠키·state가 짝이면 로그인 후 fragment로 토큰 전달', async () => {
    loginWithSocial.mockResolvedValueOnce(session);
    const state = tokens.buildState('google', 'n1');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_n1=1'),
      res,
      'code-1',
      state,
      undefined,
    );

    expect(loginWithSocial).toHaveBeenCalledWith('google', 'code-1');
    expect(fns.clearCookie).toHaveBeenCalledWith(
      'prism_oauth_n1',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(fns.redirect).toHaveBeenCalledWith(
      'http://web/auth/callback#accessToken=token-1',
    );
  });

  it('콜백: 다른 provider용 state는 거부된다', async () => {
    const state = tokens.buildState('google', 'n1');
    const { fns, res } = makeRes();
    await controller.appleCallback(
      reqWith('prism_oauth_n1=1'),
      res,
      'code-1',
      state,
      undefined,
      undefined,
    );
    expect(loginWithSocial).not.toHaveBeenCalled();
    expect(fns.redirect).toHaveBeenCalledWith(
      'http://web/login?error=SIGNIN_FAILED',
    );
  });

  it('콜백: 사용자 취소(access_denied)는 오류 없이 로그인 화면으로', async () => {
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith(),
      res,
      undefined,
      undefined,
      'access_denied',
    );
    expect(fns.redirect).toHaveBeenCalledWith('http://web/login');
  });

  it('demo: 비활성화면 503 DEMO_DISABLED', () => {
    const disabled = new AuthController(authStub, tokens, makeConfig(false));
    expect(() => disabled.demo()).toThrow();
    expect(controller.demo()).toEqual(session);
  });
});
