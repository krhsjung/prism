import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  REDIS_CONFIG,
  type CompareAndRenew,
  type RedisClient,
  type RedisConfig,
  type ScoredMember,
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

  get(key: string): Promise<string | null> {
    return this.conn.get(key);
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

  // 비교·교체와 딸린 갱신을 서버에서 한 번에 수행한다 — 왕복 사이에 다른 요청이
  // 끼어들 수 없고, 부분 성공(교체됐는데 갱신은 누락)도 생기지 않는다.
  // KEYS[1]=대상, KEYS[2..n]=함께 밀 키들, 마지막 KEYS=정렬 집합(있을 때)
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
    redis.call('SET', KEYS[1], ARGV[2], 'EX', ttl)
    for i = 1, renew do
      redis.call('EXPIRE', KEYS[1 + i], ttl)
    end
    if ARGV[5] ~= '' then
      local index = KEYS[2 + renew]
      redis.call('ZADD', index, ARGV[6], ARGV[5])
      -- zAdd와 같은 이유로 집합 키의 수명도 마지막 항목에 맞춘다.
      local top = redis.call('ZRANGE', index, -1, -1, 'WITHSCORES')
      if top[2] then
        redis.call('PEXPIREAT', index, string.format('%d', math.floor(tonumber(top[2]))))
      end
    end
    return 1
  `;

  async compareAndRenew(input: CompareAndRenew): Promise<boolean> {
    const ttl = String(Math.max(1, Math.ceil(input.ttlSeconds)));
    const keys = [input.key, ...input.renewKeys];
    if (input.index) keys.push(input.index.key);
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
    );
    return swapped === 1;
  }

  async ping(): Promise<void> {
    await this.conn.ping();
  }
}
