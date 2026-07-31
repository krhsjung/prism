// @app/database 계약 — PostgreSQL 전용(두 번째 엔진이 실제로 생기면 그때 확장한다).
// 확장점은 DatabaseClient 인터페이스와 DATABASE 토큰: 리포지토리 등 도메인 코드는
// 인터페이스에만 의존하므로, 새 엔진 구현체를 같은 토큰에 바인딩하면 도메인은 불변이다.
import type { QueryResultRow } from 'pg';

// 노드 접속 정보는 표준 접속 URL로 표현한다(12-factor DATABASE_URL,
// postgres://user[:password]@host[:port]/db — pg Pool이 connectionString으로 그대로 받는다).
// 복제 토폴로지 판별 유니온 — single엔 replica 필드 자체가 없고, replica는 최소
// 1개를 타입으로 강제한다("replica인데 standby 0개" 같은 불가능 상태를 제거).
export type PostgresTopology =
  | { mode: 'single'; masterUrl: string }
  | {
      mode: 'replica';
      masterUrl: string;
      replicaUrls: readonly [string, ...string[]];
    };

export type PostgresConfig = PostgresTopology & {
  // true면 부팅 시 master 연결 실패를 치명적으로 간주해 throw(=DB 필수).
  // false면 로그만 남기고 부팅 계속(데모 등 DB 없이 동작하는 경로 허용).
  required: boolean;
  // 네트워크 장애 시 연결 수립/쿼리 응답이 무한 대기하지 않도록 두는 상한(ms).
  connectTimeoutMs: number;
  queryTimeoutMs: number;
};

// DI 토큰: DATABASE=클라이언트, POSTGRES_CONFIG=주입된 설정 값.
export const DATABASE = Symbol('DATABASE');
export const POSTGRES_CONFIG = Symbol('POSTGRES_CONFIG');

export interface DbResult<T> {
  rows: T[];
  rowCount: number | null;
}

// 파라미터로 넘길 수 있는 값의 union. 일반 객체를 제외해 객체를 통째로 넘기는
// 실수를 컴파일 타임에 잡는다(배열은 pg의 ANY($1)용).
export type DbParam =
  | string
  | number
  | boolean
  | null
  | Date
  | Buffer
  | DbParam[];

// 도메인 코드(리포지토리)의 유일한 DB 의존점. 테스트 mock과 향후 엔진 교체의 경계.
export interface DatabaseClient {
  // 쓰기(및 강한 일관성 읽기) → master.
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: DbParam[],
  ): Promise<DbResult<T>>;

  // 읽기 → replica 라운드로빈 (replica 없으면 master).
  read<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: DbParam[],
  ): Promise<DbResult<T>>;
}
