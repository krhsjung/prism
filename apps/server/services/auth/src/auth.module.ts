import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismConfigModule, PrismConfigService } from '@app/config';
import { ACCESS_TOKEN_TTL_MS } from './session/session-cookie';
import { DatabaseModule } from '@app/database';
import { RedisModule } from '@app/redis';
import { UsersModule } from '@app/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { WebOriginGuard } from './web-origin.guard';
import { AppleOAuthClient } from './oauth/apple-oauth.client';
import { GoogleOAuthClient } from './oauth/google-oauth.client';
import {
  OAUTH_CLIENTS,
  type OAuthClient,
  type OAuthClientRegistry,
} from './oauth/oauth-client';
import { AuthTokenService } from './session/auth-token.service';
import type { SocialProvider } from '@app/common';

// JWT 시크릿은 설정 서비스에서 주입(운영 필수).
// 액세스 토큰은 짧게 — 탈취돼도 오래 못 쓴다. 세션 자체는 리프레시로 이어진다.
@Module({
  imports: [
    PrismConfigModule,
    // 로그인 진입점 남용 방지. 인증 전 경로라 IP 기준으로 센다.
    // 짧은 창은 연타를, 긴 창은 느린 반복을 막는다(plan/auth.md 데모 레이트리밋).
    ThrottlerModule.forRoot([
      { name: 'burst', ttl: 60_000, limit: 10 },
      { name: 'sustained', ttl: 3_600_000, limit: 100 },
    ]),
    JwtModule.registerAsync({
      inject: [PrismConfigService],
      useFactory: (config: PrismConfigService) => ({
        secret: config.jwtSecret,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: ACCESS_TOKEN_TTL_MS / 1000,
        },
      }),
    }),
    // 독립 DB 라이브러리에 앱 설정을 주입(forRootAsync). 복제 토폴로지는 env가 결정.
    DatabaseModule.forRootAsync({
      inject: [PrismConfigService],
      useFactory: (config: PrismConfigService) => config.postgresConfig,
    }),
    // 세션 저장소. 만료가 본질인 데이터라 TTL이 1급인 Redis에 둔다.
    RedisModule.forRootAsync({
      inject: [PrismConfigService],
      useFactory: (config: PrismConfigService) => config.redisConfig,
    }),
    UsersModule,
  ],
  controllers: [AuthController, HealthController],
  providers: [
    AuthService,
    AuthTokenService,
    JwtAuthGuard,
    WebOriginGuard,
    // provider별 OAuth 클라이언트 — 설정 서비스에서 옵션을 받아 구성한다.
    {
      provide: GoogleOAuthClient,
      useFactory: (config: PrismConfigService) =>
        new GoogleOAuthClient(config.googleOptions),
      inject: [PrismConfigService],
    },
    {
      provide: AppleOAuthClient,
      useFactory: (config: PrismConfigService) =>
        new AppleOAuthClient(config.appleOptions),
      inject: [PrismConfigService],
    },
    // provider → 클라이언트 레지스트리. 새 provider는 여기에만 등록하면 공통 경로에 편입된다.
    {
      provide: OAUTH_CLIENTS,
      useFactory: (
        google: GoogleOAuthClient,
        apple: AppleOAuthClient,
      ): OAuthClientRegistry =>
        new Map<SocialProvider, OAuthClient>([
          ['google', google],
          ['apple', apple],
        ]),
      inject: [GoogleOAuthClient, AppleOAuthClient],
    },
  ],
})
export class AuthModule {}
