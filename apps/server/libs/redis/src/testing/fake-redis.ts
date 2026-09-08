// 테스트용 인메모리 RedisClient.
//
// 명령 호출을 확인하는 mock이 아니라 **실제 동작을 재현하는 fake**다 — TTL 만료도,
// compareAndRenew의 원자성도, 정렬 집합 키의 수명도 그대로 흉내 낸다. 그래야 테스트가
// "이 명령을 불렀다"가 아니라 "이 상황에서 이렇게 동작한다"를 말한다.
// 시계는 jest fake timer를 쓴다(리포지토리도 Date.now()를 보므로 하나로 맞춘다).
//
// 세션과 presence 두 리포지토리가 이것을 공유한다 — fake가 둘이면 실제 클라이언트와
// 어긋날 수 있는 자리도 둘이 된다.
import type {
  CompareAndRenew,
  RedisClient,
  ScoredMember,
  SlideSession,
} from '../redis.types';

export class FakeRedis implements RedisClient {
  private values = new Map<string, { value: string; expiresAt: number }>();
  private zsets = new Map<string, Map<string, number>>();

  setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return Promise.resolve();
  }

  // 값만 갈고 만료 시각은 그대로 둔다(실제 Lua의 SET ... KEEPTTL XX).
  setKeepTtl(key: string, value: string): Promise<boolean> {
    const found = this.values.get(key);
    if (!found || found.expiresAt <= Date.now()) return Promise.resolve(false);
    this.values.set(key, { value, expiresAt: found.expiresAt });
    return Promise.resolve(true);
  }

  get(key: string): Promise<string | null> {
    const entry = this.values.get(key);
    if (!entry) return Promise.resolve(null);
    // TTL 만료를 재현한다 — 만료된 키는 없는 것과 같다.
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  async getDel(key: string): Promise<string | null> {
    const value = await this.get(key);
    this.values.delete(key);
    return value;
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) removed++;
      if (this.zsets.delete(key)) removed++;
    }
    return Promise.resolve(removed);
  }

  zAdd(key: string, score: number, member: string): Promise<void> {
    const set = this.zsets.get(key) ?? new Map<string, number>();
    set.set(member, score);
    this.zsets.set(key, set);
    return Promise.resolve();
  }

  zRem(key: string, ...members: string[]): Promise<number> {
    const set = this.zsets.get(key);
    if (!set) return Promise.resolve(0);
    let removed = 0;
    for (const m of members) if (set.delete(m)) removed++;
    return Promise.resolve(removed);
  }

  zRemRangeByScore(key: string, min: number, max: number): Promise<number> {
    const set = this.zsets.get(key);
    if (!set) return Promise.resolve(0);
    let removed = 0;
    for (const [member, score] of [...set]) {
      if (score >= min && score <= max) {
        set.delete(member);
        removed++;
      }
    }
    return Promise.resolve(removed);
  }

  zRangeWithScores(key: string): Promise<ScoredMember[]> {
    const set = this.zsets.get(key);
    if (!set) return Promise.resolve([]);
    return Promise.resolve(
      [...set]
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => a.score - b.score),
    );
  }

  zScore(key: string, member: string): Promise<number | null> {
    return Promise.resolve(this.zsets.get(key)?.get(member) ?? null);
  }

  // 실제 구현은 단일 Lua라 전부 성공하거나 아무것도 안 한다 — 그 성질을 재현한다.
  // 지나간 항목 걷어내기 — 가짜는 시계가 하나뿐이라 Date.now()가 곧 Redis 시계다.
  pruneExpired(key: string): Promise<number> {
    return this.zRemRangeByScore(key, 0, Date.now());
  }

  // 유휴 창 밀기 — 실제 Lua와 같은 규칙(전부 있거나 아무것도 안 하거나).
  slideSession(input: SlideSession): Promise<boolean> {
    const live = (key: string) => {
      const entry = this.values.get(key);
      return entry && entry.expiresAt > Date.now() ? entry : undefined;
    };
    const targets = input.keys.map(live);
    if (targets.some((entry) => !entry)) return Promise.resolve(false);

    // 창이 아직 그만큼 줄지 않았으면 건너뛴다(쓰기 절약). 판단은 **가장 적게 남은 키**로.
    const shortest = Math.min(
      ...targets.map((entry) => (entry?.expiresAt ?? 0) - Date.now()),
    );
    if (shortest > 0 && input.ttlMs - shortest < input.minIntervalMs) {
      // 밀지 않아도 인덱스는 점검한다(실제 스크립트와 같은 규칙).
      const set = this.zsets.get(input.index.key) ?? new Map<string, number>();
      const expected = Date.now() + shortest;
      const current = set.get(input.index.member);
      if (current === undefined || Math.abs(current - expected) > 1000) {
        set.set(input.index.member, expected);
        this.zsets.set(input.index.key, set);
      }
      return Promise.resolve(false);
    }

    const expiresAt = Date.now() + input.ttlMs;
    for (const entry of targets) if (entry) entry.expiresAt = expiresAt;
    const set = this.zsets.get(input.index.key) ?? new Map<string, number>();
    // score도 실제 만료와 같은 시각이다(실제 스크립트는 Redis 시계로 찍는다).
    set.set(input.index.member, expiresAt);
    this.zsets.set(input.index.key, set);
    return Promise.resolve(true);
  }

  compareAndRenew(input: CompareAndRenew): Promise<boolean> {
    const entry = this.values.get(input.key);
    const current =
      entry && entry.expiresAt > Date.now() ? entry.value : undefined;
    if (current !== input.expected) return Promise.resolve(false);

    // 실제 Lua와 같이, 갱신 대상이 하나라도 없으면 아무것도 바꾸지 않고 실패한다.
    const live = (key: string) => {
      const target = this.values.get(key);
      return target && target.expiresAt > Date.now() ? target : undefined;
    };
    if (input.renewKeys.some((key) => !live(key)))
      return Promise.resolve(false);

    // 배경 회전(keepTtl)은 값만 갈고 **수명은 손대지 않는다**(실제 Lua의 SET ... KEEPTTL).
    //
    // 남은 수명이 양수가 아니면 아무것도 바꾸지 않고 실패한다 — 만료 직전(1ms 미만)이나
    // 만료가 걸려 있지 않은 비정상 키에서 부르는 쪽의 TTL로 떨어지면, 밀지 않겠다던 회전이
    // 오히려 창을 가득 채운다. 실제 스크립트가 PTTL로 같은 검사를 한다.
    if (input.keepTtl) {
      const remaining = (entry?.expiresAt ?? 0) - Date.now();
      if (remaining <= 0) return Promise.resolve(false);
      // 값만 바꾼다. 딸린 키(세션 본체)의 수명도 그대로 둔다.
      this.values.set(input.key, {
        value: input.next,
        expiresAt: entry!.expiresAt,
      });
    } else {
      const expiresAt = Date.now() + input.ttlSeconds * 1000;
      this.values.set(input.key, { value: input.next, expiresAt });
      for (const key of input.renewKeys) {
        const target = live(key);
        if (target) target.expiresAt = expiresAt;
      }
    }
    if (input.index) {
      const set = this.zsets.get(input.index.key) ?? new Map<string, number>();
      set.set(input.index.member, input.index.score);
      this.zsets.set(input.index.key, set);
    }
    // 소비 이력도 같은 원자 구간에서 남는다 — 교체와 기록이 갈리면 재사용을 탐지할 수 없다.
    if (input.consumed) {
      const { key, member, score, keep } = input.consumed;
      const set = this.zsets.get(key) ?? new Map<string, number>();
      set.set(member, score);
      // ZREMRANGEBYRANK와 같이 오래된 쪽부터 잘라 최근 keep개만 남긴다.
      const excess = set.size - keep;
      if (keep > 0 && excess > 0) {
        const oldest = [...set]
          .sort((a, b) => a[1] - b[1])
          .slice(0, excess)
          .map(([m]) => m);
        for (const m of oldest) set.delete(m);
      }
      this.zsets.set(key, set);
    }
    return Promise.resolve(true);
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }

  // 인덱스 상태를 직접 들여다보기 위한 테스트 전용 접근자.
  indexSize(key: string): number {
    return this.zsets.get(key)?.size ?? 0;
  }

  // 저장된 원문을 들여다보고 바꿔 끼운다 — "예전 형식으로 저장된 세션"을 재현할 때 쓴다.
  dump(key: string): string | null {
    return this.values.get(key)?.value ?? null;
  }

  load(key: string, value: string): void {
    const entry = this.values.get(key);
    if (entry) entry.value = value;
  }
}
