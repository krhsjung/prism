import { JwtService } from '@nestjs/jwt';
import type { CookieOptions, Request, Response } from 'express';
import { PrismConfigService } from '@app/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionTokenService } from '@app/session';
import {
  AuthTokenService,
  OAUTH_STATE_TTL_MS,
} from './session/auth-token.service';
import type { AuthSession } from '@app/common';

// jose는 ESM 전용이라 jest(CJS)가 파싱하지 못한다 — 이 스펙은 AppleOAuthClient를
// 인스턴스화하지 않으므로(auth.service import 경유로만 닿음) 모듈 로드만 차단한다.
jest.mock('jose', () => ({}));

// 인증 HTTP 경계 계약: nonce 쿠키 발급/소진 · state 검증 차단 · 세션 쿠키 발급 ·
// flow(redirect/popup)별 결과 전달. (AuthService는 stub — 내부 오케스트레이션은 그쪽 몫)
describe('AuthController', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  // state(OAuth 전용)와 세션 토큰은 소유자가 다르다 — 같은 키, 다른 typ.
  const tokens = new AuthTokenService(jwt);
  const sessionTokens = new SessionTokenService(jwt);
  const session: AuthSession = {
    accessToken: 'token-1',
    refreshToken: 'sess-1.secret-1',
    user: {
      id: 'u-1',
      provider: 'google',
      displayName: 'Alice',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    accessTokenTtlMs: 15 * 60 * 1000,
  };

  const getAuthUrl = jest.fn(() => 'https://provider/authorize');
  const loginWithSocial = jest.fn();
  const loginWithGoogleNative = jest.fn();
  const loginWithKakaoNative = jest.fn();
  const issueDemoSession = jest.fn(() => Promise.resolve(session));
  const revokeSession = jest.fn(() => Promise.resolve());
  const authStub = {
    getAuthUrl,
    loginWithSocial,
    loginWithGoogleNative,
    loginWithKakaoNative,
    issueDemoSession,
    revokeSession,
  } as object as AuthService;

  // 네이티브 웹-redirect 일회용 코드 저장소(flow=native). 대부분의 테스트는 안 쓰지만
  // 생성자에 필요하다 — issue는 고정 코드, redeem은 각 테스트가 원하는 값으로 설정.
  const issueNativeCode = jest.fn(() => Promise.resolve('native-code-1'));
  const redeemNativeCode = jest.fn();
  const nativeCodes = {
    issue: issueNativeCode,
    redeem: redeemNativeCode,
  } as object as import('./session/native-auth-code.service').NativeAuthCodeStore;

  const makeConfig = (demoEnabled = true, isProduction = false) =>
    ({
      demoEnabled,
      webAppUrl: 'http://web',
      nativeAuthCallbackUrl: 'prism://auth/callback',
      isProduction,
      // 쿠키 이름 판단의 단일 원천 — 심는 쪽과 읽는 쪽이 같은 값을 본다.
      cookiePolicy: { isProduction, namespace: '' },
      accessTokenTtlMs: 15 * 60 * 1000,
      refreshTokenTtlMs: 12 * 60 * 60 * 1000,
      socialConfigured: () => true,
    }) as object as PrismConfigService;

  const controller = new AuthController(
    authStub,
    tokens,
    sessionTokens,
    makeConfig(),
    nativeCodes,
  );

  const makeRes = () => {
    const send = jest.fn<undefined, [body: string]>();
    const fns = {
      redirect: jest.fn<undefined, [url: string]>(),
      // 시그니처를 부여해 mock.calls가 타입을 갖게 한다(unsafe-assignment 방지).
      cookie: jest.fn<
        undefined,
        [name: string, value: string, options?: CookieOptions]
      >(),
      clearCookie: jest.fn(),
      type: jest.fn(() => ({ send })),
      setHeader: jest.fn<undefined, [name: string, value: string]>(),
      send,
    };
    return { fns, res: fns as object as Response };
  };

  const reqWith = (
    cookieHeader?: string,
    acceptLanguage?: string,
    userAgent?: string,
  ) =>
    ({
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(acceptLanguage ? { 'accept-language': acceptLanguage } : {}),
        ...(userAgent ? { 'user-agent': userAgent } : {}),
      },
    }) as object as Request;

  // 로그아웃은 가드가 아니라 쿠키 안의 토큰에서 직접 세션을 읽는다 — 실제 서명된 토큰을 싣는다.
  const reqWithSession = (sessionId: string, prefixed = false) =>
    reqWith(
      `${prefixed ? '__Host-' : ''}prism_session=${sessionTokens.signSession('u-1', sessionId)}`,
    );

  // popup 흐름이 내려보낸 HTML 본문.
  const htmlOf = (fns: ReturnType<typeof makeRes>['fns']): string =>
    fns.send.mock.calls[0]?.[0] ?? '';

  const sessionCookieOf = (fns: ReturnType<typeof makeRes>['fns']) =>
    fns.cookie.mock.calls.find(([name]) => name === 'prism_session');

  beforeEach(() => jest.clearAllMocks());

  // ──────────────── 소셜 시작 ────────────────

  it('socialStart: 흐름 전용 nonce 쿠키(prism_oauth_<nonce>)를 발급한다', () => {
    const { fns, res } = makeRes();
    controller.socialStart(reqWith(), 'google', res);

    const [cookieName] = fns.cookie.mock.calls[0] ?? [];
    const nonce = cookieName?.slice('prism_oauth_'.length);
    expect(cookieName?.startsWith('prism_oauth_')).toBe(true);
    expect(getAuthUrl).toHaveBeenCalledWith('google', nonce, 'redirect');
    expect(fns.redirect).toHaveBeenCalledWith('https://provider/authorize');
  });

  it('socialStart: flow=popup을 state에 실어 보낸다', () => {
    const { res } = makeRes();
    controller.socialStart(reqWith(), 'google', res, 'popup');
    expect(getAuthUrl).toHaveBeenCalledWith(
      'google',
      expect.any(String),
      'popup',
    );
  });

  it('socialStart: 알 수 없는 flow는 redirect로 떨어진다', () => {
    const { res } = makeRes();
    controller.socialStart(reqWith(), 'google', res, 'sideways');
    expect(getAuthUrl).toHaveBeenCalledWith(
      'google',
      expect.any(String),
      'redirect',
    );
  });

  it('socialStart: 미지의 provider는 쿠키 발급 없이 실패 redirect', () => {
    const { fns, res } = makeRes();
    controller.socialStart(reqWith(), 'facebook', res);
    expect(fns.cookie).not.toHaveBeenCalled();
    expect(fns.redirect).toHaveBeenCalledWith(
      'http://web/login?error=SIGNIN_FAILED',
    );
  });

  // ──────────────── login-CSRF 방어 ────────────────

  it('콜백: 흐름 쿠키가 없으면 code 교환에 도달하지 못한다 (login-CSRF 차단)', async () => {
    const state = tokens.buildState('google', 'n1', 'redirect');
    const { fns, res } = makeRes();
    await controller.googleCallback(reqWith(), res, 'code-1', state, undefined);

    expect(loginWithSocial).not.toHaveBeenCalled();
    expect(fns.clearCookie).not.toHaveBeenCalled(); // 소진할 흐름 자체가 없음
    expect(sessionCookieOf(fns)).toBeUndefined(); // 세션도 발급되지 않는다
  });

  // 회귀 방지 — 리뷰 2차에서 드러난 경로.
  // asuscomm.com이 PSL에 없어 형제 호스트가 Domain=asuscomm.com으로 쿠키를 심을 수 있다.
  // 공격자는 자기가 시작한 흐름의 정상 state와 nonce를 알고 있으므로, 접두어 없는 이름의
  // 쿠키를 피해자 브라우저에 심어 "피해자가 시작한 흐름"인 척할 수 있었다.
  // 운영은 __Host- 이름만 조회하므로 심어진 쿠키가 검증을 통과하지 못해야 한다.
  it('운영: 형제 호스트가 심은 접두어 없는 흐름 쿠키는 콜백을 통과시키지 못한다', async () => {
    const prod = new AuthController(
      authStub,
      tokens,
      sessionTokens,
      makeConfig(true, true),
      nativeCodes,
    );
    const state = tokens.buildState('google', 'nA', 'redirect');
    const { fns, res } = makeRes();

    // 공격자가 Domain=asuscomm.com으로 심을 수 있는 것은 접두어 없는 이름뿐이다.
    await prod.googleCallback(
      reqWith('prism_oauth_nA=1'),
      res,
      'code-1',
      state,
      undefined,
    );

    expect(loginWithSocial).not.toHaveBeenCalled();
    expect(
      fns.cookie.mock.calls.find(([name]) => name.includes('prism_session')),
    ).toBeUndefined();
  });

  it('운영: 흐름 쿠키를 __Host- 이름으로 발급하고 같은 이름을 소진한다', async () => {
    const prod = new AuthController(
      authStub,
      tokens,
      sessionTokens,
      makeConfig(true, true),
      nativeCodes,
    );
    const start = makeRes();
    prod.socialStart(reqWith(), 'google', start.res);

    const [issued] = start.fns.cookie.mock.calls[0] ?? [''];
    expect(issued.startsWith('__Host-prism_oauth_')).toBe(true);
    const nonce = issued.slice('__Host-prism_oauth_'.length);

    loginWithSocial.mockResolvedValueOnce(session);
    const { fns, res } = makeRes();
    await prod.googleCallback(
      reqWith(`${issued}=1`),
      res,
      'code-1',
      tokens.buildState('google', nonce, 'redirect'),
      undefined,
    );

    expect(loginWithSocial).toHaveBeenCalledWith(
      'google',
      'code-1',
      undefined,
      'unknown',
    );
    expect(fns.clearCookie).toHaveBeenCalledWith(
      issued,
      expect.objectContaining({ secure: true, path: '/' }),
    );
  });

  it('콜백 성공: 자기 흐름의 쿠키만 소진하고 다른 탭의 쿠키는 건드리지 않는다', async () => {
    loginWithSocial.mockResolvedValueOnce(session);
    const state = tokens.buildState('google', 'nA', 'redirect');
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

  // ──────────────── 네이티브 웹-redirect (flow=native) ────────────────

  it('flow=native 콜백 성공: 세션 쿠키 없이 커스텀 스킴으로 code를 돌려준다', async () => {
    loginWithSocial.mockResolvedValueOnce(session);
    const state = tokens.buildState('google', 'nN', 'native');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_nN=1'),
      res,
      'code-1',
      state,
      undefined,
    );
    expect(issueNativeCode).toHaveBeenCalledWith(session);
    expect(fns.redirect).toHaveBeenCalledWith(
      'prism://auth/callback?code=native-code-1',
    );
    // 네이티브는 쿠키를 심지 않는다 — 토큰은 code 교환으로만 간다.
    expect(sessionCookieOf(fns)).toBeUndefined();
  });

  it('flow=native 콜백 실패: 커스텀 스킴에 error를 싣는다(code 미발급)', async () => {
    loginWithSocial.mockRejectedValueOnce(new Error('exchange failed'));
    const state = tokens.buildState('google', 'nN', 'native');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_nN=1'),
      res,
      'code-1',
      state,
      undefined,
    );
    expect(issueNativeCode).not.toHaveBeenCalled();
    expect(fns.redirect).toHaveBeenCalledWith(
      'prism://auth/callback?error=SIGNIN_FAILED',
    );
  });

  it('native/exchange: 유효한 코드는 세션(AuthSession)을 반환한다', async () => {
    redeemNativeCode.mockResolvedValueOnce(session);
    await expect(controller.nativeExchange('native-code-1')).resolves.toBe(
      session,
    );
    expect(redeemNativeCode).toHaveBeenCalledWith('native-code-1');
  });

  it('native/exchange: 없거나 소진된 코드는 401 INVALID_TOKEN', async () => {
    redeemNativeCode.mockResolvedValueOnce(null);
    await expect(controller.nativeExchange('used')).rejects.toMatchObject({
      status: 401,
      response: { error: 'INVALID_TOKEN' },
    });
  });

  it('native/exchange: 코드가 없으면 401 (redeem 호출 안 함)', async () => {
    await expect(controller.nativeExchange(undefined)).rejects.toThrow();
    expect(redeemNativeCode).not.toHaveBeenCalled();
  });

  it('소진된 흐름의 콜백 재사용은 차단된다', async () => {
    const state = tokens.buildState('google', 'nA', 'redirect');
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
    expect(sessionCookieOf(fns)).toBeUndefined();
  });

  it('콜백: 다른 provider용 state는 거부된다', async () => {
    const state = tokens.buildState('google', 'n1', 'redirect');
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
    expect(sessionCookieOf(fns)).toBeUndefined();
  });

  // 흐름 쿠키가 남아 있어도 state가 만료됐으면 통과시키지 않는다 — 두 검증은 서로를
  // 대체하지 않는다(쿠키는 "이 브라우저인가", state는 "지금 시작한 흐름인가"를 답한다).
  it('콜백: 수명이 지난 state는 쿠키가 맞아도 code 교환에 도달하지 못한다', async () => {
    jest.useFakeTimers();
    try {
      const state = tokens.buildState('google', 'nA', 'redirect');
      jest.advanceTimersByTime(OAUTH_STATE_TTL_MS + 1_000);

      const { fns, res } = makeRes();
      await controller.googleCallback(
        reqWith('prism_oauth_nA=1'),
        res,
        'code-1',
        state,
        undefined,
      );

      expect(loginWithSocial).not.toHaveBeenCalled();
      expect(sessionCookieOf(fns)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  // 공격자가 클레임 모양만 맞춰 자기 키로 서명한 state. 서명 검증이 빠지면
  // nonce를 공격자가 고르게 되고, 자기 쿠키와 짝을 맞춰 login-CSRF가 되살아난다.
  it('콜백: 다른 키로 서명한 state는 거부된다', async () => {
    const forged = new JwtService({ secret: 'attacker-secret' }).sign({
      typ: 'oauth_state',
      provider: 'google',
      nonce: 'nX',
      flow: 'redirect',
    });
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_nX=1'), // 공격자가 짝이 맞는 쿠키까지 준비한 상황
      res,
      'code-1',
      forged,
      undefined,
    );

    expect(loginWithSocial).not.toHaveBeenCalled();
    expect(sessionCookieOf(fns)).toBeUndefined();
  });

  it('취소/오류 콜백도 시작했던 흐름의 쿠키를 소진한다', async () => {
    const state = tokens.buildState('google', 'nA', 'redirect');
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

  // ──────────────── 세션 쿠키 (redirect 흐름) ────────────────

  it('redirect 성공: 세션을 HttpOnly 쿠키로 심고 토큰 없이 콜백 라우트로 보낸다', async () => {
    loginWithSocial.mockResolvedValueOnce(session);
    const state = tokens.buildState('google', 'n1', 'redirect');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_n1=1'),
      res,
      'code-1',
      state,
      undefined,
    );

    expect(loginWithSocial).toHaveBeenCalledWith(
      'google',
      'code-1',
      undefined,
      'unknown',
    );
    expect(sessionCookieOf(fns)).toEqual([
      'prism_session',
      'token-1',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    ]);
    // 회귀 방지: 토큰이 URL(fragment 포함)에 실리면 안 된다.
    expect(fns.redirect).toHaveBeenCalledWith('http://web/auth/callback');
    const [target] = fns.redirect.mock.calls[0] ?? [''];
    expect(target).not.toContain('token-1');
  });

  // ──────────────── popup 흐름 ────────────────

  it('popup 성공: redirect 대신 결과만 opener로 postMessage한다', async () => {
    loginWithSocial.mockResolvedValueOnce(session);
    const state = tokens.buildState('google', 'n1', 'popup');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_n1=1'),
      res,
      'code-1',
      state,
      undefined,
    );

    expect(fns.redirect).not.toHaveBeenCalled();
    expect(sessionCookieOf(fns)?.[1]).toBe('token-1');

    const html = htmlOf(fns);
    expect(html).toContain('"type":"prism:oauth"');
    expect(html).toContain('"ok":true');
    expect(html).toContain('postMessage');
    // targetOrigin은 서버 설정값이어야 한다(클라이언트 지정 origin 금지).
    expect(html).toContain('"http://web"');
    // 토큰은 쿠키로만 전달된다 — 페이지 본문에 실리면 안 된다.
    expect(html).not.toContain('token-1');
  });

  // 서버가 직접 그리는 유일한 화면이라 언어도 서버가 정한다 — 웹의 선택(localStorage)은
  // 출처가 달라 읽을 수 없고, 요청에 실려 오는 Accept-Language가 유일한 단서다.
  it('popup 페이지는 요청 언어로 응답한다(문서 언어 + noscript 문구)', async () => {
    loginWithSocial.mockResolvedValueOnce(session);
    const state = tokens.buildState('google', 'n1', 'popup');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_n1=1', 'ko-KR,ko;q=0.9,en;q=0.8'),
      res,
      'code-1',
      state,
      undefined,
    );

    const html = htmlOf(fns);
    expect(html).toContain('<html lang="ko" dir="ltr">');
    expect(html).toContain('Prism으로 이동');
  });

  it('popup 페이지: 지원하지 않는 언어 요청은 기본 언어로 응답한다', async () => {
    loginWithSocial.mockResolvedValueOnce(session);
    const state = tokens.buildState('google', 'n1', 'popup');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_n1=1', 'fr-FR,de;q=0.9'),
      res,
      'code-1',
      state,
      undefined,
    );

    const html = htmlOf(fns);
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('Continue to Prism');
  });

  it('popup 실패: 오류 코드를 메시지로 전달한다', async () => {
    const state = tokens.buildState('google', 'n1', 'popup');
    const { fns, res } = makeRes();
    // 흐름 쿠키가 없어 실패하지만, flow는 state에서 읽혀 popup으로 응답한다.
    await controller.googleCallback(reqWith(), res, 'code-1', state, undefined);

    const html = htmlOf(fns);
    expect(html).toContain('"ok":false');
    expect(html).toContain('SIGNIN_FAILED');
    expect(fns.redirect).not.toHaveBeenCalled();
  });

  it('popup 취소: 오류 코드 없이 알린다', async () => {
    const state = tokens.buildState('google', 'nA', 'popup');
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith('prism_oauth_nA=1'),
      res,
      undefined,
      state,
      'access_denied',
    );

    const html = htmlOf(fns);
    expect(html).toContain('"ok":false');
    expect(html).not.toContain('SIGNIN_FAILED');
  });

  // state를 못 읽으면 flow도 알 수 없다 — 브라우저가 opener 유무로 스스로 판단한다.
  it('state를 읽을 수 없으면 opener 유무로 분기하는 페이지를 내려준다', async () => {
    const { fns, res } = makeRes();
    await controller.googleCallback(
      reqWith(),
      res,
      'code-1',
      'not-a-valid-state',
      undefined,
    );

    const html = htmlOf(fns);
    expect(html).toContain('window.opener');
    expect(html).toContain('location.replace');
    expect(html).toContain('http://web/login?error=SIGNIN_FAILED');
    expect(fns.redirect).not.toHaveBeenCalled();
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
    // state가 없어 flow 미상 — 페이지가 opener 유무로 분기한다.
    expect(htmlOf(fns)).toContain('http://web/login"');
  });

  // ──────────────── popup 페이지의 CSP ────────────────

  const cspOf = (fns: ReturnType<typeof makeRes>['fns']): string =>
    fns.setHeader.mock.calls.find(
      ([name]) => name === 'Content-Security-Policy',
    )?.[1] ?? '';

  const popupCallback = async (
    fns: ReturnType<typeof makeRes>['fns'],
    res: Response,
  ) => {
    const state = tokens.buildState('google', 'nA', 'popup');
    await controller.googleCallback(
      reqWith('prism_oauth_nA=1'),
      res,
      undefined,
      state,
      'access_denied',
    );
    return fns;
  };

  it('popup 페이지는 nonce로 그 스크립트만 실행을 허용한다', async () => {
    const { fns, res } = makeRes();
    await popupCallback(fns, res);

    const csp = cspOf(fns);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");

    // 헤더의 nonce와 script 태그의 nonce가 같아야 스크립트가 실행된다.
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(htmlOf(fns)).toContain(`<script nonce="${nonce ?? ''}">`);
  });

  // nonce가 고정값이면 공격자가 미리 알고 자기 스크립트에 붙일 수 있다.
  it('nonce는 응답마다 새로 만든다', async () => {
    const first = makeRes();
    await popupCallback(first.fns, first.res);
    const second = makeRes();
    await popupCallback(second.fns, second.res);

    expect(cspOf(first.fns)).not.toBe('');
    expect(cspOf(first.fns)).not.toBe(cspOf(second.fns));
  });

  // ──────────────── 데모 / 로그아웃 ────────────────

  // 회귀 방지 — 리뷰 3차. 쿠키를 심는 응답이 body로도 토큰을 주면
  // XSS가 fetch 한 번으로 자격증명을 가져가므로 HttpOnly가 무의미해진다.
  it('demo: 세션은 쿠키로만 주고 body에는 사용자·수명만 담는다', async () => {
    const { fns, res } = makeRes();
    await expect(controller.demo(reqWith(), res)).resolves.toEqual({
      user: session.user,
      accessTokenTtlMs: 15 * 60 * 1000,
    });
    expect(sessionCookieOf(fns)).toEqual([
      'prism_session',
      'token-1',
      expect.objectContaining({ httpOnly: true }),
    ]);
  });

  it('demo: 비활성화면 503 DEMO_DISABLED', async () => {
    const disabled = new AuthController(
      authStub,
      tokens,
      sessionTokens,
      makeConfig(false),
      nativeCodes,
    );
    const { res } = makeRes();
    await expect(disabled.demo(reqWith(), res)).rejects.toThrow();
  });

  it('demo/native: 토큰(AuthSession)을 body로 준다 — 쿠키를 심지 않는다', async () => {
    // 쿠키 흐름과 같은 세션을 발급하되(issueDemoSession) 전달만 body다.
    await expect(controller.demoNative(reqWith())).resolves.toBe(session);
    expect(issueDemoSession).toHaveBeenCalled();
  });

  it('demo/native: 비활성화면 503 DEMO_DISABLED', async () => {
    const disabled = new AuthController(
      authStub,
      tokens,
      sessionTokens,
      makeConfig(false),
      nativeCodes,
    );
    await expect(disabled.demoNative(reqWith())).rejects.toThrow();
  });

  // ──────────────── 네이티브(모바일 SDK) 로그인 ────────────────
  //
  // 웹 흐름과 달리 자격증명(AuthSession)을 body로 반환한다 — 네이티브는 쿠키가 아니라
  // Bearer로 세션을 유지하기 때문. 토큰 누락·검증 실패는 provider 구분 없이 401 INVALID_TOKEN.

  it('google/native: idToken을 검증해 세션(AuthSession)을 body로 반환한다', async () => {
    loginWithGoogleNative.mockResolvedValueOnce(session);
    await expect(controller.googleNative(reqWith(), 'id-tok-1')).resolves.toBe(
      session,
    );
    expect(loginWithGoogleNative).toHaveBeenCalledWith('id-tok-1', 'unknown');
  });

  it('google/native: idToken이 없으면 401 INVALID_TOKEN (검증 호출 안 함)', async () => {
    await expect(
      controller.googleNative(reqWith(), undefined),
    ).rejects.toThrow();
    expect(loginWithGoogleNative).not.toHaveBeenCalled();
  });

  it('google/native: 검증 실패는 401 INVALID_TOKEN으로 뭉갠다(원인 미노출)', async () => {
    loginWithGoogleNative.mockRejectedValueOnce(new Error('aud mismatch'));
    await expect(
      controller.googleNative(reqWith(), 'bad'),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'INVALID_TOKEN' },
    });
  });

  it('kakao/native: accessToken을 검증해 세션(AuthSession)을 body로 반환한다', async () => {
    loginWithKakaoNative.mockResolvedValueOnce(session);
    await expect(controller.kakaoNative(reqWith(), 'acc-tok-1')).resolves.toBe(
      session,
    );
    expect(loginWithKakaoNative).toHaveBeenCalledWith('acc-tok-1', 'unknown');
  });

  it('kakao/native: accessToken이 없으면 401 INVALID_TOKEN (검증 호출 안 함)', async () => {
    await expect(
      controller.kakaoNative(reqWith(), undefined),
    ).rejects.toThrow();
    expect(loginWithKakaoNative).not.toHaveBeenCalled();
  });

  it('kakao/native: 검증 실패는 401 INVALID_TOKEN으로 뭉갠다(원인 미노출)', async () => {
    loginWithKakaoNative.mockRejectedValueOnce(new Error('app_id mismatch'));
    await expect(
      controller.kakaoNative(reqWith(), 'bad'),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'INVALID_TOKEN' },
    });
  });

  // 로그아웃의 본질은 쿠키 삭제가 아니라 **서버 세션 폐기**다 —
  // 세션 행이 남아 있으면 이미 발급된 토큰이 만료까지 계속 통한다.
  it('logout: 서버 세션을 폐기하고 쿠키도 지운다', async () => {
    const { fns, res } = makeRes();
    await controller.logout(reqWithSession('sess-1'), res);

    expect(revokeSession).toHaveBeenCalledWith('sess-1');
    expect(fns.clearCookie).toHaveBeenCalledWith(
      'prism_session',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });

  // 운영에서는 발급·삭제가 모두 __Host- 이름이어야 한다 — 한쪽만 바뀌면 로그아웃이
  // 엉뚱한 쿠키를 지우고 세션이 남는다.
  it('운영: 세션 쿠키를 __Host- 이름으로 발급하고 지운다', async () => {
    const prod = new AuthController(
      authStub,
      tokens,
      sessionTokens,
      makeConfig(true, true),
      nativeCodes,
    );
    const { fns, res } = makeRes();

    await prod.demo(reqWith(), res);
    expect(fns.cookie).toHaveBeenCalledWith(
      '__Host-prism_session',
      'token-1',
      expect.objectContaining({ secure: true, path: '/' }),
    );

    await prod.logout(reqWithSession('sess-1', true), res);
    expect(fns.clearCookie).toHaveBeenCalledWith(
      '__Host-prism_session',
      expect.objectContaining({ secure: true, path: '/' }),
    );
  });

  // ──────────────── 로그아웃 멱등성 ────────────────
  //
  // 회귀 방지. 로그아웃에 JwtAuthGuard가 붙어 있던 동안, 세션이 이미 없으면 401로 끊겨
  // 핸들러가 실행되지 않았다 = **쿠키가 지워지지 않았다.** JS는 HttpOnly 쿠키를 못 지우니
  // 브라우저에는 유효한 쿠키가, 서버에는 세션이 없는 채로 굳어 로그아웃이 영영 불가능했다.
  // 아래 세 경우 모두 "지울 게 없어도 쿠키는 지운다"가 성립해야 한다.

  it('logout: 자격증명이 아예 없어도 쿠키를 지운다', async () => {
    const { fns, res } = makeRes();
    await controller.logout(reqWith(), res);

    expect(revokeSession).not.toHaveBeenCalled();
    expect(fns.clearCookie).toHaveBeenCalledWith(
      'prism_session',
      expect.anything(),
    );
    expect(fns.clearCookie).toHaveBeenCalledWith(
      'prism_refresh',
      expect.anything(),
    );
  });

  it('logout: 서명이 깨진 토큰이어도 쿠키를 지운다', async () => {
    const { fns, res } = makeRes();
    await controller.logout(reqWith('prism_session=not-a-jwt'), res);

    expect(revokeSession).not.toHaveBeenCalled();
    expect(fns.clearCookie).toHaveBeenCalledWith(
      'prism_session',
      expect.anything(),
    );
  });

  // 액세스 토큰은 15분짜리다. 그보다 오래 자리를 비운 뒤 로그아웃하는 것이 오히려 흔한데,
  // 만료를 이유로 폐기를 건너뛰면 서버 세션이 idle 만료까지 남는다.
  it('logout: 만료된 토큰이어도 서명이 맞으면 세션을 폐기한다', async () => {
    const expired = new JwtService({ secret: 'test-secret' }).sign(
      { sub: 'u-1', jti: 'sess-old' },
      { expiresIn: '-1s' },
    );
    const { fns, res } = makeRes();
    await controller.logout(reqWith(`prism_session=${expired}`), res);

    expect(revokeSession).toHaveBeenCalledWith('sess-old');
    expect(fns.clearCookie).toHaveBeenCalledWith(
      'prism_session',
      expect.anything(),
    );
  });

  // 서명 검증은 유지된다 — 남의 세션 id를 담은 토큰을 만들어 강제 로그아웃시킬 수 없다.
  it('logout: 다른 키로 서명한 토큰의 세션은 폐기하지 않는다', async () => {
    const forged = new JwtService({ secret: 'attacker-secret' }).sign({
      sub: 'victim',
      jti: 'victim-session',
    });
    const { res } = makeRes();
    await controller.logout(reqWith(`prism_session=${forged}`), res);

    expect(revokeSession).not.toHaveBeenCalled();
  });
});
