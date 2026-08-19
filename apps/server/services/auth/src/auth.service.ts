import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  AuthSession,
  SessionInfo,
  SocialFlow,
  SocialProvider,
  User,
} from '@app/common';
import { SessionsRepository, UsersRepository } from '@app/common';
import { PrismConfigService } from '@app/config';
import { SESSION_ABSOLUTE_TTL_MS, SessionTokenService } from '@app/session';
import { AppleOAuthClient } from './oauth/apple-oauth.client';
import { GoogleOAuthClient } from './oauth/google-oauth.client';
import { KakaoOAuthClient } from './oauth/kakao-oauth.client';
import { joinPersonName, type AppleUserName } from './oauth/apple-user';
import {
  OAUTH_CLIENTS,
  type OAuthClient,
  type OAuthClientRegistry,
} from './oauth/oauth-client';
import { AuthTokenService } from './session/auth-token.service';

// 시드된 데모 계정의 고정 식별자(002 마이그레이션). 표시 이름은 저장하지 않고
// 서버가 상수로 부여한다. (plan/auth.md)
const DEMO_PROVIDER_ID = 'demo-001';
const DEMO_DISPLAY_NAME = 'Demo User';

// Apple은 표시 이름을 최초 로그인에만 한 번 준다 — 이후 세션엔 없어 일반 라벨로 대체.
const FALLBACK_DISPLAY_NAME = 'Member';

// 갱신 결과 — 실패의 종류에 따라 컨트롤러의 대응이 다르다.
//  - rotated:        새 세션 값. 쿠키를 갈아 끼운다
//  - reuse-detected: 이미 쓴 자격증명이 다시 왔다. 세션은 폐기됐고 쿠키도 정리해야 한다
//  - failed:         그 밖의 실패. **쿠키를 건드리지 않는다**(탭 경합 보호)
export type RefreshResult =
  | { status: 'rotated'; session: AuthSession }
  | { status: 'reuse-detected' }
  | { status: 'failed' };

