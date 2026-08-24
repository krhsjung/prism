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

    const expiresAt = Date.now() + input.ttlSeconds * 1000;
    this.values.set(input.key, { value: input.next, expiresAt });
    for (const key of input.renewKeys) {
      const target = live(key);
      if (target) target.expiresAt = expiresAt;
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
