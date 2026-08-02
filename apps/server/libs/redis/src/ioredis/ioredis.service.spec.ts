import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { IoredisService } from './ioredis.service';
import type { RedisConfig } from '../redis.types';

// compareAndRenew는 Lua로 서버에서 실행되므로 **실제 Redis 없이는 검증되지 않는다**.
// 리포지토리 스펙의 메모리 구현은 의도를 재진술할 뿐 KEYS/ARGV 인코딩이나 스크립트
// 자체의 정확성을 확인하지 못한다 — 이 파일이 그 간극을 메운다.
//
// PRISM_REDIS_URL이 있을 때만 돈다(없으면 통째로 skip). 인증·격리 설정을 갖춘 실제
// 인스턴스를 가리켜야 하므로 CI 기본 실행에서는 건너뛰는 것이 맞다.
const url = process.env.PRISM_REDIS_URL;
const describeIfRedis = url ? describe : describe.skip;

const config = (redisUrl: string): RedisConfig => ({
  url: redisUrl,
  required: true,
  connectTimeoutMs: 3_000,
  commandTimeoutMs: 2_000,
});

// 인덱스 집합은 사용자별로 하나씩 영구히 쌓이던 자리다 — 항목만 만료 처리하고 키를
// 그대로 두면, 다시 찾아오지 않는 사용자의 집합을 아무도 건드리지 않아 영영 남는다.
// 키 수명이 실제로 걸리는지는 실제 Redis에서만 확인된다(PEXPIREAT는 Lua 안에 있다).
describeIfRedis('IoredisService.zAdd 인덱스 수명 (실제 Redis)', () => {
  let redis: IoredisService;
  let probe: Redis;
  const ns = `prism:spec:zadd:${process.pid}:${randomUUID()}`;
  const indexKey = `${ns}:index`;

  beforeAll(async () => {
    redis = new IoredisService(config(url ?? ''));
    await redis.connect();
    probe = new Redis(url ?? '');
  });

  afterAll(async () => {
    await redis.del(indexKey);
    await redis.onModuleDestroy();
    await probe.quit();
  });

  beforeEach(async () => {
    await redis.del(indexKey);
  });

  const ttlNear = async (seconds: number): Promise<void> => {
    const actual = await probe.ttl(indexKey);
    expect(actual).toBeLessThanOrEqual(seconds);
    expect(actual).toBeGreaterThan(seconds - 5);
  };

  it('첫 항목을 넣으면 그 만료 시각으로 키 수명이 잡힌다', async () => {
    await redis.zAdd(indexKey, Date.now() + 600_000, 'm-1');
    await ttlNear(600);
  });

  // 더 늦게 만료되는 세션이 생기면 키도 그만큼 살아 있어야 한다 —
  // 짧은 쪽에 맞추면 아직 유효한 세션이 목록·전체 폐기에서 사라진다.
  it('더 늦은 항목이 들어오면 키 수명이 늘어난다', async () => {
    await redis.zAdd(indexKey, Date.now() + 60_000, 'm-1');
    await ttlNear(60);
    await redis.zAdd(indexKey, Date.now() + 600_000, 'm-2');
    await ttlNear(600);
  });

  // 반대로 더 이른 항목이 들어왔다고 수명이 줄면 안 된다.
  it('더 이른 항목이 들어와도 키 수명이 줄지 않는다', async () => {
    await redis.zAdd(indexKey, Date.now() + 600_000, 'm-1');
    await redis.zAdd(indexKey, Date.now() + 60_000, 'm-2');
    await ttlNear(600);
  });

  it('만료가 반드시 걸린다(영구 키가 남지 않는다)', async () => {
    await redis.zAdd(indexKey, Date.now() + 600_000, 'm-1');
    // -1 = 만료 없음. 이 값이 나오면 예전의 영구 키 문제가 되살아난 것이다.
    await expect(probe.ttl(indexKey)).resolves.not.toBe(-1);
  });
});

