import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismConfigModule, PrismConfigService } from '@app/config';
import { DatabaseModule } from '@app/database';
import { UsersModule } from '@app/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AppleOAuthClient } from './oauth/apple-oauth.client';
import { GoogleOAuthClient } from './oauth/google-oauth.client';
import {
  OAUTH_CLIENTS,
  type OAuthClient,
  type OAuthClientRegistry,
} from './oauth/oauth-client';
import { AuthTokenService } from './session/auth-token.service';
import type { SocialProvider } from '@app/common';

// JWT 시크릿은 설정 서비스에서 주입(운영 필수). (refresh 토큰은 v1 미지원)
@Module({
  imports: [
    PrismConfigModule,
    JwtModule.registerAsync({
      inject: [PrismConfigService],
      useFactory: (config: PrismConfigService) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256', expiresIn: '1h' },
      }),
    }),
    // 독립 DB 라이브러리에 앱 설정을 주입(forRootAsync). 복제 토폴로지는 env가 결정.
    DatabaseModule.forRootAsync({
      inject: [PrismConfigService],
      useFactory: (config: PrismConfigService) => config.postgresConfig,
    }),
    UsersModule,
  ],
  controllers: [AuthController, HealthController],
  providers: [
    AuthService,
    AuthTokenService,
    JwtAuthGuard,
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
