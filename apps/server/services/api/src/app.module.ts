import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismConfigModule, PrismConfigService } from '@app/config';
import { RedisModule } from '@app/redis';
import { JwtAuthGuard, SessionModule } from '@app/session';
import { AppController } from './app.controller';

// auth는 별도 앱(services/auth)으로 분리되어 독립 실행된다. 이 서비스는 세션을
// **발급하지 않고 검증만** 한다 — auth가 심은 쿠키를 같은 규칙으로 읽는다(@app/session).
//
// ⚠️ 인증은 **기본이 보호**다(APP_GUARD). 라우트마다 가드를 붙이는 방식이면
// 빠뜨린 라우트가 조용히 공개되고, 그 사실이 코드에 드러나지도 않는다 —
// "없는 것"을 리뷰에서 알아채야 하기 때문이다. 여기서는 반대로 공개가 @Public()으로
// 눈에 보이고, 새로 들어오는 도메인 엔드포인트는 아무것도 안 해도 보호된다.
//
// 인증(누구인가)과 인가(그럴 권한이 있는가)는 별개다. 리소스 소유권·역할 검사는
// 이 가드가 아니라 각 핸들러/전용 가드가 맡는다.
@Module({
  imports: [
    PrismConfigModule,
    // 세션 저장소. 가드가 매 요청 세션 행을 확인하므로 이것이 없으면 인증 자체가
    // 불가능하다(전역 토큰이라 앱 루트에서 구성해야 한다).
    //
    // **Postgres는 구성하지 않는다.** 이 서비스는 세션을 검증만 하고 사용자 행을 조회하지
    // 않는다 — 세션은 Redis에만 있다(@app/common의 SessionsModule / UsersModule 분리).
    RedisModule.forRootAsync({
      inject: [PrismConfigService],
      useFactory: (config: PrismConfigService) => config.redisConfig,
    }),
    SessionModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
