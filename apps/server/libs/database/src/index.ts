// @app/database — 도메인 비의존 데이터베이스 인프라 라이브러리(PostgreSQL 전용).
// forRoot(Async)로 PostgresConfig(접속 URL 기반 토폴로지) 주입.
// 리포지토리 등 도메인 코드는 두지 않는다. 엔진 확장점은 DatabaseClient + DATABASE 토큰.
export * from './database.types';
export * from './database.module';
export * from './postgres';
