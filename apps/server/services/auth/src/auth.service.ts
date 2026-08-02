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
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
} from './session/session-cookie';
import { AppleOAuthClient } from './oauth/apple-oauth.client';
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

// 로그인 오케스트레이션 전담 — provider 검증 → 사용자 upsert → 세션 발급의 흐름만 담는다.
// (토큰 서명/검증은 AuthTokenService, 설정 판단은 컨트롤러가 PrismConfigService로 직접)
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    @Inject(OAUTH_CLIENTS) private readonly clients: OAuthClientRegistry,
    // native 로그인(identityToken 직접 검증)은 Apple 고유 프로토콜이라 별도 주입.
    private readonly apple: AppleOAuthClient,
    private readonly tokens: AuthTokenService,
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
      this.tokens.buildState(provider, nonce, flow),
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

  // ──────────────────────── Apple 고유 경로 ────────────────────────

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
      SESSION_IDLE_TTL_MS,
      SESSION_ABSOLUTE_TTL_MS,
    );
    // PII 로그 금지: provider_id(sub)·표시 이름은 남기지 않고 내부 id만 기록.
    this.logger.log(`[${provider}] session issued for user ${userId}`);
    return {
      accessToken: this.tokens.signSession(userId, issued.sessionId),
      refreshToken: issued.refreshCredential,
      user,
    };
  }

  // 리프레시 자격증명을 회전하고 새 액세스 토큰을 발급한다.
  // 실패(없음·불일치·이미 회전됨·상한 초과)는 전부 null — 호출부는 재로그인을 요구한다.
  async refreshSession(credential: string): Promise<AuthSession | null> {
    const rotated = await this.sessions.rotate(credential, SESSION_IDLE_TTL_MS);
    if (!rotated) return null;
    const sessionId = credential.slice(0, credential.indexOf('.'));
    return {
      accessToken: this.tokens.signSession(rotated.user.id, sessionId),
      refreshToken: rotated.refreshCredential,
      user: rotated.user,
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
