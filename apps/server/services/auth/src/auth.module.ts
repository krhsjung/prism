import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismConfigModule, PrismConfigService } from '@app/config';
import { SessionModule } from '@app/session';
import { DatabaseModule } from '@app/database';
import { RedisModule } from '@app/redis';
import { UsersModule } from '@app/common';
import { PushModule } from '@app/push';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PushNotificationService } from './push.service';
import { HealthController } from './health.controller';
import { WebOriginGuard } from './web-origin.guard';
import { AppleOAuthClient } from './oauth/apple-oauth.client';
import { GoogleOAuthClient } from './oauth/google-oauth.client';
import { KakaoOAuthClient } from './oauth/kakao-oauth.client';
import {
  OAUTH_CLIENTS,
  type OAuthClient,
  type OAuthClientRegistry,
} from './oauth/oauth-client';
import { AuthTokenService } from './session/auth-token.service';
import { NativeAuthCodeStore } from './session/native-auth-code.service';
import type { SocialProvider } from '@app/common';

// 로그인·세션 발급을 담당하는 서비스. 세션 **검증**은 @app/session이 소유하고
// 여기서는 발급과 OAuth 흐름만 더한다 — 검증 규칙이 서비스마다 갈리지 않게.
@Module({
  imports: [
    PrismConfigModule,
    // 로그인 진입점 남용 방지. 인증 전 경로라 IP 기준으로 센다.
    // 짧은 창은 연타를, 긴 창은 느린 반복을 막는다(plan/auth.md 데모 레이트리밋).
    ThrottlerModule.forRoot([
      { name: 'burst', ttl: 60_000, limit: 10 },
      { name: 'sustained', ttl: 3_600_000, limit: 100 },
    ]),
    // 세션 토큰 배선(서명 키·수명·가드)은 공유 계층이 소유한다.
    // JwtModule을 다시 내보내므로 OAuth state 서명도 같은 키를 쓴다.
    SessionModule,
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
    // FCM 전송기. socket 서비스도 같은 lib을 쓴다(통화 깨우기).
    PushModule,
  ],
  controllers: [AuthController, HealthController],
  providers: [
    AuthService,
    PushNotificationService,
    AuthTokenService,
    NativeAuthCodeStore,
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
    {
      provide: KakaoOAuthClient,
      useFactory: (config: PrismConfigService) =>
        new KakaoOAuthClient(config.kakaoOptions),
      inject: [PrismConfigService],
    },
    // provider → 클라이언트 레지스트리. 새 provider는 여기에만 등록하면 공통 경로에 편입된다.
    {
      provide: OAUTH_CLIENTS,
      useFactory: (
        google: GoogleOAuthClient,
        apple: AppleOAuthClient,
        kakao: KakaoOAuthClient,
      ): OAuthClientRegistry =>
        new Map<SocialProvider, OAuthClient>([
          ['google', google],
          ['apple', apple],
          ['kakao', kakao],
        ]),
      inject: [GoogleOAuthClient, AppleOAuthClient, KakaoOAuthClient],
    },
  ],
})
export class AuthModule {}
