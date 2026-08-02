import type { CompareAndRenew, RedisClient, ScoredMember } from '@app/redis';
import { SessionsRepository } from './sessions.repository';
import type { User } from '../types/contracts';

// 메모리 구현 — 명령 호출을 확인하는 mock이 아니라 실제 동작을 재현한다.
// 시계는 jest fake timer를 쓴다(리포지토리도 Date.now()를 보므로 하나로 맞춘다).
class FakeRedis implements RedisClient {
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
    return Promise.resolve(true);
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }

  // 인덱스 상태를 직접 들여다보기 위한 테스트 전용 접근자.
  indexSize(key: string): number {
    return this.zsets.get(key)?.size ?? 0;
  }
}

const user: User = {
  id: 'u-1',
  provider: 'google',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const HOUR = 60 * 60 * 1000;
const INDEX = 'prism:user_sessions:u-1';

describe('SessionsRepository (Redis)', () => {
  let redis: FakeRedis;
  let repo: SessionsRepository;

  beforeEach(() => {
    jest.useFakeTimers();
    redis = new FakeRedis();
    repo = new SessionsRepository(redis);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const WEEK = 7 * 24 * HOUR;

  const create = (
    id: string,
    idleMs = HOUR,
    owner: User = user,
    absoluteMs = WEEK,
  ) => repo.create(id, owner, idleMs, absoluteMs);

  it('세션을 저장하고 사용자로 복원한다', async () => {
    await create('s-1');
    await expect(repo.findValid('s-1')).resolves.toEqual(user);
  });

  it('없는 세션은 null', async () => {
    await expect(repo.findValid('nope')).resolves.toBeNull();
  });

  // TTL이 만료를 처리하므로 별도 정리 작업이 필요 없다.
  it('TTL이 지나면 조회되지 않는다', async () => {
    await create('s-1', HOUR);
    jest.advanceTimersByTime(HOUR + 1);
    await expect(repo.findValid('s-1')).resolves.toBeNull();
  });

  it('표시 이름이 비면 일반 라벨로 대체한다', async () => {
    await create('s-1', HOUR, { ...user, displayName: '   ' });
    const restored = await repo.findValid('s-1');
    expect(restored?.displayName).toBe('Member');
  });

  it('형식이 깨진 값은 없는 세션으로 취급한다', async () => {
    await redis.setEx('prism:session:s-bad', 'not json', 60);
    await expect(repo.findValid('s-bad')).resolves.toBeNull();
  });

  // 시각 필드가 없는 이전 형식 레코드는 상한·시작 시각을 알 수 없어 관리가 불가능하다.
  // 그대로 받아주면 목록에 1970이 뜨고 absolute 판단이 어긋난다.
  it('시각 필드가 없는 구 형식 레코드는 없는 세션으로 취급한다', async () => {
    await redis.setEx(
      'prism:session:s-old',
      JSON.stringify({
        userId: 'u-1',
        provider: 'google',
        displayName: 'Alice',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      60,
    );
    await expect(repo.findValid('s-old')).resolves.toBeNull();
  });

  it('로그아웃하면 세션과 인덱스가 함께 사라진다', async () => {
    await create('s-1');
    await repo.delete('s-1');
    await expect(repo.findValid('s-1')).resolves.toBeNull();
    expect(redis.indexSize(INDEX)).toBe(0);
  });

  // ──────────────── 자기 정리 인덱스 ────────────────

  // 참조 구현은 집합 키 전체에 TTL을 걸어서, 새 세션이 키 수명을 연장하면
  // 만료된 멤버가 계속 남는다. score를 만료 시각으로 두고 접근 때마다 걷어낸다.
  it('만료된 항목은 다음 접근에서 인덱스에서 걷힌다', async () => {
    await create('old', HOUR);
    expect(redis.indexSize(INDEX)).toBe(1);

    jest.advanceTimersByTime(HOUR + 1);
    // 새 세션 생성이 인덱스를 연장하는 것이 아니라 먼저 정리한다.
    await create('fresh', HOUR);

    const list = await repo.listForUser('u-1');
    expect(list.map((s) => s.id)).toEqual(['fresh']);
    expect(redis.indexSize(INDEX)).toBe(1);
  });

  it('목록은 만료 시각과 함께 돌려준다', async () => {
    await create('s-1', HOUR);
    const [entry] = await repo.listForUser('u-1');
    expect(entry?.id).toBe('s-1');
    expect(Date.parse(entry?.expiresAt ?? '')).toBe(Date.now() + HOUR);
  });

  // ──────────────── 소유권 ────────────────

  it('내 세션은 폐기할 수 있다', async () => {
    await create('s-1');
    await expect(repo.deleteOwned('u-1', 's-1')).resolves.toBe(true);
    await expect(repo.findValid('s-1')).resolves.toBeNull();
  });

  // 회귀 방지 — 리뷰 3차. 인덱스에서 먼저 빼면(zRem이 소유권 검사를 겸하던 방식)
  // 그 뒤 삭제가 실패했을 때 소유 기록만 사라지고 자격증명은 살아남는다.
  // 자격증명을 먼저 지우므로, 최악이어도 인덱스에 고아 항목이 남을 뿐이다.
  it('폐기는 자격증명을 먼저 지운다(인덱스보다 앞서)', async () => {
    const issued = await create('s-1');
    const order: string[] = [];
    const del = redis.del.bind(redis);
    const zRem = redis.zRem.bind(redis);
    redis.del = (...keys: string[]) => {
      order.push('del');
      return del(...keys);
    };
    redis.zRem = (key: string, ...members: string[]) => {
      order.push('zRem');
      return zRem(key, ...members);
    };

    await repo.deleteOwned('u-1', 's-1');
    expect(order).toEqual(['del', 'zRem']);
    await expect(
      repo.rotate(issued.refreshCredential, HOUR),
    ).resolves.toBeNull();
  });

  // 회귀 방지: 세션 id만으로 지우면 남의 세션을 폐기할 수 있다.
  it('남의 세션 id를 넣어도 지워지지 않는다', async () => {
    await create('s-1');
    await expect(repo.deleteOwned('someone-else', 's-1')).resolves.toBe(false);
    // 원래 주인의 세션은 그대로 살아 있어야 한다.
    await expect(repo.findValid('s-1')).resolves.toEqual(user);
  });

  it('전체 로그아웃은 그 사용자의 세션만 모두 지운다', async () => {
    await create('s-1');
    await create('s-2');
    await create('other', HOUR, { ...user, id: 'u-2' });

    await expect(repo.deleteAllForUser('u-1')).resolves.toBe(2);
    await expect(repo.findValid('s-1')).resolves.toBeNull();
    await expect(repo.findValid('s-2')).resolves.toBeNull();
    // 다른 사용자의 세션은 건드리지 않는다.
    await expect(repo.findValid('other')).resolves.toBeDefined();
  });

  // ──────────────── 리프레시 회전 ────────────────

  it('발급된 자격증명으로 회전하면 새 자격증명과 사용자를 돌려준다', async () => {
    const issued = await create('s-1');
    const rotated = await repo.rotate(issued.refreshCredential, HOUR);

    expect(rotated?.user).toEqual(user);
    expect(rotated?.refreshCredential).toBeDefined();
    expect(rotated?.refreshCredential).not.toBe(issued.refreshCredential);
  });

  // 회전의 존재 이유: 같은 값을 두 번 쓰면 실패해야 탈취된 자격증명의 병행 사용이 드러난다.
  it('한 번 쓴 자격증명은 다시 쓸 수 없다', async () => {
    const issued = await create('s-1');
    await repo.rotate(issued.refreshCredential, HOUR);

    await expect(
      repo.rotate(issued.refreshCredential, HOUR),
    ).resolves.toBeNull();
  });

  it('회전된 새 자격증명은 계속 쓸 수 있다', async () => {
    const issued = await create('s-1');
    const first = await repo.rotate(issued.refreshCredential, HOUR);
    const second = await repo.rotate(first?.refreshCredential ?? '', HOUR);

    expect(second?.user).toEqual(user);
  });

  // 회귀 방지: 읽고-지우고-비교하는 방식이면 아무나 남의 세션을 갱신 불가로 만들 수 있다.
  // 비교와 교체가 원자적이므로 틀린 값은 아무것도 바꾸지 못한다.
  it('틀린 자격증명은 거부되고, 원래 자격증명은 그대로 유효하다', async () => {
    const issued = await create('s-1');

    await expect(repo.rotate('s-1.wrong-secret', HOUR)).resolves.toBeNull();
    // 공격 시도 후에도 정상 사용자는 갱신할 수 있어야 한다.
    await expect(
      repo.rotate(issued.refreshCredential, HOUR),
    ).resolves.not.toBeNull();
  });

  it('형식이 아닌 자격증명은 거부한다', async () => {
    await create('s-1');
    await expect(repo.rotate('no-separator', HOUR)).resolves.toBeNull();
    await expect(repo.rotate('.only-secret', HOUR)).resolves.toBeNull();
    await expect(repo.rotate('s-1.', HOUR)).resolves.toBeNull();
  });

  it('없는 세션의 자격증명은 거부한다', async () => {
    await expect(repo.rotate('ghost.secret', HOUR)).resolves.toBeNull();
  });

  // idle은 회전할 때마다 다시 채워진다 — 활동이 있는 한 끊기지 않는다.
  it('회전하면 idle 수명이 다시 채워진다', async () => {
    const issued = await create('s-1', HOUR);
    jest.advanceTimersByTime(HOUR - 60_000); // 만료 1분 전

    const rotated = await repo.rotate(issued.refreshCredential, HOUR);
    expect(rotated).not.toBeNull();

    // 원래대로면 1분 뒤 죽지만, 연장됐으므로 살아 있어야 한다.
    jest.advanceTimersByTime(2 * 60_000);
    await expect(repo.findValid('s-1')).resolves.toEqual(user);
  });

  // absolute는 활동과 무관한 상한이다 — 이게 없으면 리프레시로 영원히 연장된다.
  it('absolute 상한을 넘으면 활동이 있어도 회전할 수 없다', async () => {
    const issued = await create('s-1', HOUR, user, 2 * HOUR);
    const first = await repo.rotate(issued.refreshCredential, HOUR);
    jest.advanceTimersByTime(2 * HOUR + 1);

    await expect(
      repo.rotate(first?.refreshCredential ?? '', HOUR),
    ).resolves.toBeNull();
    // 상한을 넘은 세션은 정리된다.
    await expect(repo.findValid('s-1')).resolves.toBeNull();
  });

  it('idle 연장이 absolute 상한을 넘지 않는다', async () => {
    const issued = await create('s-1', HOUR, user, 90 * 60_000); // 상한 90분
    await repo.rotate(issued.refreshCredential, HOUR); // idle 60분 요청

    // 상한(90분)까지만 살아야 한다 — 91분 뒤에는 없다.
    jest.advanceTimersByTime(91 * 60_000);
    await expect(repo.findValid('s-1')).resolves.toBeNull();
  });

  // 회귀 방지 — 리뷰 4차. 본체와 자격증명은 별도 SETEX라 만료 시각이 미세하게 다를 수
  // 있다. 본체가 먼저 사라진 뒤 회전하면, EXPIRE 실패를 무시할 경우 "성공"으로 답하고
  // 정작 인증에 못 쓰는 자격증명과 고아 인덱스만 남는다.
  it('세션 본체가 사라졌으면 회전이 성공하지 않는다', async () => {
    const issued = await create('s-1');
    // 본체만 지워 만료를 흉내낸다(자격증명 키는 그대로).
    await redis.del('prism:session:s-1');

    await expect(
      repo.rotate(issued.refreshCredential, HOUR),
    ).resolves.toBeNull();
  });

  it('로그아웃하면 리프레시 자격증명도 함께 죽는다', async () => {
    const issued = await create('s-1');
    await repo.delete('s-1');
    await expect(
      repo.rotate(issued.refreshCredential, HOUR),
    ).resolves.toBeNull();
  });

  // TTL은 초 단위 올림이라 저장소 수명만 믿으면 상한을 잠깐 넘겨 살아 있을 수 있다.
  it('absolute 상한이 지나면 저장소에 남아 있어도 무효다', async () => {
    await create('s-1', HOUR, user, 30 * 60_000); // 상한 30분, idle 60분
    jest.advanceTimersByTime(31 * 60_000);
    await expect(repo.findValid('s-1')).resolves.toBeNull();
  });

  it('이미 지난 idle 수명으로는 살아남지 않는다', async () => {
    await repo.create('s-1', user, -1, WEEK);
    await expect(repo.findValid('s-1')).resolves.toBeNull();
  });
});
