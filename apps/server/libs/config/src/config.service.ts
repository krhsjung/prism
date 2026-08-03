import { Injectable } from '@nestjs/common';
import type { SocialProvider } from '@app/common';
import type { PostgresConfig } from '@app/database';
import type { RedisConfig } from '@app/redis';
import { loadAppConfig, type AppConfig, type CookiePolicy } from './app-config';
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

  // 이 출처가 우리에게 요청을 보내도 되는가. CORS와 같은 허용 목록을 쓴다 —
  // "누가 우리에게 말을 걸 수 있나"라는 같은 질문이라 원천이 갈리면 안 된다.
  // 목록 미설정(로컬)은 전체 허용 — CORS의 origin:true와 동작을 맞춘다.
  // (운영은 PRISM_CORS_ORIGIN이 필수라 여기서 항상 목록이 존재한다)
  isAllowedOrigin(origin: string): boolean {
    const allowed = this.app.http.corsOrigins;
    return allowed === undefined || allowed.includes(origin);
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

  // 쿠키 이름을 정하는 두 축을 한 값으로 묶어 넘긴다 — 심는 쪽과 읽는 쪽이
  // 같은 판단을 쓰게 강제한다(@app/session의 CookiePolicy).
  get cookiePolicy(): CookiePolicy {
    return {
      isProduction: this.app.production,
      namespace: this.app.auth.cookieNamespace,
    };
  }

  // ── 세션 수명 ──
  // 세 값이 서로 다른 일을 한다(session-cookie.ts 참고). 앞의 둘은 env로 조정하고,
  // absolute 상한만 코드 상수로 남는다 — "무한 연장 금지"는 운영 취향이 아니라 정책이다.
  get accessTokenTtlMs(): number {
    return this.app.auth.accessTokenTtlMs;
  }

  get refreshTokenTtlMs(): number {
    return this.app.auth.refreshTokenTtlMs;
  }

  // ── DB (PostgreSQL) ──
  get postgresConfig(): PostgresConfig {
    return this.app.postgres;
  }

  // ── 세션 저장소 (Redis) ──
  get redisConfig(): RedisConfig {
    return this.app.redis;
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
