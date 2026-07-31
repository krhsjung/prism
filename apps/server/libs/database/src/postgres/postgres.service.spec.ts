import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PostgresService } from './postgres.service';
import type { PostgresConfig } from '../database.types';

// pg를 mock해 실제 DB 없이 풀 옵션/헬스 추적/오류 분류 계약을 고정한다.
// (REVIEW: 풀 타임아웃 · replica 헬스 추적 · SQL/연결 오류 분류)
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  })),
}));

// jest.mock이 Pool 생성자를 jest.fn으로 바꾸므로 mock 타입으로 본다(object 경유 캐스팅).
const PoolMock = Pool as object as jest.Mock;

const MASTER_URL = 'postgres://u@master-host:5432/d';
const REPLICA_URL = 'postgres://u@replica-host:5433/d';

const SHARED = {
  required: false,
  connectTimeoutMs: 2_000,
  queryTimeoutMs: 3_000,
};

const single = (over: Partial<typeof SHARED> = {}): PostgresConfig => ({
  mode: 'single',
  masterUrl: MASTER_URL,
  ...SHARED,
  ...over,
});

const replica = (
  replicaUrls: readonly [string, ...string[]] = [REPLICA_URL],
  over: Partial<typeof SHARED> = {},
): PostgresConfig => ({
  mode: 'replica',
  masterUrl: MASTER_URL,
  replicaUrls,
  ...SHARED,
  ...over,
});

// 풀 생성 순서: master → replica[0..n]
const pools = () =>
  PoolMock.mock.results.map((r) => r.value as { query: jest.Mock });

// i번째 생성 풀(0=master, 1..=replica). 없으면 테스트 실패로 즉시 드러낸다.
const poolAt = (i: number): { query: jest.Mock } => {
  const pool = pools()[i];
  if (!pool) throw new Error(`pool[${i}] was not created`);
  return pool;
};

// connect()의 ping(SELECT 1) 호출 흔적을 지워 read/query 카운트만 세게 한다.
const clearPingCalls = () => pools().forEach((p) => p.query.mockClear());

