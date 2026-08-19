import { createHash } from 'crypto';
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'jose';
import { decodeObject, decodeString, jsonBodyOf } from '@app/common';
import type { AppleOAuthOptions } from '@app/config';
import { fetchWithTimeout } from './fetch-with-timeout';
import type { OAuthClient } from './oauth-client';
import type { OAuthProfile } from './oauth-profile';

const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

// Sign in with Apple (웹 redirect, response_mode=form_post).
// Apple은 client_secret을 .p8 비공개 키로 서명한 ES256 JWT로 요구하고,
// id_token은 Apple 공개 키(JWKS)로 RS256 검증한다.
export class AppleOAuthClient implements OAuthClient {
  // JWKS 조회·캐싱·kid 매칭·키 교체 재조회·타임아웃을 jose가 전담한다.
  private readonly jwks = createRemoteJWKSet(new URL(APPLE_KEYS_URL));

  constructor(private readonly options: AppleOAuthOptions) {}

  // Apple 로그인 페이지로 보낼 authorization URL. Apple은 form_post를 권장한다.
  generateAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      response_mode: 'form_post',
      // email은 요청하지 않는다(개인정보 미저장 — iOS 네이티브 흐름과도 일치).
      // name만 받아 세션 표시 이름으로 쓰고, sub는 id_token에 늘 담겨 온다.
      scope: 'name',
      state,
    });
    return `${APPLE_AUTH_URL}?${params.toString()}`;
  }

  // authorization code → 토큰 교환 → id_token 검증 → 프로필(sub) 추출.
  // 웹 흐름의 audience는 Services ID(clientId)만 — 네이티브 토큰을 웹 경로에 끼워넣지 못한다.
  // 표시 이름은 Apple이 최초 로그인 form_post의 user 필드로만 주므로 여기서 다루지 않는다.
  async exchangeCode(code: string): Promise<OAuthProfile> {
    const idToken = await this.fetchIdToken(code);
    const { sub } = await this.verifyToken(idToken, this.options.clientId);
    return { sub };
  }

  // 네이티브 SDK(iOS/Android)의 identityToken 검증 — audience는 bundleId만.
  // 클라이언트가 raw nonce를 보내면 id_token의 nonce(SHA-256 hex)와 대조해
  // 토큰 재사용/치환을 막는다(모바일 클라이언트 구현 시 필수화 예정).
  // nonce는 필수다. 없으면 캡처된(아직 만료 전) identityToken을 그대로 재생할 수 있다 —
  // 토큰 자체는 유효하므로 서명 검증만으로는 재사용을 구분하지 못한다.
  async verifyIdentityToken(
    identityToken: string,
    nonce: string,
  ): Promise<{ sub: string }> {
    const audience = this.options.bundleId;
    if (!audience) {
      throw new Error(
        'Apple native login requires PRISM_APPLE_BUNDLE_ID to be configured',
      );
    }
    return this.verifyToken(identityToken, audience, nonce);
  }

  private async verifyToken(
    identityToken: string,
    audience: string,
    nonce?: string,
  ): Promise<{ sub: string }> {
    const token = identityToken?.trim();
    if (!token) {
      throw new Error('Apple identityToken is required');
    }

    const { payload } = await jwtVerify(token, this.jwks, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience,
    });
    if (!payload.sub) {
      throw new Error('Apple id_token missing sub');
    }
    if (nonce !== undefined) {
      const expected = createHash('sha256').update(nonce).digest('hex');
      if (payload.nonce !== expected) {
        throw new Error('Apple id_token nonce mismatch');
      }
    }
    return { sub: payload.sub };
  }

  private async fetchIdToken(code: string): Promise<string> {
    const body = new URLSearchParams({
      code,
      client_id: this.options.clientId,
      client_secret: await this.generateClientSecret(),
      redirect_uri: this.options.redirectUri,
      grant_type: 'authorization_code',
    });

    const res = await fetchWithTimeout(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Apple token exchange failed (${res.status})`);
    }

    // 외부 응답은 단언 없이 경계에서 디코딩한다.
    return decodeString(
      decodeObject(await jsonBodyOf(res), 'Apple token response').id_token,
      'Apple token response.id_token',
    );
  }

  // Apple은 client_secret을 비공개 키로 서명한 JWT로 요구한다(최대 6개월 만료).
  private async generateClientSecret(): Promise<string> {
    const key = await importPKCS8(
      this.formatPrivateKey(this.options.privateKey),
      'ES256',
    );
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.options.keyId })
      .setIssuer(this.options.teamId)
      .setSubject(this.options.clientId)
      .setAudience(APPLE_ISSUER)
      .setIssuedAt()
      .setExpirationTime('180d') // 6 months (Apple max)
      .sign(key);
  }

  // env로 주입된 .p8 키의 이스케이프된 개행(\n)을 실제 개행으로 복원.
  private formatPrivateKey(key: string): string {
    if (!key) {
      throw new Error('Apple private key is not configured');
    }
    return key.includes('\n') ? key : key.replace(/\\n/g, '\n');
  }
}
