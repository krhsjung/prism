import { Module } from '@nestjs/common';
import { UsersRepository } from './users.repository';

// 사용자 저장소 — **Postgres만** 전제한다.
// 세션·presence는 Redis 쪽인 SessionsModule에 있다(나눈 이유는 그 파일 주석 참고).
//
// ⚠️ 이 모듈은 DB 모듈을 스스로 import하지 않는다: DATABASE 토큰은 앱 루트에서
// `DatabaseModule.forRoot(Async)`(전역)를 구성해야만 해석되며, 구성 없이 이 모듈만
// import하면 부팅 시 DATABASE 토큰 DI 에러로 실패한다.
// (전역 토큰 전제를 감수하는 대신, 리포지토리가 엔진/설정에 비의존으로 남는다)
@Module({
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