describeIfRedis('IoredisService.compareAndRenew (실제 Redis)', () => {
  let redis: IoredisService;
  // TTL 조회는 도메인이 쓰지 않아 RedisClient에 두지 않는다 — 검증용으로만
  // 원시 연결을 하나 열어 쓴다(테스트 전용 관찰 창구).
  let probe: Redis;
  // 실행마다 유일한 접두어 — 여러 스위트가 한 Redis를 공유해도 서로를 밟지 않는다.
  // (ACL 범위가 prism:* 이므로 그 아래에 둔다)
  const ns = `prism:spec:cas:${process.pid}:${randomUUID()}`;
  const casKey = `${ns}:cred`;
  const renewKey = `${ns}:body`;
  const indexKey = `${ns}:index`;

  beforeAll(async () => {
    redis = new IoredisService(config(url ?? ''));
    await redis.connect();
    probe = new Redis(url ?? '');
  });

  afterAll(async () => {
    await redis.del(casKey, renewKey, indexKey);
    await redis.onModuleDestroy();
    await probe.quit();
  });

  beforeEach(async () => {
    await redis.del(casKey, renewKey, indexKey);
  });

  const ttlOf = (key: string): Promise<number> => probe.ttl(key);

  // 요청한 TTL이 실제로 적용됐는지 본다. ">60" 같은 느슨한 단언은 EXPIRE 누락만 잡고
  // "연장은 했는데 값이 엉뚱한" 경우를 통과시킨다. 명령 왕복 시간만큼의 오차만 허용한다.
  const expectTtlNear = async (key: string, seconds: number): Promise<void> => {
    const actual = await ttlOf(key);
    expect(actual).toBeLessThanOrEqual(seconds);
    expect(actual).toBeGreaterThan(seconds - 5);
  };

  it('값이 일치하면 교체하고 딸린 키·인덱스를 함께 갱신한다', async () => {
    await redis.setEx(casKey, 'old', 60);
    await redis.setEx(renewKey, 'body', 60);
    // score는 만료 시각이라 미래여야 한다 — 과거 값을 주면 집합이 통째로 만료 대상이 된다.
    const expiresAt = Date.now() + 600_000;

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [renewKey],
      index: { key: indexKey, member: 'm-1', score: expiresAt },
    });

    expect(ok).toBe(true);
    await expect(redis.get(casKey)).resolves.toBe('new');
    // 교체 대상과 **딸린 키 둘 다** 요청한 수명(600s)을 받아야 한다.
    // 이걸 확인하지 않으면 EXPIRE를 통째로 빼도 테스트가 통과한다(연장이 핵심인데).
    await expectTtlNear(casKey, 600);
    await expectTtlNear(renewKey, 600);
    await expect(redis.zRangeWithScores(indexKey)).resolves.toEqual([
      { member: 'm-1', score: expiresAt },
    ]);
  });

  // score가 만료 시각이라는 규약의 자연스러운 귀결 — 남은 항목이 전부 지나간 집합은
  // 통째로 사라진다. 이게 "다시 오지 않는 사용자의 인덱스가 영구히 남던" 문제를 닫는다.
  it('모든 항목이 지나간 인덱스는 키째 사라진다', async () => {
    await redis.zAdd(indexKey, Date.now() - 1_000, 'stale');
    await expect(redis.zRangeWithScores(indexKey)).resolves.toEqual([]);
  });

  it('값이 다르면 아무것도 바꾸지 않는다', async () => {
    await redis.setEx(casKey, 'old', 60);
    await redis.setEx(renewKey, 'body', 60);

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'wrong',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [renewKey],
      index: { key: indexKey, member: 'm-1', score: 1234 },
    });

    expect(ok).toBe(false);
    await expect(redis.get(casKey)).resolves.toBe('old');
    // 실패했으면 원래 수명(60s)이 그대로여야 한다 — 밀렸으면 안 된다.
    await expectTtlNear(renewKey, 60);
    await expectTtlNear(casKey, 60);
    await expect(redis.zRangeWithScores(indexKey)).resolves.toEqual([]);
  });

  // 회귀 방지 — 리뷰 4차. EXPIRE 실패를 무시하면 "교체는 됐는데 본체는 없는" 상태를
  // 성공으로 보고하게 되고, 그렇게 발급된 자격증명은 인증에 쓸 수 없다.
  it('갱신 대상 키가 없으면 실패하고 대상 값도 그대로 둔다', async () => {
    await redis.setEx(casKey, 'old', 60);
    // renewKey를 만들지 않는다 = 본체가 이미 만료된 상황.

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [renewKey],
      index: { key: indexKey, member: 'm-1', score: 1234 },
    });

    expect(ok).toBe(false);
    await expect(redis.get(casKey)).resolves.toBe('old');
    await expect(redis.zRangeWithScores(indexKey)).resolves.toEqual([]);
  });

  // index 없이 호출하는 분기(KEYS 개수가 달라진다)도 실제로 통과하는지 확인한다.
  it('인덱스 인자가 없어도 동작한다', async () => {
    await redis.setEx(casKey, 'old', 60);
    await redis.setEx(renewKey, 'body', 60);

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [renewKey],
    });

    expect(ok).toBe(true);
    await expect(redis.get(casKey)).resolves.toBe('new');
    await expectTtlNear(casKey, 600);
    await expectTtlNear(renewKey, 600);
  });

  it('갱신 대상이 없어도(renewKeys 비었을 때) 교체는 이루어진다', async () => {
    await redis.setEx(casKey, 'old', 60);

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [],
    });

    expect(ok).toBe(true);
    await expect(redis.get(casKey)).resolves.toBe('new');
  });

  // 회전은 인덱스 항목을 갱신하므로 집합 키의 수명도 함께 밀려야 한다.
  // 이게 없으면 회전으로 살아남은 세션의 인덱스가 원래 수명에 먼저 사라진다.
  it('회전이 인덱스 항목과 집합 키 수명을 함께 민다', async () => {
    await redis.setEx(casKey, 'old', 60);
    await redis.setEx(renewKey, 'body', 60);
    const soon = Date.now() + 60_000;
    await redis.zAdd(indexKey, soon, 'm-1');
    await expectTtlNear(indexKey, 60);

    const later = Date.now() + 600_000;
    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [renewKey],
      index: { key: indexKey, member: 'm-1', score: later },
    });

    expect(ok).toBe(true);
    await expectTtlNear(indexKey, 600);
  });

  it('동시에 같은 값으로 회전하면 하나만 성공한다', async () => {
    await redis.setEx(casKey, 'old', 60);
    await redis.setEx(renewKey, 'body', 60);

    const attempt = (next: string) =>
      redis.compareAndRenew({
        key: casKey,
        expected: 'old',
        next,
        ttlSeconds: 600,
        renewKeys: [renewKey],
      });

    const results = await Promise.all([attempt('a'), attempt('b')]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
