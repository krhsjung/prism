import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  REDIS_CONFIG,
  type CompareAndRenew,
  type RedisClient,
  type RedisConfig,
  type ScoredMember,
  type SlideSession,
} from '../redis.types';

// ioredis 기반 RedisClient 구현. 도메인은 RedisClient 인터페이스만 보므로
// 여기서만 드라이버를 안다(엔진 교체 시 이 파일만 바뀐다).
@Injectable()
export class IoredisService implements RedisClient, OnModuleDestroy {
  private readonly logger = new Logger(IoredisService.name);
  private client?: Redis;

  constructor(@Inject(REDIS_CONFIG) private readonly config: RedisConfig) {}

  // 부팅 시 1회. required면 연결 실패를 부팅 실패로 올린다 —
  // 세션이 여기에만 있으므로 연결 없이 뜨면 모든 인증이 실패한다.
  async connect(): Promise<void> {
    const client = new Redis(this.config.url, {
      connectTimeout: this.config.connectTimeoutMs,
      commandTimeout: this.config.commandTimeoutMs,
      // 부팅 시점에 연결 성공/실패를 명확히 알기 위해 지연 연결을 끈다.
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    // 재연결 중 발생하는 오류가 프로세스를 죽이지 않게 한다(ioredis는 error 리스너 필수).
    client.on('error', (e: Error) =>
      this.logger.warn(`redis error: ${e.message}`),
    );

    try {
      await client.connect();
      this.client = client;
      this.logger.log('redis connected');
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unexpected error';
      client.disconnect();
      if (this.config.required) {
        throw new Error(`redis connection failed: ${reason}`);
      }
      this.logger.warn(`redis unavailable (continuing): ${reason}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  // 연결 전/실패 상태에서의 명령은 즉시 실패시킨다 — 조용히 성공한 것처럼 보이면
  // 세션이 저장되지 않았는데 로그인에 성공한 것처럼 응답하게 된다.
  private get conn(): Redis {
    if (!this.client) throw new Error('redis is not connected');
    return this.client;
  }

  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    // TTL이 0 이하이면 SETEX가 오류를 낸다 — 이미 만료된 세션은 저장할 이유가 없다.
    if (ttlSeconds <= 0) return;
    await this.conn.setex(key, ttlSeconds, value);
  }

  async setKeepTtl(key: string, value: string): Promise<boolean> {
    // XX = 있을 때만. KEEPTTL = 만료 시각을 그대로 둔다.
    const result = await this.conn.set(key, value, 'KEEPTTL', 'XX');
    return result === 'OK';
  }

  get(key: string): Promise<string | null> {
    return this.conn.get(key);
  }

  getDel(key: string): Promise<string | null> {
    return this.conn.getdel(key);
  }

  del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return Promise.resolve(0);
    return this.conn.del(...keys);
  }

  // 항목을 넣고, 집합 키의 수명을 **가장 늦게 만료되는 항목**에 맞춘다.
  // score가 만료 시각이므로 마지막 항목이 사라질 때 키도 함께 사라진다 — 이게 없으면
  // 다시 찾아오지 않는 사용자의 인덱스가 영구히 남는다(아래 SCRIPT 주석 참고).
  private static readonly ZADD_SCRIPT = `
    redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
    local top = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
    if top[2] then
      redis.call('PEXPIREAT', KEYS[1], string.format('%d', math.floor(tonumber(top[2]))))
    end
  `;

  async zAdd(key: string, score: number, member: string): Promise<void> {
    await this.conn.eval(
      IoredisService.ZADD_SCRIPT,
      1,
      key,
      String(Math.floor(score)),
      member,
    );
  }

  zRem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return Promise.resolve(0);
    return this.conn.zrem(key, ...members);
  }

  zRemRangeByScore(key: string, min: number, max: number): Promise<number> {
    // ioredis의 가변 인자 오버로드는 문자열을 받는다(-inf/+inf 같은 표기 때문).
    return this.conn.zremrangebyscore(key, String(min), String(max));
  }

  // ioredis는 [member, score, member, score, ...] 평면 배열을 준다 — 쌍으로 접는다.
  async zRangeWithScores(key: string): Promise<ScoredMember[]> {
    const flat = await this.conn.zrange(key, '0', '-1', 'WITHSCORES');
    const items: ScoredMember[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const member = flat[i];
      const score = flat[i + 1];
      if (member === undefined || score === undefined) continue;
      items.push({ member, score: Number(score) });
    }
    return items;
  }

  async zScore(key: string, member: string): Promise<number | null> {
    const score = await this.conn.zscore(key, member);
    return score === null ? null : Number(score);
  }

  // 비교·교체와 딸린 갱신을 서버에서 한 번에 수행한다 — 왕복 사이에 다른 요청이
  // 끼어들 수 없고, 부분 성공(교체됐는데 갱신은 누락)도 생기지 않는다.
  //
  // 소비 이력(consumed)도 **같은 원자 구간**에서 남긴다. 교체 성공과 이력 기록이
  // 갈리면 "교체됐는데 이력엔 없는" 값이 생기고, 그 값이 나중에 제시될 때 재사용인지
  // 알 수 없게 된다 — 탐지의 근거가 사라지는 셈이다.
  //
  // KEYS[1]=대상, KEYS[2..1+renew]=함께 밀 키들, 그다음이 index·consumed 순(있을 때만).
  private static readonly CAS_SCRIPT = `
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
    local renew = tonumber(ARGV[4])
    -- 갱신 대상이 하나라도 사라졌으면 아무것도 바꾸지 않고 실패로 답한다.
    -- EXPIRE의 0을 무시하면 "교체는 됐는데 딸린 키는 없는" 상태를 성공으로 보고하게
    -- 되고, 그렇게 발급된 자격증명은 정작 쓸 수 없다(본체가 없어 인증에 실패한다).
    for i = 1, renew do
      if redis.call('EXISTS', KEYS[1 + i]) == 0 then return 0 end
    end
    local ttl = ARGV[3]
    -- 배경 회전: 값만 교체하고 **수명은 손대지 않는다**(SET ... KEEPTTL).
    --
    -- 남은 수명을 읽어 다시 써 넣지 않는 이유가 둘이다: TTL은 초 단위라 되쓰면 1초 미만이
    -- 잘려 회전할 때마다 세션이 조금씩 짧아지고, 읽은 값을 쓰는 사이의 간극도 없앨 수 없다.
    -- KEEPTTL은 그 둘을 모두 피한다 — 만료 시각이 **그대로** 남는다.
    --
    -- PTTL은 검사에만 쓴다. 양수가 아니면(0 = 1ms 미만 · -1 = 만료 없음 · -2 = 없음)
    -- **아무것도 바꾸지 않고 실패로 답한다.** 여기서 부르는 쪽이 준 TTL로 떨어지면,
    -- 밀지 않겠다던 회전이 만료 직전에 오히려 창을 가득 채운다(경계에서 버그가 되살아난다).
    local keepTtl = ARGV[10] == '1'
    local pttl = nil
    if keepTtl then
      pttl = redis.call('PTTL', KEYS[1])
      if not pttl or pttl <= 0 then return 0 end
      redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
    else
      redis.call('SET', KEYS[1], ARGV[2], 'EX', ttl)
    end
    for i = 1, renew do
      -- 배경 회전은 딸린 키(세션 본체)의 수명도 그대로 둔다. 존재 확인은 위에서 이미 했다.
      if not keepTtl then redis.call('EXPIRE', KEYS[1 + i], ttl) end
    end
    local slot = 1 + renew
    if ARGV[5] ~= '' then
      slot = slot + 1
      local index = KEYS[slot]
      redis.call('ZADD', index, ARGV[6], ARGV[5])
      -- zAdd와 같은 이유로 집합 키의 수명도 마지막 항목에 맞춘다.
      local top = redis.call('ZRANGE', index, -1, -1, 'WITHSCORES')
      if top[2] then
        redis.call('PEXPIREAT', index, string.format('%d', math.floor(tonumber(top[2]))))
      end
    end
    if ARGV[7] ~= '' then
      slot = slot + 1
      local consumed = KEYS[slot]
      redis.call('ZADD', consumed, ARGV[8], ARGV[7])
      -- 최근 keep개만 남긴다. 이력은 세션이 사는 동안 갱신 횟수만큼 쌓이므로,
      -- 짧은 액세스 수명 + 긴 세션 조합에서 한 세션의 이력이 수만 건이 될 수 있다.
      local keep = tonumber(ARGV[9])
      if keep > 0 then
        redis.call('ZREMRANGEBYRANK', consumed, 0, -1 - keep)
      end
      -- 이력은 세션보다 오래 살 이유가 없다. 배경 회전에서는 방금 읽은 남은 수명에 맞춘다.
      -- ⚠️ 이 블록에는 이미 keep(이력 보관 개수)이 있다. 이름이 겹치면 가려지고,
      -- Lua에서 숫자는 0도 참이라 조건이 늘 성립해 엉뚱한 가지를 탄다(실제로 그랬다).
      -- (이 스크립트는 TS 템플릿 리터럴 안이라 주석에도 백틱을 쓸 수 없다)
      if keepTtl then
        redis.call('PEXPIRE', consumed, pttl)
      else
        redis.call('EXPIRE', consumed, ttl)
      end
    end
    return 1
  `;

  // 유휴 창 밀기. 세 가지가 **한 번에** 일어나야 한다 — 두 키의 수명과 인덱스 score가
  // 갈리면, 살아 있는데 목록에 없거나(전체 폐기가 놓친다) 목록에는 있는데 죽은 세션이 된다.
  private static readonly SLIDE_SCRIPT = `
    local count = tonumber(ARGV[3])
    -- 하나라도 없으면 세션이 아니다(만료·폐기) — 되살리지 않는다.
    for i = 1, count do
      if redis.call('EXISTS', KEYS[i]) == 0 then return 0 end
    end
    local ttl = tonumber(ARGV[1])
    -- 너무 잦은 쓰기를 막는다: 창이 아직 그만큼 줄지 않았으면 건너뛴다.
    --
    -- 판단은 **가장 적게 남은 키**를 기준으로 한다. 키 하나만 보면 그 키만 넉넉할 때
    -- 건너뛰게 되는데, 정작 만료가 임박한 것은 다른 키다(둘의 수명은 각각 쓰였으므로
    -- 어긋날 수 있다).
    local shortest = nil
    for i = 1, count do
      local remaining = redis.call('PTTL', KEYS[i])
      if remaining > 0 and (shortest == nil or remaining < shortest) then
        shortest = remaining
      end
    end
    -- score(만료 시각)는 **Redis 시계**로 찍는다 — 앱 시계로 받으면 왕복 시간만큼
    -- 실제 키 수명보다 이르게 남아, 그 틈에 목록·전체 폐기가 살아 있는 세션을 놓친다.
    local now = redis.call('TIME')
    local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
    local index = KEYS[count + 1]

    if shortest ~= nil and (ttl - shortest) < tonumber(ARGV[4]) then
      -- 밀지는 않지만 **인덱스는 점검한다.** score가 없거나 실제 수명과 어긋나 있으면,
      -- 다음 밀기까지 그 세션은 목록에서 사라진 채로 남는다(전체 폐기도 놓친다).
      local expected = nowMs + shortest
      local current = redis.call('ZSCORE', index, ARGV[2])
      if current == false or math.abs(tonumber(current) - expected) > 1000 then
        redis.call('ZADD', index, expected, ARGV[2])
        local repaired = redis.call('ZRANGE', index, -1, -1, 'WITHSCORES')
        if repaired[2] then
          redis.call('PEXPIREAT', index, string.format('%d', math.floor(tonumber(repaired[2]))))
        end
      end
      return 0
    end

    for i = 1, count do
      redis.call('PEXPIRE', KEYS[i], ttl)
    end
    local expiresAt = nowMs + ttl
    redis.call('ZADD', index, expiresAt, ARGV[2])
    -- 집합 키의 수명도 마지막 항목에 맞춘다(zAdd·compareAndRenew와 같은 규칙).
    local top = redis.call('ZRANGE', index, -1, -1, 'WITHSCORES')
    if top[2] then
      redis.call('PEXPIREAT', index, string.format('%d', math.floor(tonumber(top[2]))))
    end
    return 1
  `;

  // 지나간 인덱스 항목을 걷어낸다. **Redis 시계**로 자른다 — score도 Redis가 찍으므로
  // 앱 시계와 섞으면 시계 차이만큼 살아 있는 항목을 지우거나 죽은 항목을 남긴다.
  private static readonly PRUNE_SCRIPT = `
    local now = redis.call('TIME')
    local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
    return redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, nowMs)
  `;

  async pruneExpired(key: string): Promise<number> {
    const removed = await this.conn.eval(IoredisService.PRUNE_SCRIPT, 1, key);
    return typeof removed === 'number' ? removed : 0;
  }

  async slideSession(input: SlideSession): Promise<boolean> {
    const keys = [...input.keys, input.index.key];
    const slid = await this.conn.eval(
      IoredisService.SLIDE_SCRIPT,
      keys.length,
      ...keys,
      String(Math.max(1, Math.ceil(input.ttlMs))),
      input.index.member,
      String(input.keys.length),
      String(Math.max(0, Math.floor(input.minIntervalMs))),
    );
    return slid === 1;
  }

  async compareAndRenew(input: CompareAndRenew): Promise<boolean> {
    const ttl = String(Math.max(1, Math.ceil(input.ttlSeconds)));
    const keys = [input.key, ...input.renewKeys];
    // 스크립트가 renew 개수 뒤에서부터 index → consumed 순으로 슬롯을 센다.
    if (input.index) keys.push(input.index.key);
    if (input.consumed) keys.push(input.consumed.key);
    // eval의 반환 타입은 스크립트에 달려 있어 정적으로 알 수 없다 — 경계에서 좁힌다.
    const swapped = await this.conn.eval(
      IoredisService.CAS_SCRIPT,
      keys.length,
      ...keys,
      input.expected,
      input.next,
      ttl,
      String(input.renewKeys.length),
      input.index?.member ?? '',
      String(input.index?.score ?? 0),
      input.consumed?.member ?? '',
      String(Math.floor(input.consumed?.score ?? 0)),
      String(input.consumed?.keep ?? 0),
      input.keepTtl ? '1' : '',
    );
    return swapped === 1;
  }

  async ping(): Promise<void> {
    await this.conn.ping();
  }
}
