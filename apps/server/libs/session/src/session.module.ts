import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionsModule } from '@app/common';
import { PrismConfigModule, PrismConfigService } from '@app/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionAuthenticator } from './session-authenticator';
import { SessionTokenService } from './session-token.service';

// 세션 인증 배선 — 토큰 서명/검증과 가드를 제공한다.
//
// auth 서비스는 발급까지 하고, 나머지 서비스는 검증만 한다. 그래도 배선을 하나로 두는
// 이유는 **서명 키와 수명이 갈리면 안 되기 때문**이다. 서비스마다 JwtModule을 따로
// 구성하면 한쪽 env만 바뀌었을 때 "발급은 되는데 검증은 실패하는" 상태가 된다.
//
// ⚠️ SessionsRepository(SessionsModule)는 REDIS 전역 토큰을 전제한다.
// 앱 루트에서 RedisModule.forRootAsync를 구성해야 부팅된다. Postgres는 필요 없다 —
// 세션 검증만 하는 서비스(api·socket)가 DB 없이도 뜨는 것이 이 분리의 요점이다.
@Module({
  imports: [
    PrismConfigModule,
    SessionsModule,
    JwtModule.registerAsync({
      imports: [PrismConfigModule],
      inject: [PrismConfigService],
      useFactory: (config: PrismConfigService) => ({
        secret: config.jwtSecret,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: Math.ceil(config.accessTokenTtlMs / 1000),
        },
      }),
    }),
  ],
  providers: [SessionTokenService, SessionAuthenticator, JwtAuthGuard],
  // JwtModule을 다시 내보내 auth 서비스가 OAuth state 서명에 같은 키를 쓰게 한다.
  exports: [
    SessionTokenService,
    SessionAuthenticator,
    JwtAuthGuard,
    JwtModule,
    SessionsModule,
  ],
})
export class SessionModule {}