describe('PostgresService', () => {
  beforeEach(() => {
    PoolMock.mockClear();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('풀 생성 시 접속 URL과 연결/쿼리 타임아웃을 주입한다', async () => {
    await new PostgresService(single()).connect();
    expect(PoolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: MASTER_URL,
        connectionTimeoutMillis: 2_000,
        query_timeout: 3_000,
      }),
    );
  });

  it('required=true면 master ping 실패 시 부팅 실패(throw)', async () => {
    PoolMock.mockImplementationOnce(() => ({
      query: jest.fn().mockRejectedValue(new Error('boom')),
      end: jest.fn(),
      on: jest.fn(),
    }));
    const svc = new PostgresService(single({ required: true }));
    await expect(svc.connect()).rejects.toThrow(
      'postgres master connection failed',
    );
  });

  it('required=false면 master ping 실패해도 부팅은 계속된다', async () => {
    PoolMock.mockImplementationOnce(() => ({
      query: jest.fn().mockRejectedValue(new Error('boom')),
      end: jest.fn(),
      on: jest.fn(),
    }));
    const svc = new PostgresService(single());
    await expect(svc.connect()).resolves.toBeUndefined();
  });

  it('읽기는 healthy replica들을 라운드로빈한다', async () => {
    const svc = new PostgresService(replica([REPLICA_URL, REPLICA_URL]));
    await svc.connect();
    const [master, r0, r1] = [poolAt(0), poolAt(1), poolAt(2)];
    clearPingCalls();

    await svc.read('SELECT 1');
    await svc.read('SELECT 1');
    await svc.read('SELECT 1');

    expect(r0.query).toHaveBeenCalledTimes(2);
    expect(r1.query).toHaveBeenCalledTimes(1);
    expect(master.query).not.toHaveBeenCalled();
  });

  it('SQL 오류(SQLSTATE)는 폴백 없이 전파되고 replica는 healthy 유지', async () => {
    const svc = new PostgresService(replica());
    await svc.connect();
    const [master, r0] = [poolAt(0), poolAt(1)];
    clearPingCalls();

    r0.query.mockRejectedValueOnce(
      Object.assign(new Error('relation "nope" does not exist'), {
        code: '42P01',
      }),
    );

    await expect(svc.read('SELECT * FROM nope')).rejects.toThrow(
      'does not exist',
    );
    expect(master.query).not.toHaveBeenCalled();

    // down 마킹되지 않았으므로 다음 읽기도 같은 replica로 간다.
    await svc.read('SELECT 1');
    expect(r0.query).toHaveBeenCalledTimes(2);
    expect(master.query).not.toHaveBeenCalled();
  });

  it('연결 오류는 master 폴백 + down 마킹, RETRY 경과 후 복귀한다', async () => {
    const t0 = 1_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);

    const svc = new PostgresService(replica());
    await svc.connect();
    const [master, r0] = [poolAt(0), poolAt(1)];
    clearPingCalls();

    // 연결 오류(SQLSTATE 아님) → master 폴백 + down 마킹.
    r0.query.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    );
    await svc.read('SELECT 1');
    expect(master.query).toHaveBeenCalledTimes(1);

    // down 동안엔 replica를 건너뛰고 master로만 간다.
    await svc.read('SELECT 1');
    expect(r0.query).toHaveBeenCalledTimes(1); // 최초 실패 1회뿐
    expect(master.query).toHaveBeenCalledTimes(2);

    // RETRY 경과 → 재시도 후보로 복귀, 성공하면 다시 replica가 받는다.
    now.mockReturnValue(t0 + 30_001);
    await svc.read('SELECT 1');
    await svc.read('SELECT 1');
    expect(r0.query).toHaveBeenCalledTimes(3);
    expect(master.query).toHaveBeenCalledTimes(2);
  });

  it('연결 계열 SQLSTATE(08*·57P01)는 replica 장애로 취급한다', async () => {
    const svc = new PostgresService(replica());
    await svc.connect();
    const [master, r0] = [poolAt(0), poolAt(1)];
    clearPingCalls();

    // 57P01: failover 시 admin_shutdown — 폴백 대상.
    r0.query.mockRejectedValueOnce(
      Object.assign(new Error('terminating connection'), { code: '57P01' }),
    );
    await svc.read('SELECT 1');
    expect(master.query).toHaveBeenCalledTimes(1);
  });

  it('쿼리 취소(57014)는 장애가 아니다 — 전파하고 replica 유지(master 재실행 방지)', async () => {
    const svc = new PostgresService(replica());
    await svc.connect();
    const [master, r0] = [poolAt(0), poolAt(1)];
    clearPingCalls();

    r0.query.mockRejectedValueOnce(
      Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014',
      }),
    );
    await expect(svc.read('SELECT slow')).rejects.toThrow('canceling');
    expect(master.query).not.toHaveBeenCalled();

    // replica는 계속 라운드로빈에 남는다.
    await svc.read('SELECT 1');
    expect(r0.query).toHaveBeenCalledTimes(2);
  });

  it('복귀 probe는 half-open — 동시 요청 중 한 건만 죽었던 replica를 두드린다', async () => {
    const t0 = 1_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    const svc = new PostgresService(replica());
    await svc.connect();
    const [master, r0] = [poolAt(0), poolAt(1)];
    clearPingCalls();

    // down 마킹.
    r0.query.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    );
    await svc.read('SELECT 1'); // → master(1)

    // RETRY 경과 후, probe가 응답을 기다리는 동안 두 번째 요청이 도착.
    now.mockReturnValue(t0 + 30_001);
    let rejectProbe: (e: Error) => void = () => undefined;
    r0.query.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectProbe = reject;
        }),
    );
    const probe = svc.read('SELECT 1'); // r0 probe 전담(r0 2회째)
    const other = svc.read('SELECT 1'); // probing 중 → master(2)
    await other;
    expect(r0.query).toHaveBeenCalledTimes(2);
    expect(master.query).toHaveBeenCalledTimes(2);

    rejectProbe(
      Object.assign(new Error('still down'), { code: 'ECONNREFUSED' }),
    );
    await probe; // probe 실패 → master 폴백(3)
    expect(master.query).toHaveBeenCalledTimes(3);
  });
});