// 로그인 오케스트레이션 전담 — provider 검증 → 사용자 upsert → 세션 발급의 흐름만 담는다.
// (세션 토큰은 @app/session, OAuth state는 AuthTokenService, 설정 판단은 컨트롤러가 직접)
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    @Inject(OAUTH_CLIENTS) private readonly clients: OAuthClientRegistry,
    // native 로그인(토큰 직접 검증)은 provider별 프로토콜이 달라 각 클라이언트를 별도 주입한다
    // (레지스트리의 OAuthClient 인터페이스에는 없는 검증 메서드를 쓰기 때문).
    private readonly apple: AppleOAuthClient,
    private readonly google: GoogleOAuthClient,
    private readonly kakao: KakaoOAuthClient,
    private readonly tokens: SessionTokenService,
    // OAuth state 서명은 이 서비스 전용 토큰이라 별도 주입(같은 키, 다른 typ).
    private readonly state: AuthTokenService,
    // 세션 수명은 배포 환경이 정한다(PRISM_JWT_*_EXPIRES_IN).
    private readonly config: PrismConfigService,
  ) {}

  // ───────────────────────── 데모 ─────────────────────────

  // 시드된 데모 계정을 조회해(upsert는 기존 행을 그대로 돌려준다) 세션을 발급한다.
  // 예전에는 하드코딩된 UUID 상수를 썼는데, 그 값이 실제 시드 행의 id와 달라
  // 데모 세션이 존재하지 않는 사용자를 가리키고 있었다.
  async issueDemoSession(): Promise<AuthSession> {
    const record = await this.users.upsert('demo', DEMO_PROVIDER_ID);
    return this.issueSession(
      record.id,
      record.provider,
      record.createdAt,
      DEMO_DISPLAY_NAME,
    );
  }

  // ──────────────────────── 소셜 OAuth (provider 공통 경로) ────────────────────────

  // provider 로그인 페이지로 보낼 authorization URL.
  // state는 브라우저 nonce·provider·flow에 바인딩된다(CSRF 방어 — AuthTokenService 참고).
  getAuthUrl(
    provider: SocialProvider,
    nonce: string,
    flow: SocialFlow,
  ): string {
    return this.clientOf(provider).generateAuthUrl(
      this.state.buildState(provider, nonce, flow),
    );
  }

  // 콜백 공통 처리: code 교환·검증 → 사용자 upsert → 세션 발급.
  // displayName 인자는 provider별 채널(Apple form_post user 필드 등)에서 온 값 —
  // 없으면 provider 프로필의 이름(Google userinfo 등)으로 폴백한다.
  async loginWithSocial(
    provider: SocialProvider,
    code: string,
    displayName?: string,
  ): Promise<AuthSession> {
    const profile = await this.clientOf(provider).exchangeCode(code);
    return this.issueSocialSession(
      provider,
      profile.sub,
      displayName ?? profile.displayName,
    );
  }

  private clientOf(provider: SocialProvider): OAuthClient {
    const client = this.clients.get(provider);
    // 레지스트리 미등록은 배선 누락(프로그래밍 오류) — 부팅 후 첫 사용에서 드러난다.
    if (!client) throw new Error(`OAuth client not registered: ${provider}`);
    return client;
  }

  // ──────────────────────── 네이티브(모바일 SDK) 경로 ────────────────────────
  //
  // 모바일 앱은 웹 redirect 대신 provider 네이티브 SDK로 토큰을 받아 서버에 POST한다.
  // 웹 흐름의 커스텀 스킴/앱링크 redirect가 다른 앱(구글 계열 등)에 가로채여 앱으로
  // 돌아오지 못하는 문제를 피한다. 서버는 받은 토큰을 provider 프로토콜대로 검증하고
  // 세션(AuthSession)을 발급한다 — 자격증명을 body로 돌려주는 유일한 경로다.

  // Apple 네이티브(iOS/Android SDK) 로그인: code 교환 없이 identityToken을 직접 검증.
  // nonce는 클라이언트가 보낸 raw 값 — 토큰의 nonce 클레임과 대조된다(필수: 재생 방지).
  // 이름은 최초 로그인에만 SDK가 user.name으로 준다(이후엔 없음 → fallback).
  async loginWithAppleNative(
    identityToken: string,
    nonce: string,
    user?: { name?: AppleUserName },
  ): Promise<AuthSession> {
    const { sub } = await this.apple.verifyIdentityToken(identityToken, nonce);
    return this.issueSocialSession('apple', sub, joinPersonName(user?.name));
  }

  // Google 네이티브(google_sign_in 등): id_token을 Google 공개 키로 검증(audience 대조).
  async loginWithGoogleNative(idToken: string): Promise<AuthSession> {
    const profile = await this.google.verifyIdToken(idToken);
    return this.issueSocialSession('google', profile.sub, profile.displayName);
  }

  // Kakao 네이티브(kakao_flutter_sdk 등): access token의 발급 앱(app_id)을 대조한 뒤
  // 프로필을 읽는다(Kakao access token은 불투명 문자열이라 로컬 서명 검증이 없다).
  async loginWithKakaoNative(accessToken: string): Promise<AuthSession> {
    const profile = await this.kakao.verifyAccessToken(accessToken);
    return this.issueSocialSession('kakao', profile.sub, profile.displayName);
  }

  // ──────────────────────── 세션 발급 ────────────────────────

  private async issueSocialSession(
    provider: SocialProvider,
    sub: string,
    displayName?: string,
  ): Promise<AuthSession> {
    const record = await this.users.upsert(provider, sub);
    return this.issueSession(
      record.id,
      record.provider,
      record.createdAt,
      displayName,
    );
  }

  // 세션 행을 만들고 그 id를 가리키는 토큰에 서명한다.
  // 표시 이름은 토큰이 아니라 세션 행에 담긴다 — 쿠키가 유출돼도 읽히지 않는다.
  private async issueSession(
    userId: string,
    provider: User['provider'],
    createdAt: string,
    displayName?: string,
  ): Promise<AuthSession> {
    const user: User = {
      id: userId,
      provider,
      displayName: displayName?.trim() || FALLBACK_DISPLAY_NAME,
      createdAt,
    };
    const issued = await this.sessions.create(
      randomUUID(),
      user,
      this.config.refreshTokenTtlMs,
      SESSION_ABSOLUTE_TTL_MS,
    );
    // PII·식별자 로그 금지: provider_id(sub)·표시 이름은 물론, 내부 user uuid도 남기지
    // 않는다 — uuid는 세션 간 안정적이라 로그가 활동 추적 트레일이 된다(공개 포트폴리오라
    // 리뷰어 상관관계를 피한다). 방식 파악에 provider만 남긴다.
    this.logger.log(`[${provider}] session issued`);
    return {
      accessToken: this.tokens.signSession(userId, issued.sessionId),
      refreshToken: issued.refreshCredential,
      user,
    };
  }

  // 리프레시 자격증명을 회전하고 새 액세스 토큰을 발급한다.
  //
  // 재사용이 탐지되면 리포지토리가 이미 세션을 폐기한 뒤다. 여기서는 그 사실을
  // **보안 이벤트로 남기고** 호출부에 알린다 — 자격증명이 두 곳에 존재했다는
  // 신호라, 사후에 "언제 어느 세션이 그랬는가"를 되짚을 수 있어야 한다.
  // (응답으로는 구분해 주지 않는다. 탐지됐다는 사실 자체가 공격자에게 줄 정보다)
  async refreshSession(credential: string): Promise<RefreshResult> {
    const sessionId = credential.slice(0, credential.indexOf('.'));
    const rotated = await this.sessions.rotate(
      credential,
      this.config.refreshTokenTtlMs,
    );

    if (rotated.status === 'reused') {
      // 보안 이벤트라 WARN으로 남기되, 세션 id는 싣지 않는다 — id는 refresh 자격증명의
      // 접두어이자 세션 관리 API의 식별자라, 로그에 두면 상관관계 추적에 쓰인다.
      this.logger.warn('refresh credential reused — session revoked');
      return { status: 'reuse-detected' };
    }
    if (rotated.status !== 'rotated') return { status: 'failed' };

    return {
      status: 'rotated',
      session: {
        accessToken: this.tokens.signSession(rotated.user.id, sessionId),
        refreshToken: rotated.refreshCredential,
        user: rotated.user,
      },
    };
  }

  // ──────────────────────── 폐기 ────────────────────────

  // 로그아웃 — 세션을 지우면 그 순간부터 해당 토큰은 무효다.
  async revokeSession(sessionId: string): Promise<void> {
    await this.sessions.delete(sessionId);
  }

  listSessions(userId: string): Promise<SessionInfo[]> {
    return this.sessions.listForUser(userId);
  }

  // 소유권 범위 폐기 — 내 세션이 아니면 false.
  revokeOwnedSession(userId: string, sessionId: string): Promise<boolean> {
    return this.sessions.deleteOwned(userId, sessionId);
  }

  async revokeAllSessions(userId: string): Promise<number> {
    return this.sessions.deleteAllForUser(userId);
  }
}
