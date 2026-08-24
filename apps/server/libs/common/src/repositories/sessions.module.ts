import { Module } from '@nestjs/common';
import { PresenceRepository } from './presence.repository';
import { SessionsRepository } from './sessions.repository';

// 세션 저장소 묶음 — **Redis만** 전제한다.
//
// UsersModule과 나눠 둔 이유는 필요한 인프라가 다르기 때문이다. 세션과 presence는
// Redis에만 있고 사용자 행은 Postgres에만 있는데, 하나로 묶어 두면 세션만 검증하면 되는
// 서비스(api·socket)까지 DatabaseModule과 database-url 시크릿을 지고 가게 된다.
// socket 서비스는 Postgres를 한 번도 조회하지 않는다.
//
// ⚠️ 이 모듈은 Redis 모듈을 스스로 import하지 않는다: REDIS 토큰은 앱 루트에서
// `RedisModule.forRoot(Async)`(전역)를 구성해야만 해석되며, 구성 없이 이 모듈만
// import하면 부팅 시 REDIS 토큰 DI 에러로 실패한다.
// (전역 토큰 전제를 감수하는 대신, 리포지토리가 엔진/설정에 비의존으로 남는다)
@Module({
  providers: [SessionsRepository, PresenceRepository],
  exports: [SessionsRepository, PresenceRepository],
})
export class SessionsModule {}
