import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import { PrismConfigService } from '@app/config';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  AuthTokenService,
  OAUTH_STATE_TTL_MS,
} from './session/auth-token.service';
import {
  joinPersonName,
  parseAppleUserName,
  type AppleUserName,
} from './oauth/apple-user';
import {
  AUTH_ERROR_CODES,
  SOCIAL_PROVIDERS,
  type AuthSession,
  type SocialProvider,
  type User,
} from '@app/common';

// OAuth 콜백에서 로그인 실패를 웹에 알리는 공통 코드. 웹 로그인 화면이 메시지로 매핑한다.
const SIGNIN_FAILED = AUTH_ERROR_CODES.SIGNIN_FAILED;

// OAuth 시작 시 발급하는 브라우저 nonce 쿠키 — state와 짝을 이뤄 login-CSRF를 막는다.
// 흐름(flow)마다 독립 쿠키(prism_oauth_<nonce>)를 쓴다: 병행 탭·동시 콜백이 서로의
// 쿠키를 읽고-고쳐-쓰는 경합(lost update) 자체가 없고, TTL로 자연 만료된다.
const OAUTH_NONCE_COOKIE_PREFIX = 'prism_oauth_';

// 요청의 Cookie 헤더에서 값 하나를 꺼낸다(필요한 게 nonce뿐이라 cookie-parser 미도입).
function cookieOf(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: AuthTokenService,
    private readonly config: PrismConfigService,
  ) {}

  // 원클릭 데모 로그인 — 외부 OAuth 없이 시드된 데모 계정으로 세션 발급.
  @Post('demo')
  demo(): AuthSession {
    if (!this.config.demoEnabled) {
      throw new HttpException({ error: AUTH_ERROR_CODES.DEMO_DISABLED }, 503);
    }
    return this.auth.issueDemoSession();
  }

  // ──────────────────── 콜백 (provider별 프로토콜이 달라 통합하지 않음) ────────────────────

  // Google: GET 쿼리 콜백.
  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    if (error) {
      // 취소/오류로 끝난 흐름도 시작했던 nonce는 소진한다(state 잔존 방지).
      this.consumeStateNonce(req, res, state, 'google');
      return this.cancelOrFail(res, error);
    }
    if (!this.consumeStateNonce(req, res, state, 'google') || !code)
      return this.fail(res, SIGNIN_FAILED);

    try {
      const session = await this.auth.loginWithSocial('google', code);
      this.success(res, session.accessToken);
    } catch (e) {
      this.logger.error(`[google] callback failed: ${this.reason(e)}`);
      this.fail(res, SIGNIN_FAILED);
    }
  }

  // Apple: response_mode=form_post 콜백(POST + body).
  // 최초 로그인 시에만 body.user(JSON)에 이름이 담긴다.
  @Post('apple/callback')
  async appleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Body('code') code?: string,
    @Body('state') state?: string,
    @Body('error') error?: string,
    @Body('user') user?: string,
  ): Promise<void> {
    if (error) {
      // 취소/오류로 끝난 흐름도 시작했던 nonce는 소진한다(state 잔존 방지).
      this.consumeStateNonce(req, res, state, 'apple');
      return this.cancelOrFail(res, error);
    }
    if (!this.consumeStateNonce(req, res, state, 'apple') || !code)
      return this.fail(res, SIGNIN_FAILED);

    try {
      const session = await this.auth.loginWithSocial(
        'apple',
        code,
        this.appleNameOf(user),
      );
      this.success(res, session.accessToken);
    } catch (e) {
      this.logger.error(`[apple] callback failed: ${this.reason(e)}`);
      this.fail(res, SIGNIN_FAILED);
    }
  }

  // Apple 네이티브 SDK(iOS/Android) 로그인. 웹 redirect와 달리 JSON으로 토큰을 반환한다.
  // Body: { identityToken, nonce?, user?: { name?: { firstName, lastName } } } (plan/auth.md §5)
  // nonce는 SDK 요청에 쓴 raw 값 — 보내면 id_token과 대조된다(모바일 구현 시 필수화 예정).
  @Post('apple/native')
  async appleNative(
    @Body('identityToken') identityToken?: string,
    @Body('user') user?: { name?: AppleUserName },
    @Body('nonce') nonce?: string,
  ): Promise<AuthSession> {
    if (!identityToken) {
      throw new HttpException({ error: AUTH_ERROR_CODES.INVALID_TOKEN }, 401);
    }
    try {
      return await this.auth.loginWithAppleNative(identityToken, user, nonce);
    } catch (e) {
      this.logger.error(`[apple/native] login failed: ${this.reason(e)}`);
      throw new HttpException({ error: AUTH_ERROR_CODES.INVALID_TOKEN }, 401);
    }
  }

  // ──────────────────────── 세션 ────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request & { user: User }): User {
    return req.user;
  }

  // Stateless — 클라이언트가 토큰을 폐기한다.
  @Post('logout')
  @HttpCode(204)
  logout(): void {}

  // ──────────────────── 소셜 시작 (provider 공통 라우트) ────────────────────

  // GET /auth/:provider — provider 로그인 페이지로 redirect.
  // 브라우저 nonce 쿠키를 발급하고 같은 값을 state에 바인딩한다(login-CSRF 방어).
  // ⚠️ 라우트 매칭이 선언 순서를 따르므로 반드시 me 등 단일 세그먼트 GET 뒤에 선언한다.
  // 미지의 단일 세그먼트 GET(/auth/demo 포함)도 여기로 흡수되어 404 대신
  // SIGNIN_FAILED redirect가 된다 — 남은 GET 경로는 provider 시작뿐이라 의도된 동작.
  @Get(':provider')
  socialStart(@Param('provider') provider: string, @Res() res: Response): void {
    const social = SOCIAL_PROVIDERS.find((p) => p === provider);
    if (!social || !this.config.socialConfigured(social)) {
      return this.fail(res, SIGNIN_FAILED);
    }
    const nonce = randomUUID();
    // 이 흐름 전용 쿠키 — 다른 탭의 흐름과 이름부터 분리된다.
    res.cookie(
      OAUTH_NONCE_COOKIE_PREFIX + nonce,
      '1',
      this.nonceCookieOptions(),
    );
    res.redirect(this.auth.getAuthUrl(social, nonce));
  }

  // ──────────────────────── helpers ────────────────────────

  // state 검증(서명·provider) 후, 그 state의 흐름 쿠키가 이 브라우저에 있는지 확인하고
  // 해당 쿠키만 소진한다 — 성공/취소 공통, 병행 흐름과 무간섭(동시 콜백 안전).
  private consumeStateNonce(
    req: Request,
    res: Response,
    state: string | undefined,
    provider: SocialProvider,
  ): boolean {
    const nonce = this.tokens.stateNonce(state, provider);
    if (nonce === null) return false;
    const cookieName = OAUTH_NONCE_COOKIE_PREFIX + nonce;
    if (cookieOf(req, cookieName) === undefined) {
      return false; // 이 브라우저가 시작한 흐름이 아니거나 이미 소진됨
    }
    res.clearCookie(cookieName, this.nonceCookieOptions());
    return true;
  }

  // Apple form_post 콜백은 cross-site POST — 운영(https)에선 SameSite=None+Secure가 필수.
  // 로컬(http)은 None+Secure 쿠키가 저장되지 않으므로 Lax(Google/데모 흐름은 동작).
  private nonceCookieOptions(): CookieOptions {
    const base: CookieOptions = {
      httpOnly: true,
      path: '/auth',
      maxAge: OAUTH_STATE_TTL_MS,
    };
    return this.config.isProduction
      ? { ...base, secure: true, sameSite: 'none' }
      : { ...base, sameSite: 'lax' };
  }

  // form_post의 user 필드(JSON)에서 표시 이름 추출 — 전송 형식 처리라 컨트롤러 edge 소관.
  private appleNameOf(userData?: string): string | undefined {
    if (!userData) return undefined;
    try {
      return joinPersonName(parseAppleUserName(userData));
    } catch {
      this.logger.warn('[apple] failed to parse user data field');
      return undefined;
    }
  }

  // 로그인 성공: 토큰을 URL fragment(서버 미전송)로 실어 웹 콜백 라우트로 보낸다.
  private success(res: Response, accessToken: string): void {
    res.redirect(
      `${this.config.webAppUrl}/auth/callback#accessToken=${accessToken}`,
    );
  }

  // 로그인 실패: 코드와 함께 로그인 화면으로. 코드 없으면 조용히 복귀(취소 등).
  private fail(res: Response, code?: string): void {
    res.redirect(
      `${this.config.webAppUrl}/login${code ? `?error=${code}` : ''}`,
    );
  }

  // 사용자가 동의 화면에서 취소한 경우는 알림 없이 복귀, 그 외 provider 오류는 실패 처리.
  private cancelOrFail(res: Response, error: string): void {
    const cancelled =
      error === 'access_denied' || error === 'user_cancelled_authorize';
    this.fail(res, cancelled ? undefined : SIGNIN_FAILED);
  }

  // catch 변수를 타입 키워드 없이 받기 위한 제네릭(내부에서 instanceof로 좁힌다).
  private reason<E>(e: E): string {
    return e instanceof Error ? e.message : 'unexpected error';
  }
}
