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
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomBytes, randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { PrismConfigService } from '@app/config';
import { AuthService } from './auth.service';
import { WebOriginGuard } from './web-origin.guard';
import {
  AuthTokenService,
  type SocialState,
} from './session/auth-token.service';
import {
  joinPersonName,
  parseAppleUserName,
  type AppleUserName,
} from './oauth/apple-user';
import {
  AUTH_ERROR_CODES,
  LOCALE_META,
  OAUTH_MESSAGE_TYPE,
  SOCIAL_FLOWS,
  SOCIAL_PROVIDERS,
  localeFrom,
  translate,
  type AuthSession,
  type SessionListItem,
  type SessionUser,
  type SocialFlow,
  type SocialProvider,
  type User,
} from '@app/common';
import {
  JwtAuthGuard,
  SessionTokenService,
  cookieOf,
  refreshCookieName,
  refreshCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
  sessionTokenOf,
} from '@app/session';
import {
  oauthNonceCookieName,
  oauthNonceCookieOptions,
} from './oauth/oauth-cookie';

// OAuth 콜백에서 로그인 실패를 웹에 알리는 공통 코드. 웹 로그인 화면이 메시지로 매핑한다.
const SIGNIN_FAILED = AUTH_ERROR_CODES.SIGNIN_FAILED;

// 콜백 결과 — 성공이거나, 코드가 있는 실패이거나, 코드 없는 취소(조용히 복귀).
type Outcome = { ok: true } | { ok: false; code?: string };

// 스크립트로 삽입되는 JSON에서 `</script>` 조기 종료를 막는다.
// (지금 실리는 값은 전부 서버 상수라 위험이 없지만, 삽입 지점의 안전은 여기서 보장한다)
function toScriptJson(value: JsonSafe): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// 위 함수에 넣는 값의 형태 — 서버가 만든 리터럴만 허용한다.
type JsonSafe = string | { type: string; ok: boolean; error?: string };

