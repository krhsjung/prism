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
  const usedKey = `${ns}:used`;

  beforeAll(async () => {
    redis = new IoredisService(config(url ?? ''));
    await redis.connect();
    probe = new Redis(url ?? '');
  });

  afterAll(async () => {
    await redis.del(casKey, renewKey, indexKey, usedKey);
    await redis.onModuleDestroy();
    await probe.quit();
  });

  beforeEach(async () => {
    await redis.del(casKey, renewKey, indexKey, usedKey);
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

  // 유휴 창 밀기(slideSession). 회전과 분리된 연산이라 여기서 따로 못박는다 —
  // 두 키와 인덱스가 **함께** 밀려야 목록·전체 폐기가 실제 수명과 어긋나지 않는다.
  it('밀기는 두 키와 인덱스를 함께 민다', async () => {
    await redis.setEx(casKey, 'cred', 60);
    await redis.setEx(renewKey, 'body', 60);
    const slid = await redis.slideSession({
      keys: [renewKey, casKey],
      ttlMs: 600_000,
      index: { key: indexKey, member: 'm-1' },
      minIntervalMs: 0,
    });

    expect(slid).toBe(true);
    await expectTtlNear(renewKey, 600);
    await expectTtlNear(casKey, 600);
    // score는 Redis가 자기 시계로 찍는다 — 실제 키 만료와 같은 시각이어야 한다.
    const [entry] = await redis.zRangeWithScores(indexKey);
    expect(entry?.member).toBe('m-1');
    const keyExpiresAt = Date.now() + (await probe.pttl(renewKey));
    expect(Math.abs((entry?.score ?? 0) - keyExpiresAt)).toBeLessThan(5_000);
  });

  // 하나라도 없으면 세션이 아니다(만료·폐기) — 되살리지 않는다.
  it('키가 하나라도 없으면 아무것도 밀지 않는다', async () => {
    await redis.setEx(renewKey, 'body', 60);

    const slid = await redis.slideSession({
      keys: [renewKey, casKey], // casKey는 없다
      ttlMs: 600_000,
      index: { key: indexKey, member: 'm-1' },
      minIntervalMs: 0,
    });

    expect(slid).toBe(false);
    // 남아 있던 키의 수명도 그대로여야 한다.
    await expectTtlNear(renewKey, 60);
    await expect(redis.zRangeWithScores(indexKey)).resolves.toEqual([]);
  });

  // 활동마다 미는 규칙을 그대로 두면 요청 하나에 쓰기가 셋씩 붙는다. 창이 조금밖에
  // 줄지 않았으면 건너뛴다 — 정확성이 아니라 쓰기 절약이다.
  it('창이 아직 줄지 않았으면 밀지 않는다', async () => {
    // ⚠️ 남은 수명(570초)을 요청 수명(600초)과 **다르게** 둔다. 같게 두면 실수로 민
    // 구현도 600초가 나와 통과한다 — 건너뛴 것과 민 것이 구분되지 않는다.
    await redis.setEx(casKey, 'cred', 570);
    await redis.setEx(renewKey, 'body', 570);

    const slid = await redis.slideSession({
      keys: [renewKey, casKey],
      ttlMs: 600_000,
      index: { key: indexKey, member: 'm-1' },
      minIntervalMs: 60_000, // 1분은 지나야 민다(30초밖에 안 줄었다)
    });

    expect(slid).toBe(false);
    // 570초 그대로여야 한다 — 600초면 건너뛴다면서 민 것이다.
    await expectTtlNear(renewKey, 570);
    await expectTtlNear(casKey, 570);
  });

  // ⚠️ 건너뛸 때도 **인덱스는 점검한다.** score가 없거나 어긋난 채로 두면 다음 밀기까지
  // 그 세션이 목록에서 사라진 채로 남고, 전체 폐기도 놓친다.
  it('건너뛰어도 어긋난 인덱스는 고친다', async () => {
    await redis.setEx(casKey, 'cred', 600);
    await redis.setEx(renewKey, 'body', 600);
    // 실제 수명보다 한참 이른 값이 남아 있는 상태(그대로 두면 곧 잘려 나간다).
    await redis.zAdd(indexKey, Date.now() + 5_000, 'm-1');

    const slid = await redis.slideSession({
      keys: [renewKey, casKey],
      ttlMs: 600_000,
      index: { key: indexKey, member: 'm-1' },
      minIntervalMs: 60_000,
    });

    expect(slid).toBe(false);
    const [entry] = await redis.zRangeWithScores(indexKey);
    const keyExpiresAt = Date.now() + (await probe.pttl(renewKey));
    expect(Math.abs((entry?.score ?? 0) - keyExpiresAt)).toBeLessThan(5_000);
  });

  // ⚠️ 정리도 같은 시계를 봐야 한다. 앱 시계가 앞서 있으면 아직 살아 있는 세션이
  // 목록에서 통째로 사라진다 — score를 Redis 시계로 찍어 둔 의미가 없어진다.
  it('정리 기준시각도 앱 시계가 아니라 Redis 시계를 따른다', async () => {
    const real = Date.now();
    // ⚠️ 살아 있는 것을 **먼저** 넣는다. 인덱스 키 자체의 수명은 가장 늦은 항목을 따라가므로
    // (ZADD_SCRIPT), 지난 항목만 있는 순간이 생기면 키가 통째로 만료돼 버린다.
    await redis.zAdd(indexKey, real + 600_000, 'alive'); // 10분 남은 것
    await redis.zAdd(indexKey, real - 1_000, 'gone'); // 이미 지난 것

    const skew = jest.spyOn(Date, 'now').mockReturnValue(real + 3_600_000);
    let removed: number;
    try {
      removed = await redis.pruneExpired(indexKey);
    } finally {
      skew.mockRestore();
    }

    // 앱 시계(한 시간 앞)를 쓰면 둘 다 지난 것으로 보여 2가 지워진다.
    expect(removed).toBe(1);
    await expect(redis.zRangeWithScores(indexKey)).resolves.toEqual([
      { member: 'alive', score: real + 600_000 },
    ]);
  });

  // 두 키의 수명은 각각 쓰이므로 어긋날 수 있다. 판단이 한 키만 보면, 그 키만 넉넉할 때
  // 정작 만료가 임박한 다른 키를 두고 건너뛴다.
  it('건너뛸지는 가장 적게 남은 키로 정한다', async () => {
    await redis.setEx(renewKey, 'body', 600); // 넉넉
    await redis.setEx(casKey, 'cred', 60); // 임박

    const slid = await redis.slideSession({
      keys: [renewKey, casKey],
      ttlMs: 600_000,
      index: { key: indexKey, member: 'm-1' },
      minIntervalMs: 60_000,
    });

    // 가장 적게 남은 키(60초)를 기준으로 보면 창이 이미 540초 줄었다 — 밀어야 한다.
    expect(slid).toBe(true);
    await expectTtlNear(casKey, 600);
  });

  // ⚠️ score는 **Redis 시계**로 찍혀야 한다. 앱 시계로 찍으면 두 기계의 시차만큼 실제
  // 수명과 어긋나고, 인덱스만 보는 목록·전체 폐기가 살아 있는 세션을 놓친다.
  it('score는 앱 시계가 아니라 Redis 시계를 따른다', async () => {
    await redis.setEx(casKey, 'cred', 600);
    await redis.setEx(renewKey, 'body', 600);
    // 앱 시계를 한 시간 앞으로 돌려 둔다 — 앱 시계를 쓰면 score가 그만큼 밀린다.
    const real = Date.now();
    const skew = jest.spyOn(Date, 'now').mockReturnValue(real + 3_600_000);
    try {
      await redis.slideSession({
        keys: [renewKey, casKey],
        ttlMs: 600_000,
        index: { key: indexKey, member: 'm-1' },
        minIntervalMs: 0,
      });
    } finally {
      skew.mockRestore();
    }

    const [entry] = await redis.zRangeWithScores(indexKey);
    // Redis 시계를 따랐다면 실제 지금+600초 근처다(앱 시계를 따랐다면 한 시간 뒤).
    expect(Math.abs((entry?.score ?? 0) - (real + 600_000))).toBeLessThan(
      5_000,
    );
  });

  // ⚠️ 이 갈래는 **여기서만** 검증된다. 리포지토리 스펙의 가짜 Redis는 의도를 재진술할 뿐,
  // KEEPTTL·PTTL의 실제 의미(초 절삭·비양수 반환값)를 재현하지 못한다.
  it('배경 회전은 값만 갈고 수명은 건드리지 않는다', async () => {
    await redis.setEx(casKey, 'old', 600);
    await redis.setEx(renewKey, 'body', 600);
    const before = await probe.pttl(casKey);
    const bodyBefore = await probe.pttl(renewKey);

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      // 밀지 않는 회전이라 이 값은 쓰이지 않아야 한다 — 쓰이면 수명이 한 시간으로 뛴다.
      ttlSeconds: 3_600,
      keepTtl: true,
      renewKeys: [renewKey],
    });

    expect(ok).toBe(true);
    await expect(redis.get(casKey)).resolves.toBe('new');
    // 왕복 시간만큼만 줄어야 한다. 되밀렸다면 3600초에 가깝다.
    const after = await probe.pttl(casKey);
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(before - 5_000);
    // 딸린 키(세션 본체)도 그대로다.
    const bodyAfter = await probe.pttl(renewKey);
    expect(bodyAfter).toBeLessThanOrEqual(bodyBefore);
    expect(bodyAfter).toBeGreaterThan(bodyBefore - 5_000);
  });

  // 만료가 걸려 있지 않은 키는 비정상이다. 여기서 부르는 쪽의 TTL로 떨어지면 "밀지 않겠다"던
  // 회전이 오히려 창을 가득 채운다 — **아무것도 바꾸지 않고** 실패해야 한다.
  it('수명이 없는 키의 배경 회전은 아무것도 바꾸지 않고 실패한다', async () => {
    await redis.setEx(casKey, 'old', 600);
    await probe.persist(casKey);

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      ttlSeconds: 3_600,
      keepTtl: true,
      renewKeys: [],
    });

    expect(ok).toBe(false);
    // 값도 수명도 그대로여야 한다(교체만 하고 실패로 답하는 일이 없어야 한다).
    await expect(redis.get(casKey)).resolves.toBe('old');
    await expect(probe.pttl(casKey)).resolves.toBe(-1);
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

  // ──────────────── 소비 이력 (재사용 탐지의 근거) ────────────────
  //
  // 이력이 교체와 같은 원자 구간에서 남지 않으면, 교체된 값의 재사용을 영영 탐지할 수
  // 없다. KEYS 슬롯 계산이 index 유무에 따라 달라지므로 두 조합 모두 실제로 확인한다.

  it('교체에 성공하면 소비된 값을 이력에 남긴다', async () => {
    await redis.setEx(casKey, 'old', 60);
    await redis.setEx(renewKey, 'body', 60);
    const consumedAt = Date.now();

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [renewKey],
      index: { key: indexKey, member: 'm-1', score: Date.now() + 600_000 },
      consumed: { key: usedKey, member: 'old', score: consumedAt, keep: 128 },
    });

    expect(ok).toBe(true);
    await expect(redis.zScore(usedKey, 'old')).resolves.toBe(consumedAt);
    // 이력은 세션보다 오래 살 이유가 없다.
    await expectTtlNear(usedKey, 600);
  });

  // 인덱스가 없으면 KEYS 슬롯이 하나 당겨진다 — 여기서 어긋나면 이력이 엉뚱한 키에 쌓인다.
  it('인덱스 없이 이력만 남기는 조합도 동작한다', async () => {
    await redis.setEx(casKey, 'old', 60);

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [],
      consumed: {
        key: usedKey,
        member: 'old',
        score: 1_700_000_000_000,
        keep: 128,
      },
    });

    expect(ok).toBe(true);
    await expect(redis.zScore(usedKey, 'old')).resolves.toBe(1_700_000_000_000);
  });

  it('교체에 실패하면 이력도 남지 않는다', async () => {
    await redis.setEx(casKey, 'old', 60);

    const ok = await redis.compareAndRenew({
      key: casKey,
      expected: 'wrong',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [],
      consumed: { key: usedKey, member: 'wrong', score: Date.now(), keep: 128 },
    });

    expect(ok).toBe(false);
    await expect(redis.zScore(usedKey, 'wrong')).resolves.toBeNull();
  });

  // 이력은 갱신 횟수만큼 쌓인다 — 상한이 없으면 짧은 액세스 수명 + 긴 세션 조합에서
  // 한 세션의 이력이 수만 건이 된다.
  it('이력은 최근 keep개만 남는다(오래된 쪽부터 밀려난다)', async () => {
    await redis.setEx(casKey, 'v0', 600);

    for (let i = 0; i < 5; i++) {
      await redis.compareAndRenew({
        key: casKey,
        expected: `v${i}`,
        next: `v${i + 1}`,
        ttlSeconds: 600,
        renewKeys: [],
        consumed: {
          key: usedKey,
          member: `v${i}`,
          score: 1_700_000_000_000 + i,
          keep: 3,
        },
      });
    }

    const history = await redis.zRangeWithScores(usedKey);
    expect(history.map((h) => h.member)).toEqual(['v2', 'v3', 'v4']);
  });

  // 재사용 판정이 zScore의 null 여부에 달려 있다 — "이력에 없는 값"과 "score가 0인 값"이
  // 뭉개지면 발급된 적 없는 값까지 폐기 대상이 된다(폐기 DoS).
  // (zAdd는 score를 만료 시각으로 쓰므로 0을 넣으면 키가 즉시 사라진다 — 여기서는
  //  평범한 ZADD를 쓰는 이력 경로로 score 0을 만든다)
  it('zScore: 이력에 없는 값은 null (score 0과 구분된다)', async () => {
    await redis.setEx(casKey, 'old', 60);
    await redis.compareAndRenew({
      key: casKey,
      expected: 'old',
      next: 'new',
      ttlSeconds: 600,
      renewKeys: [],
      consumed: { key: usedKey, member: 'old', score: 0, keep: 128 },
    });

    await expect(redis.zScore(usedKey, 'old')).resolves.toBe(0);
    await expect(redis.zScore(usedKey, 'absent')).resolves.toBeNull();
  });
});
