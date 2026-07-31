import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';
import {
  POSTGRES_CONFIG,
  type DatabaseClient,
  type DbParam,
  type DbResult,
  type PostgresConfig,
} from '../database.types';

// catch로 잡은 예외의 형태. throw는 무엇이든 가능하지만 pg/node가 던지는 값은
// Error 계열이고, 서버 SQL 오류의 SQLSTATE는 code 필드로 온다.
type CaughtError = Error & { code?: string };

// replica 풀과 헬스 상태. 실패한 replica는 REPLICA_RETRY_MS 동안 라운드로빈에서
// 제외했다가 재시도 후보로 복귀시킨다. 복귀 확인(probe)은 half-open으로 — 동시에
// 한 요청만 죽었던 replica를 두드리고 나머지는 master로 폴백한다.
interface ReplicaState {
  pool: Pool;
  label: string;
  healthy: boolean;
  downSince: number;
  probing: boolean;
}

// PostgreSQL 엔진. master 풀 1개 + replica 풀 N개를 관리한다.
// 생성자에선 아무것도 하지 않고, 엔진이 선택됐을 때만 DatabaseModule 팩토리가
// connect()를 호출한다 → 다른 엔진(mysql 등) 선택 시 풀이 만들어지지 않는다.
@Injectable()
export class PostgresService implements DatabaseClient, OnModuleDestroy {
  private static readonly REPLICA_RETRY_MS = 30_000;

  private readonly logger = new Logger(PostgresService.name);
  private master?: Pool;
  private replicas: ReplicaState[] = [];
  private next = 0; // replica 라운드로빈 커서

  constructor(
    @Inject(POSTGRES_CONFIG) private readonly config: PostgresConfig,
  ) {}

  // 풀 생성 + 연결 확인(SELECT 1). 팩토리가 postgres 엔진일 때만 호출한다.
  async connect(): Promise<void> {
    this.master = this.createPool(this.config.masterUrl, 'master');
    // replica ≥1은 PostgresTopology 타입이 보장한다(0개면 설정 파싱이 single로 만든다).
    this.replicas =
      this.config.mode === 'replica'
        ? this.config.replicaUrls.map((url, i) => ({
            pool: this.createPool(url, `replica[${i}]`),
            label: `replica[${i}]`,
            healthy: true,
            downSince: 0,
            probing: false,
          }))
        : [];
    this.logger.log(
      `postgres ${this.config.mode} — master + ${this.replicas.length} replica(s)`,
    );

    await this.pingMaster();
    await Promise.all(this.replicas.map((r) => this.pingReplica(r)));
  }

