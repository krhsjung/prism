import { Injectable } from '@nestjs/common';
import type { SocialProvider } from '@app/common';
import type { PostgresConfig } from '@app/database';
import { loadAppConfig, type AppConfig } from './app-config';
import type { AppleOAuthOptions, GoogleOAuthOptions } from './oauth-options';

// 타입드 설정 서비스 — 파싱은 전부 순수 함수(app-config.ts)에 위임하고,
// 생성 시 1회 실행한 불변 결과만 노출한다. env 형식 오류는 부팅 순간 fail-fast.
// 앱이 읽는 env는 전부 PRISM_ 접두어로 통일한다(NODE_ENV만 표준 예외).
// prism은 k8s/셸 env 주입 방식이라 .env 파일은 읽지 않는다.
@Injectable()
export class PrismConfigService {
  private readonly app: AppConfig = loadAppConfig(process.env);

  // ── 서버 ──
  get isProduction(): boolean {
    return this.app.production;
  }

  get authPort(): number {
    return this.app.http.authPort;
  }

  get apiPort(): number {
    return this.app.http.apiPort;
  }

  get corsOrigins(): string[] | undefined {
    return this.app.http.corsOrigins;
  }

  get webAppUrl(): string {
    return this.app.http.webAppUrl;
  }

  // ── JWT / 데모 ──
  get jwtSecret(): string {
    return this.app.auth.jwtSecret;
  }

  get demoEnabled(): boolean {
    return this.app.auth.demoEnabled;
  }

  // ── DB (PostgreSQL) ──
  get postgresConfig(): PostgresConfig {
    return this.app.postgres;
  }

  // ── 소셜 OAuth ──
  get googleOptions(): GoogleOAuthOptions {
    return this.app.google;
  }

  get googleConfigured(): boolean {
    const g = this.app.google;
    return Boolean(g.clientId && g.clientSecret);
  }

  get appleOptions(): AppleOAuthOptions {
    return this.app.apple;
  }

  get appleConfigured(): boolean {
    const a = this.app.apple;
    return Boolean(a.teamId && a.clientId && a.keyId && a.privateKey);
  }

  // provider 공통 경로(소셜 시작 라우트)용 판별. 새 provider 추가 시 분기도 추가.
  socialConfigured(provider: SocialProvider): boolean {
    return provider === 'google' ? this.googleConfigured : this.appleConfigured;
  }
}
