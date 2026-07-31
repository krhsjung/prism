import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthSession, SocialProvider, User } from '@app/common';
import { UsersRepository } from '@app/common';
import { AppleOAuthClient } from './oauth/apple-oauth.client';
import { joinPersonName, type AppleUserName } from './oauth/apple-user';
import {
  OAUTH_CLIENTS,
  type OAuthClient,
  type OAuthClientRegistry,
} from './oauth/oauth-client';
import { AuthTokenService } from './session/auth-token.service';

// 시드된 데모 계정(provider='demo', provider_id='demo-001')에 대응하는 세션 정체성.
// 표시 이름은 저장하지 않고 서버가 상수로 부여한다. (plan/auth.md)
const DEMO_USER: User = {
  id: '00000000-0000-7000-8000-0000000000de',
  provider: 'demo',
  displayName: 'Demo User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// Apple은 표시 이름을 최초 로그인에만 한 번 준다. 이후 세션엔 없을 수 있어 일반 라벨로 대체.
const FALLBACK_DISPLAY_NAME = 'Member';

// 로그인 오케스트레이션 전담 — provider 검증 → 사용자 upsert → 세션 발급의 흐름만 담는다.
// (토큰 서명/검증은 AuthTokenService, 설정 판단은 컨트롤러가 PrismConfigService로 직접)
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    @Inject(OAUTH_CLIENTS) private readonly clients: OAuthClientRegistry,
    // native 로그인(identityToken 직접 검증)은 Apple 고유 프로토콜이라 별도 주입.
    private readonly apple: AppleOAuthClient,
    private readonly tokens: AuthTokenService,
  ) {}

  // ───────────────────────── 데모 ─────────────────────────

  issueDemoSession(): AuthSession {
    return { accessToken: this.tokens.signSession(DEMO_USER), user: DEMO_USER };
  }

  // ──────────────────────── 소셜 OAuth (provider 공통 경로) ────────────────────────

  // provider 로그인 페이지로 보낼 authorization URL.
  // state는 브라우저 nonce·provider에 바인딩된다(CSRF 방어 — AuthTokenService 참고).
  getAuthUrl(provider: SocialProvider, nonce: string): string {
    return this.clientOf(provider).generateAuthUrl(
      this.tokens.buildState(provider, nonce),
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
  // nonce는 클라이언트가 보낸 raw 값 — 토큰의 nonce 클레임과 대조된다(재사용 방지).
  // 이름은 최초 로그인에만 SDK가 user.name으로 준다(이후엔 없음 → fallback).
  async loginWithAppleNative(
    identityToken: string,
    user?: { name?: AppleUserName },
    nonce?: string,
  ): Promise<AuthSession> {
    const { sub } = await this.apple.verifyIdentityToken(identityToken, nonce);
    return this.issueSocialSession('apple', sub, joinPersonName(user?.name));
  }

  private async issueSocialSession(
    provider: SocialProvider,
    sub: string,
    displayName?: string,
  ): Promise<AuthSession> {
    const record = await this.users.upsert(provider, sub);
    const user: User = {
      id: record.id,
      provider: record.provider,
      displayName: displayName?.trim() || FALLBACK_DISPLAY_NAME,
      createdAt: record.createdAt,
    };
    // PII 로그 금지: provider_id(sub)·표시 이름은 남기지 않고 내부 id만 기록.
    this.logger.log(`[${provider}] session issued for user ${record.id}`);
    return { accessToken: this.tokens.signSession(user), user };
  }
}