  // 쓰기 → master.
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: DbParam[],
  ): Promise<DbResult<T>> {
    return this.masterPool.query<T>(sql, params);
  }

  // 읽기 → healthy replica 라운드로빈. 후보가 없으면 master로 폴백.
  async read<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: DbParam[],
  ): Promise<DbResult<T>> {
    const replica = this.pickReplica();
    if (!replica) {
      return this.masterPool.query<T>(sql, params);
    }
    try {
      const result = await replica.pool.query<T>(sql, params);
      this.markUp(replica);
      return result;
    } catch (err) {
      // 연결/서버 장애가 아닌 오류(SQL 오류·쿼리 취소 등)는 replica가 살아있다는 뜻 —
      // 폴백 없이 전파한다(master에서 같은 쿼리를 재실행해 부하를 늘리지 않는다).
      if (!this.isReplicaFailure(err)) {
        this.markUp(replica);
        throw err;
      }
      this.markDown(replica, err);
      return this.masterPool.query<T>(sql, params);
    }
  }

  // master 폴백 대상(연결·서버 장애)을 allowlist로 판별한다.
  // - code 없음/5자리 아님: 네트워크 오류(ECONNREFUSED 등)·풀/드라이버 타임아웃 → 장애
  // - 08*(연결 예외) · 53*(리소스 고갈) · 57P01/02/03(셧다운·failover) → 장애
  // - 그 외 SQLSTATE(42* 문법, 23* 제약, 57014 query_canceled 등)는 쿼리 문제 → 전파
  // catch 변수는 컴파일러 설정에 따라 any/unknown이라, 제네릭으로 받아 내부에서 좁힌다.
  private isReplicaFailure<E>(err: E): boolean {
    if (!(err instanceof Error)) return true; // 비정상 throw — 가용성 우선으로 폴백
    const code = (err as CaughtError).code;
    if (typeof code !== 'string' || code.length !== 5) return true;
    const cls = code.slice(0, 2);
    return (
      cls === '08' ||
      cls === '53' ||
      code === '57P01' ||
      code === '57P02' ||
      code === '57P03'
    );
  }

  onModuleDestroy(): Promise<void> {
    const pools = [this.master, ...this.replicas.map((r) => r.pool)].filter(
      (p): p is Pool => !!p,
    );
    return Promise.all(pools.map((p) => p.end())).then(() => undefined);
  }

  // healthy replica를 라운드로빈으로 선택. down 상태는 REPLICA_RETRY_MS 경과 시
  // 재시도 후보로 복귀시키되 half-open — probe는 동시에 한 요청만, 나머지는 master로.
  // 전부 부적격이면 undefined(→ master 폴백).
  private pickReplica(): ReplicaState | undefined {
    const count = this.replicas.length;
    if (count === 0) return undefined;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const candidate = this.replicas[this.next];
      this.next = (this.next + 1) % count;
      if (!candidate) continue; // 불변식상 도달 불가(next < count) — 인덱스 접근 방어
      if (candidate.healthy) return candidate;
      if (
        !candidate.probing &&
        now - candidate.downSince >= PostgresService.REPLICA_RETRY_MS
      ) {
        candidate.probing = true; // 이 요청이 probe를 전담한다
        return candidate;
      }
    }
    return undefined;
  }

  private markUp(replica: ReplicaState): void {
    replica.probing = false;
    if (replica.healthy) return;
    replica.healthy = true;
    this.logger.log(`postgres ${replica.label} recovered`);
  }

  private markDown<E>(replica: ReplicaState, err: E): void {
    replica.probing = false;
    replica.healthy = false;
    replica.downSince = Date.now();
    this.logger.error(
      `postgres ${replica.label} failed — ${PostgresService.REPLICA_RETRY_MS}ms 동안 라운드로빈에서 제외`,
      err instanceof Error ? err.stack : String(err),
    );
  }

  private get masterPool(): Pool {
    if (!this.master) {
      throw new Error('PostgresService is not connected');
    }
    return this.master;
  }

  // master 실패는 required면 throw(부팅 실패), 아니면 로그만.
  private async pingMaster(): Promise<void> {
    try {
      await this.masterPool.query('SELECT 1');
      this.logger.log('postgres master connected');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (this.config.required) {
        throw new Error(`postgres master connection failed: ${reason}`);
      }
      this.logger.error(
        'postgres master connection failed (PRISM_DB_REQUIRED=false → 부팅 계속)',
        err instanceof Error ? err.stack : reason,
      );
    }
  }

  // replica 실패는 부팅을 막지 않는다 — down 표시 후 read()가 제외/복귀를 처리.
  private async pingReplica(replica: ReplicaState): Promise<void> {
    try {
      await replica.pool.query('SELECT 1');
      this.logger.log(`postgres ${replica.label} connected`);
    } catch (err) {
      this.markDown(replica, err);
    }
  }

  private createPool(url: string, label: string): Pool {
    const pool = new Pool({
      connectionString: url,
      // 네트워크 장애 시 연결 수립/쿼리가 무한 대기하지 않도록 상한을 둔다.
      connectionTimeoutMillis: this.config.connectTimeoutMs,
      query_timeout: this.config.queryTimeoutMs,
    });
    // idle client 오류로 프로세스가 죽지 않도록 로깅만 한다.
    pool.on('error', (err) =>
      this.logger.error(`pg ${label} pool error`, err.stack),
    );
    return pool;
  }
}