// HTML 본문에 끼워 넣는 문자열의 이스케이프. 지금 실리는 값은 번역 문구와 서버 설정
// URL뿐이지만, 삽입 지점의 안전은 값의 출처가 아니라 이 함수가 보장한다 —
// 번역 문구는 코드가 아니라 마스터 CSV에서 오므로 코드 리뷰 밖에서 바뀔 수 있다.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    // state(OAuth 흐름) 토큰과 세션 토큰은 소유자가 다르다 — 전자는 이 서비스 전용,
    // 후자는 모든 서비스가 검증하는 공유 계층(@app/session)의 것이다.
    private readonly tokens: AuthTokenService,
    private readonly sessionTokens: SessionTokenService,
    private readonly config: PrismConfigService,
  ) {}

  // 원클릭 데모 로그인 — 외부 OAuth 없이 시드된 데모 계정으로 세션 발급.
  // 세션은 쿠키로만 전달한다. body에 토큰을 실으면 XSS가 그대로 읽어가므로
  // HttpOnly로 만든 의미가 없어진다.
  // 쿠키를 심는 요청이라 login-CSRF 대상 — 출처를 검증한다(WebOriginGuard 참고).
  @Post('demo')
  @UseGuards(ThrottlerGuard, WebOriginGuard)
  async demo(@Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    if (!this.config.demoEnabled) {
      throw new HttpException({ error: AUTH_ERROR_CODES.DEMO_DISABLED }, 503);
    }
    const session = await this.auth.issueDemoSession();
    this.setSession(res, session);
    return {
      user: session.user,
      accessTokenTtlMs: this.config.accessTokenTtlMs,
    };
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
      const cancelled = this.consumeState(req, res, state, 'google');
      return this.finish(req, res, cancelled?.flow, this.cancelOrFail(error));
    }
    const consumed = this.consumeState(req, res, state, 'google');
    if (!consumed || !code) {
      return this.finish(req, res, consumed?.flow, {
        ok: false,
        code: SIGNIN_FAILED,
      });
    }

    try {
      const session = await this.auth.loginWithSocial('google', code);
      this.setSession(res, session);
      this.finish(req, res, consumed.flow, { ok: true });
    } catch (e) {
      this.logger.error(`[google] callback failed: ${this.reason(e)}`);
      this.finish(req, res, consumed.flow, { ok: false, code: SIGNIN_FAILED });
    }
  }

  // Kakao: GET 쿼리 콜백(Google과 동일한 authorization-code 흐름).
  @Get('kakao/callback')
  async kakaoCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    if (error) {
      // 취소/오류로 끝난 흐름도 시작했던 nonce는 소진한다(state 잔존 방지).
      const cancelled = this.consumeState(req, res, state, 'kakao');
      return this.finish(req, res, cancelled?.flow, this.cancelOrFail(error));
    }
    const consumed = this.consumeState(req, res, state, 'kakao');
    if (!consumed || !code) {
      return this.finish(req, res, consumed?.flow, {
        ok: false,
        code: SIGNIN_FAILED,
      });
    }

    try {
      const session = await this.auth.loginWithSocial('kakao', code);
      this.setSession(res, session);
      this.finish(req, res, consumed.flow, { ok: true });
    } catch (e) {
      this.logger.error(`[kakao] callback failed: ${this.reason(e)}`);
      this.finish(req, res, consumed.flow, { ok: false, code: SIGNIN_FAILED });
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
      const cancelled = this.consumeState(req, res, state, 'apple');
      return this.finish(req, res, cancelled?.flow, this.cancelOrFail(error));
    }
    const consumed = this.consumeState(req, res, state, 'apple');
    if (!consumed || !code) {
      return this.finish(req, res, consumed?.flow, {
        ok: false,
        code: SIGNIN_FAILED,
      });
    }

    try {
      const session = await this.auth.loginWithSocial(
        'apple',
        code,
        this.appleNameOf(user),
      );
      this.setSession(res, session);
      this.finish(req, res, consumed.flow, { ok: true });
    } catch (e) {
      this.logger.error(`[apple] callback failed: ${this.reason(e)}`);
      this.finish(req, res, consumed.flow, { ok: false, code: SIGNIN_FAILED });
    }
  }

  // Apple 네이티브 SDK(iOS/Android) 로그인. 웹 redirect와 달리 JSON으로 토큰을 반환한다.
  // Body: { identityToken, nonce?, user?: { name?: { firstName, lastName } } } (plan/auth.md §5)
  // nonce는 SDK 요청에 쓴 raw 값이며 **필수**다 — 없으면 캡처된 identityToken을
  // 만료 전까지 그대로 재생할 수 있다(서명은 유효하므로 구분이 불가능하다).
  @Post('apple/native')
  @UseGuards(ThrottlerGuard)
  async appleNative(
    @Body('identityToken') identityToken?: string,
    @Body('nonce') nonce?: string,
    @Body('user') user?: { name?: AppleUserName },
  ): Promise<AuthSession> {
    if (!identityToken || !nonce) {
      throw new HttpException({ error: AUTH_ERROR_CODES.INVALID_TOKEN }, 401);
    }
    try {
      return await this.auth.loginWithAppleNative(identityToken, nonce, user);
    } catch (e) {
      this.logger.error(`[apple/native] login failed: ${this.reason(e)}`);
      throw new HttpException({ error: AUTH_ERROR_CODES.INVALID_TOKEN }, 401);
    }
  }

  // Google 네이티브 SDK(google_sign_in 등) 로그인. Body: { idToken } (plan/auth.md §5).
  // id_token은 Google 서명·audience로 검증되므로 nonce 없이도 우리 앱 대상 토큰만 통과한다.
  @Post('google/native')
  @UseGuards(ThrottlerGuard)
  async googleNative(
    @Body('idToken') idToken?: string,
  ): Promise<AuthSession> {
    if (!idToken) {
      throw new HttpException({ error: AUTH_ERROR_CODES.INVALID_TOKEN }, 401);
    }
    try {
      return await this.auth.loginWithGoogleNative(idToken);
    } catch (e) {
      this.logger.error(`[google/native] login failed: ${this.reason(e)}`);
      throw new HttpException({ error: AUTH_ERROR_CODES.INVALID_TOKEN }, 401);
    }
  }

  // Kakao 네이티브 SDK(kakao_flutter_sdk 등) 로그인. Body: { accessToken } (plan/auth.md §5).
  // Kakao access token은 불투명 문자열이라, 서버가 access_token_info로 발급 앱(app_id)을
  // 대조해 우리 앱 토큰인지 확인한 뒤 세션을 발급한다.
  @Post('kakao/native')
  @UseGuards(ThrottlerGuard)
  async kakaoNative(
    @Body('accessToken') accessToken?: string,
  ): Promise<AuthSession> {
    if (!accessToken) {
      throw new HttpException({ error: AUTH_ERROR_CODES.INVALID_TOKEN }, 401);
    }
    try {
      return await this.auth.loginWithKakaoNative(accessToken);
    } catch (e) {
      this.logger.error(`[kakao/native] login failed: ${this.reason(e)}`);
      throw new HttpException({ error: AUTH_ERROR_CODES.INVALID_TOKEN }, 401);
    }
  }

  // ──────────────────────── 세션 ────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request & { user: User }): SessionUser {
    // 웹이 선제 갱신 시점을 잡도록 액세스 토큰 수명을 함께 준다(HttpOnly라 exp를 못 읽는다).
    return { user: req.user, accessTokenTtlMs: this.config.accessTokenTtlMs };
  }

  // 로그아웃 = 서버 세션 폐기 + 쿠키 삭제.
  // 세션 행을 지우는 것이 본질이다 — 그래야 이미 발급된 토큰이 즉시 무효가 된다.
  // 쿠키 삭제는 브라우저 정리일 뿐이고, JS가 HttpOnly 쿠키를 못 지우므로 서버 몫이다.
  // 쿠키를 지우는 요청이라 강제 로그아웃 CSRF 대상 — 출처를 검증한다.
  //
  // ⚠️ JwtAuthGuard를 걸지 않는다. 걸면 세션이 이미 없을 때(저장소 유실·idle 만료·
  // absolute 상한 초과·다른 기기에서 전체 폐기) 401로 끊겨 **핸들러가 실행되지 않고,
  // 그래서 쿠키도 지워지지 않는다.** JS는 HttpOnly 쿠키를 못 지우므로 브라우저에는
  // 유효한 쿠키가, 서버에는 세션이 없는 상태로 굳어 로그아웃 자체가 불가능해진다.
  // 로그아웃은 인증이 필요한 조회가 아니라 멱등한 정리다 — 지울 게 없어도 성공이다.
  @Post('logout')
  @HttpCode(204)
  @UseGuards(WebOriginGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // 세션 폐기는 최선 노력 — 서명이 유효한 토큰을 들고 왔을 때만, 그 세션만 지운다.
    const token = sessionTokenOf(req, this.config.cookiePolicy);
    const sessionId = token
      ? this.sessionTokens.readSessionIdForLogout(token)
      : null;
    if (sessionId) await this.auth.revokeSession(sessionId);
    // 쿠키 삭제는 조건 없이 한다 — 여기까지 왔으면 어떤 경우에도 정리되어야 한다.
    this.clearSessionCookies(res);
  }

  // 액세스 토큰이 만료됐을 때 세션을 잇는다. 자격증명은 1회용이라 성공하면 회전된다 —
  // 같은 값을 두 번 쓰면 실패하므로, 탈취된 자격증명이 병행 사용되면 드러난다.
  // 웹은 쿠키로, 네이티브는 body로 주고받는다.
  @Post('refresh')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard, WebOriginGuard)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body('refreshToken') bodyToken?: string,
  ): Promise<AuthSession | SessionUser> {
    // 들어온 경로가 나가는 형태를 정한다: 쿠키로 왔으면 쿠키로만, body로 왔으면 body로.
    // 쿠키 요청에 토큰을 돌려주면 XSS가 ambient 쿠키로 refresh를 호출해 자격증명을
    // 그대로 빼갈 수 있다 — HttpOnly가 막으려던 바로 그 경로다.
    const credential =
      bodyToken ?? cookieOf(req, refreshCookieName(this.config.cookiePolicy));
    if (!credential) {
      throw new HttpException({ error: AUTH_ERROR_CODES.UNAUTHORIZED }, 401);
    }

    const result = await this.auth.refreshSession(credential);

    // 재사용 탐지 — 세션은 이미 폐기됐다. 여기서는 쿠키를 지우는 것이 맞다:
    // 살아 있는 세션이 없으므로 "성공한 탭의 새 자격증명"이라는 보호 대상 자체가 없고,
    // 남겨두면 죽은 쿠키로 매 요청 401을 반복하게 된다.
    if (result.status === 'reuse-detected') {
      this.clearSessionCookies(res);
      throw new HttpException({ error: AUTH_ERROR_CODES.UNAUTHORIZED }, 401);
    }

    if (result.status === 'failed') {
      // ⚠️ 여기서 쿠키를 지우지 않는다. 실패의 흔한 원인은 "다른 탭이 먼저 회전했다"인데,
      // 쿠키는 탭 간 공유라 지워버리면 성공한 탭의 새 자격증명까지 날아가 세션을 잃는다.
      // 진짜로 죽은 자격증명은 다음 요청에서 다시 401이 되고 재로그인으로 이어진다.
      throw new HttpException({ error: AUTH_ERROR_CODES.UNAUTHORIZED }, 401);
    }

    const session = result.session;
    this.setSession(res, session);
    return bodyToken
      ? session
      : { user: session.user, accessTokenTtlMs: this.config.accessTokenTtlMs };
  }

  // ──────────────────── 세션 관리 ────────────────────
  //
  // ⚠️ 아래 socialStart(`@Get(':provider')`)보다 **먼저** 선언해야 한다.
  // 라우트 매칭이 선언 순서를 따르므로 뒤에 두면 `/auth/sessions`가 provider로 흡수된다.

  // 내 세션 목록. 세션 id는 HttpOnly 쿠키 안의 토큰에만 있어 클라이언트가 알 수 없으므로,
  // 지금 요청의 세션을 서버가 isCurrent로 표시해 준다.
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async sessions(
    @Req() req: Request & { user: User; sessionId: string },
  ): Promise<SessionListItem[]> {
    const sessions = await this.auth.listSessions(req.user.id);
    return sessions.map((s) => ({ ...s, isCurrent: s.id === req.sessionId }));
  }

  // 모든 기기에서 로그아웃. 현재 세션도 포함되므로 쿠키를 정리한다.
  // ⚠️ `sessions/:id/revoke`보다 먼저 선언한다(정적 경로가 파라미터에 먹히지 않도록).
  @Post('sessions/revoke-all')
  @HttpCode(204)
  @UseGuards(WebOriginGuard, JwtAuthGuard)
  async revokeAllSessions(
    @Req() req: Request & { user: User },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.revokeAllSessions(req.user.id);
    this.clearSessionCookies(res);
  }

  // 특정 세션 폐기(다른 기기 원격 로그아웃).
  // 소유권 범위로 지운다 — 남의 세션 id를 넣어도 지워지지 않는다.
  // 존재 여부를 흘리지 않기 위해 "내 것이 아님"과 "없음"을 같은 404로 답한다.
  @Post('sessions/:id/revoke')
  @HttpCode(204)
  @UseGuards(WebOriginGuard, JwtAuthGuard)
  async revokeSession(
    @Req() req: Request & { user: User; sessionId: string },
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const revoked = await this.auth.revokeOwnedSession(req.user.id, id);
    if (!revoked) {
      throw new HttpException({ error: AUTH_ERROR_CODES.UNAUTHORIZED }, 404);
    }
    // 지금 쓰고 있는 세션을 지웠다면 이 브라우저의 쿠키도 함께 치운다.
    if (id === req.sessionId) this.clearSessionCookies(res);
  }

  // ──────────────────── 소셜 시작 (provider 공통 라우트) ────────────────────

  // GET /auth/:provider — provider 로그인 페이지로 redirect.
  // 브라우저 nonce 쿠키를 발급하고 같은 값을 state에 바인딩한다(login-CSRF 방어).
  // ⚠️ 라우트 매칭이 선언 순서를 따르므로 반드시 me 등 단일 세그먼트 GET 뒤에 선언한다.
  // 미지의 단일 세그먼트 GET(/auth/demo 포함)도 여기로 흡수되어 404 대신
  // SIGNIN_FAILED redirect가 된다 — 남은 GET 경로는 provider 시작뿐이라 의도된 동작.
  // flow는 클라이언트가 시작 시점에만 고를 수 있고, 이후엔 서명된 state로만 전달된다.
  @Get(':provider')
  @UseGuards(ThrottlerGuard)
  socialStart(
    @Req() req: Request,
    @Param('provider') provider: string,
    @Res() res: Response,
    @Query('flow') flow?: string,
  ): void {
    const social = SOCIAL_PROVIDERS.find((p) => p === provider);
    const wanted = SOCIAL_FLOWS.find((f) => f === flow) ?? 'redirect';
    if (!social || !this.config.socialConfigured(social)) {
      return this.finish(req, res, wanted, { ok: false, code: SIGNIN_FAILED });
    }
    const nonce = randomUUID();
    // 이 흐름 전용 쿠키 — 다른 탭의 흐름과 이름부터 분리된다.
    const isProd = this.config.isProduction;
    res.cookie(
      oauthNonceCookieName(nonce, this.config.cookiePolicy),
      '1',
      oauthNonceCookieOptions(isProd),
    );
    res.redirect(this.auth.getAuthUrl(social, nonce, wanted));
  }

  // ──────────────────────── helpers ────────────────────────

  // state 검증(서명·provider) 후, 그 state의 흐름 쿠키가 이 브라우저에 있는지 확인하고
  // 해당 쿠키만 소진한다 — 성공/취소 공통, 병행 흐름과 무간섭(동시 콜백 안전).
  // 반환값의 flow는 서명된 state에서 온 것이라 콜백이 신뢰할 수 있다.
  private consumeState(
    req: Request,
    res: Response,
    state: string | undefined,
    provider: SocialProvider,
  ): SocialState | null {
    const parsed = this.tokens.readState(state, provider);
    if (parsed === null) return null;
    const isProd = this.config.isProduction;
    const cookieName = oauthNonceCookieName(
      parsed.nonce,
      this.config.cookiePolicy,
    );
    if (cookieOf(req, cookieName) === undefined) {
      return null; // 이 브라우저가 시작한 흐름이 아니거나 이미 소진됨
    }
    res.clearCookie(cookieName, oauthNonceCookieOptions(isProd));
    return parsed;
  }

  // 세션 쿠키 발급 — 웹은 이 쿠키만으로 인증된다(JS는 토큰을 볼 수 없다).
  // 리프레시 자격증명도 같은 방식으로 심는다: 웹은 두 값 모두 만지지 않는다.
  private setSession(res: Response, session: AuthSession): void {
    const isProd = this.config.isProduction;
    // 두 쿠키 모두 리프레시 수명(idle 만료)을 쓴다 — 액세스 토큰이 만료된 뒤에도
    // 쿠키가 남아 있어야 서버가 세션을 알아보고 갱신을 안내할 수 있다.
    const maxAge = this.config.refreshTokenTtlMs;
    res.cookie(
      sessionCookieName(this.config.cookiePolicy),
      session.accessToken,
      sessionCookieOptions(isProd, maxAge),
    );
    res.cookie(
      refreshCookieName(this.config.cookiePolicy),
      session.refreshToken,
      refreshCookieOptions(isProd, maxAge),
    );
  }

  private clearSessionCookies(res: Response): void {
    const isProd = this.config.isProduction;
    const maxAge = this.config.refreshTokenTtlMs;
    res.clearCookie(
      sessionCookieName(this.config.cookiePolicy),
      sessionCookieOptions(isProd, maxAge),
    );
    res.clearCookie(
      refreshCookieName(this.config.cookiePolicy),
      refreshCookieOptions(isProd, maxAge),
    );
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

  // 사용자가 동의 화면에서 취소한 경우는 알림 없이 복귀, 그 외 provider 오류는 실패 처리.
  private cancelOrFail(error: string): Outcome {
    const cancelled =
      error === 'access_denied' || error === 'user_cancelled_authorize';
    return cancelled ? { ok: false } : { ok: false, code: SIGNIN_FAILED };
  }

  // 콜백 종료 — 세션 쿠키는 이미 심겼고, 여기서는 "결과를 어떻게 알릴지"만 정한다.
  // flow가 undefined면 state를 못 읽은 경우(만료·위조)라 신뢰할 정보가 없다.
  // 이때는 브라우저가 스스로 판단하게 둔다 — opener가 있으면 popup, 없으면 redirect.
  private finish(
    req: Request,
    res: Response,
    flow: SocialFlow | undefined,
    out: Outcome,
  ): void {
    if (flow === 'redirect') {
      return res.redirect(this.landingUrl(out));
    }
    this.postMessagePage(req, res, out);
  }

  // redirect 흐름의 착지 주소. 성공은 웹 콜백 라우트, 실패는 로그인 화면(+코드).
  private landingUrl(out: Outcome): string {
    const web = this.config.webAppUrl;
    if (out.ok) return `${web}/auth/callback`;
    return `${web}/login${out.code ? `?error=${out.code}` : ''}`;
  }

  // popup(또는 flow 미상) 흐름의 종료 페이지.
  // opener로 결과만 보내고 창을 닫는다 — 토큰은 실리지 않는다(세션은 쿠키에 있다).
  // targetOrigin은 서버 설정값이다 — 클라이언트가 준 origin을 쓰면 결과를 임의 사이트로
  // 흘릴 수 있어(수신자 주입) 절대 사용하지 않는다.
  //
  // 실행 가능한 인라인 스크립트를 내려보내는 민감한 지점이라, 지금 삽입되는 값이 전부
  // 서버 상수라 해도 브라우저 차원의 안전장치를 함께 둔다. 응답마다 nonce를 만들어
  // 그 스크립트 하나만 실행을 허용하고 나머지는 전부 차단한다 — 나중에 provider 오류
  // 문구 같은 외부 값을 끼워 넣게 되더라도 실행으로 이어지지 않는다.
  private postMessagePage(req: Request, res: Response, out: Outcome): void {
    const message = toScriptJson({
      type: OAUTH_MESSAGE_TYPE,
      ok: out.ok,
      ...(out.ok ? {} : out.code ? { error: out.code } : {}),
    });
    const target = toScriptJson(this.config.webAppUrl);
    const landingUrl = this.landingUrl(out);
    const landing = toScriptJson(landingUrl);
    const nonce = randomBytes(16).toString('base64');
    // 이 페이지는 서버가 직접 그리므로 언어도 서버가 정해야 한다 — 웹의 선택은
    // localStorage에 있어 다른 출처인 여기서는 읽을 수 없다. 브라우저가 요청에
    // 실어 보내는 Accept-Language가 여기서 알 수 있는 유일한 선호도다.
    const locale = localeFrom(req.headers['accept-language']);

    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    );
    // 로그인 결과 페이지는 캐시·히스토리에 남을 이유가 없다. 남으면 뒤로 가기로
    // 재실행되어 이미 소진된 흐름의 결과를 다시 opener로 보낼 수 있다.
    res.setHeader('Cache-Control', 'no-store');
    // noscript 경로: 스크립트가 막히면 창은 스스로 닫히지도, 이동하지도 못한다.
    // 빈 화면에 갇히는 대신 무슨 일이 있었는지 알리고 직접 이어갈 링크를 남긴다.
    res.type('html').send(
      `<!doctype html><html lang="${locale}" dir="${LOCALE_META[locale].dir}"><meta charset="utf-8"><title>${escapeHtml(translate(locale, 'page.signin_title'))}</title>
<noscript><p>${escapeHtml(translate(locale, 'page.noscript_notice'))}</p>
<p><a href="${escapeHtml(landingUrl)}">${escapeHtml(translate(locale, 'page.noscript_continue'))}</a></p></noscript>
<script nonce="${nonce}">
(function () {
  var opener = window.opener;
  if (opener) {
    try { opener.postMessage(${message}, ${target}); } catch (e) {}
    window.close();
    return;
  }
  // popup이 아니었다(또는 opener를 잃었다) — 일반 이동으로 처리한다.
  window.location.replace(${landing});
})();
</script>`,
    );
  }

  // catch 변수를 타입 키워드 없이 받기 위한 제네릭(내부에서 instanceof로 좁힌다).
  private reason<E>(e: E): string {
    return e instanceof Error ? e.message : 'unexpected error';
  }
}
