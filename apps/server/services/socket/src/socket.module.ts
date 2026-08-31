import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismConfigModule, PrismConfigService } from '@app/config';
import { RedisModule } from '@app/redis';
import { JwtAuthGuard, SessionModule } from '@app/session';
import { AppController } from './app.controller';
import { CallGateway } from './call.gateway';
import { ConnectionRegistry } from './connection-registry';
import { PrismSocketServer } from './socket.server';
import { SessionPresenceGateway } from './session-presence.gateway';

// 세션 소켓 서비스 — 연결을 붙들고 presence를 쓰며, 구성이 바뀌면 알린다.
//
// **Postgres를 구성하지 않는다.** 세션 검증은 Redis만 보고(@app/common의 SessionsModule /
// UsersModule 분리), 이 서비스는 사용자 행을 조회할 일이 없다.
//
// ⚠️ HTTP 라우트는 여기서도 **기본이 보호**다(APP_GUARD). 프로브 경로만 @Public()으로
// 열려 있고, 그 사실이 코드에 드러난다. 소켓 쪽 인증은 가드가 아니라
// PrismSocketServer가 SessionAuthenticator에 직접 묻는다 — 가드는 HTTP 전용이다.
@Module({
  imports: [
    PrismConfigModule,
    RedisModule.forRootAsync({
      inject: [PrismConfigService],
      useFactory: (config: PrismConfigService) => config.redisConfig,
    }),
    SessionModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    ConnectionRegistry,
    SessionPresenceGateway,
    CallGateway,
    PrismSocketServer,
  ],
})
export class SocketModule {}
