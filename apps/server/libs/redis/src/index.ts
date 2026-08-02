// @app/redis — 도메인 비의존 Redis 인프라 라이브러리.
// forRoot(Async)로 RedisConfig(접속 URL)를 주입. 리포지토리 등 도메인 코드는 두지 않는다.
// 확장점은 RedisClient 인터페이스 + REDIS 토큰.
export * from './redis.types';
export * from './redis.module';
export * from './ioredis';
