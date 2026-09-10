import { FakeRedis } from '@app/redis/testing/fake-redis';
import {
  REFRESH_REUSE_GRACE_MS,
  SessionsRepository,
} from './sessions.repository';
import { parseJsonValue, type JsonValue, type User } from '../types/contracts';

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

  // 회전 성공만 좁혀 꺼낸다 — 실패면 그 자리에서 테스트를 끊는다(뒤에서 옵셔널 체이닝으로
  // 조용히 undefined가 흘러가는 것을 막는다).
  /** 가드가 인증에서 얻은 값을 그대로 넘긴다 — 상한은 create가 준 기본값과 같다. */
  const touch = (id: string, absoluteMs = WEEK, idle = HOUR) =>
    repo.touch(id, user.id, Date.now() + absoluteMs, idle);

  const rotateOk = async (credential: string, idleMs = HOUR) => {
    const result = await repo.rotate(credential, idleMs);
    if (result.status !== 'rotated') {
      throw new Error(`expected rotation to succeed, got ${result.status}`);
    }
    return result;
  };

  const rotateStatus = async (credential: string, idleMs = HOUR) =>
    (await repo.rotate(credential, idleMs)).status;

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

  // ──────────────── 기기 종류 ────────────────

  it('로그인 시점의 기기 종류를 그대로 돌려준다', async () => {
    await repo.create('s-1', user, HOUR, WEEK, 'iphone');
    const [entry] = await repo.listForUser('u-1');
    expect(entry?.device).toBe('iphone');
  });

  it('기기 종류를 주지 않으면 unknown이다', async () => {
    await create('s-1');
    const [entry] = await repo.listForUser('u-1');
    expect(entry?.device).toBe('unknown');
  });

  it('이 필드가 생기기 전 세션도 목록에서 사라지지 않는다', async () => {
    // 배포 순간에 살아 있던 세션에는 device가 없다 — 거부하면 그 사용자의 목록이
    // 통째로 비어 버린다. unknown으로 접고 계속 그린다.
    await create('s-1');
    const key = 'prism:session:s-1';
    const stored = redis.dump(key);
    expect(stored).not.toBeNull(); // 키 이름이 어긋나면 아래 조작이 조용히 없던 일이 된다
    // 레코드는 문자열·숫자 필드만 담는다 — 프로젝트 방침상 unknown을 쓰지 않는다.
    const raw = JSON.parse(stored ?? '{}') as Record<string, string | number>;
    delete raw.device;
    redis.load(key, JSON.stringify(raw));

    const [entry] = await repo.listForUser('u-1');
    expect(entry?.id).toBe('s-1');
    expect(entry?.device).toBe('unknown');
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
    await expect(rotateStatus(issued.refreshCredential)).resolves.toBe(
      'rejected',
    );
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
    const rotated = await rotateOk(issued.refreshCredential);

    expect(rotated.user).toEqual(user);
    expect(rotated.refreshCredential).not.toBe(issued.refreshCredential);
  });

  // 회전의 존재 이유: 같은 값을 두 번 쓰면 실패해야 탈취된 자격증명의 병행 사용이 드러난다.
  // (직후의 재제시는 탭 경합이므로 raced — 세션은 살아 있다)
  it('한 번 쓴 자격증명은 다시 쓸 수 없다', async () => {
    const issued = await create('s-1');
    await rotateOk(issued.refreshCredential);

    await expect(rotateStatus(issued.refreshCredential)).resolves.toBe('raced');
  });

  it('회전된 새 자격증명은 계속 쓸 수 있다', async () => {
    const issued = await create('s-1');
    const first = await rotateOk(issued.refreshCredential);
    const second = await rotateOk(first.refreshCredential);

    expect(second.user).toEqual(user);
  });

  // 회귀 방지: 읽고-지우고-비교하는 방식이면 아무나 남의 세션을 갱신 불가로 만들 수 있다.
  // 비교와 교체가 원자적이므로 틀린 값은 아무것도 바꾸지 못한다.
  it('틀린 자격증명은 거부되고, 원래 자격증명은 그대로 유효하다', async () => {
    const issued = await create('s-1');

    await expect(rotateStatus('s-1.wrong-secret')).resolves.toBe('rejected');
    // 공격 시도 후에도 정상 사용자는 갱신할 수 있어야 한다.
    await expect(rotateStatus(issued.refreshCredential)).resolves.toBe(
      'rotated',
    );
  });

  it('형식이 아닌 자격증명은 거부한다', async () => {
    await create('s-1');
    await expect(rotateStatus('no-separator')).resolves.toBe('rejected');
    await expect(rotateStatus('.only-secret')).resolves.toBe('rejected');
    await expect(rotateStatus('s-1.')).resolves.toBe('rejected');
  });

  it('없는 세션의 자격증명은 거부한다', async () => {
    await expect(rotateStatus('ghost.secret')).resolves.toBe('rejected');
  });

  // ⚠️ 회귀 방지: **회전은 창을 밀지 않는다.** 자격증명 교체는 활동이 아니다 — 사용자가
  // 눌러서 나간 요청일 수도, 서버가 밀어 준 신호 때문에 나간 재조회일 수도 있어 이 자리에서
  // 둘을 구분할 수 없다. 미는 것은 `touch`뿐이다(plan/auth.md §6).
  it('회전해도 idle 수명은 그대로다', async () => {
    const issued = await create('s-1', HOUR);
    jest.advanceTimersByTime(HOUR - 60_000); // 만료 1분 전

    await rotateOk(issued.refreshCredential);

    // 회전했다고 살아나지 않는다 — 원래 만료 시각에 죽는다.
    jest.advanceTimersByTime(2 * 60_000);
    await expect(repo.findValid('s-1')).resolves.toBeNull();
  });

  // 미는 것은 활동이다. 그 활동이 실제로 창을 채우는지 본다.
  it('touch가 idle 수명을 다시 채운다', async () => {
    const issued = await create('s-1', HOUR);
    expect(issued.sessionId).toBe('s-1');
    jest.advanceTimersByTime(HOUR - 60_000); // 만료 1분 전

    await touch('s-1');

    // 원래대로면 1분 뒤 죽지만, 밀렸으므로 살아 있어야 한다.
    jest.advanceTimersByTime(2 * 60_000);
    await expect(repo.findValid('s-1')).resolves.toEqual(user);
  });

  // 자격증명도 함께 밀려야 한다 — 본체만 밀면 "살아 있는데 회전할 수 없는" 세션이 된다.
  it('touch는 자격증명도 함께 민다', async () => {
    const issued = await create('s-1', HOUR);
    jest.advanceTimersByTime(HOUR - 60_000);
    await touch('s-1');

    jest.advanceTimersByTime(2 * 60_000);
    await expect(rotateStatus(issued.refreshCredential)).resolves.toBe(
      'rotated',
    );
  });

  // 목록·전체 폐기가 보는 인덱스 score도 함께 밀려야 실제 수명과 어긋나지 않는다.
  it('touch 뒤에도 목록이 그 세션을 본다', async () => {
    await create('s-1', HOUR);
    jest.advanceTimersByTime(HOUR - 60_000);
    await touch('s-1');
    jest.advanceTimersByTime(2 * 60_000);

    const list = await repo.listForUser('u-1');
    expect(list.map((entry) => entry.id)).toEqual(['s-1']);
    await expect(repo.deleteAllForUser('u-1')).resolves.toBe(1);
  });

  // 활동마다 미는 규칙을 그대로 두면 요청 하나에 쓰기가 셋씩 붙는다. 창이 조금밖에 줄지
  // 않았으면 건너뛴다 — 정확성이 아니라 쓰기 절약이라, 건너뛴 뒤에도 수명은 유효하다.
  it('touch는 방금 민 세션을 다시 밀지 않는다', async () => {
    await create('s-1', HOUR);
    jest.advanceTimersByTime(1_000); // 아직 1초밖에 안 지났다
    await touch('s-1');

    // 건너뛰었으므로 만료 시각은 여전히 생성 시점 기준이다.
    jest.advanceTimersByTime(HOUR - 500);
    await expect(repo.findValid('s-1')).resolves.toBeNull();
  });

  // 없는 세션을 되살리지 않는다 — 밀기는 살아 있는 세션에만 하는 일이다.
  it('없는 세션의 touch는 아무 일도 하지 않는다', async () => {
    await expect(touch('ghost')).resolves.toBeUndefined();
    await expect(repo.findValid('ghost')).resolves.toBeNull();
  });

  // 활동이 있어도 상한은 넘지 못한다 — rotate와 같은 규칙이다.
  it('touch도 absolute 상한을 넘지 않는다', async () => {
    const absoluteAt = Date.now() + 90 * 60_000; // 상한 90분
    await create('s-1', HOUR, user, 90 * 60_000);
    jest.advanceTimersByTime(80 * 60_000);
    await repo.touch('s-1', user.id, absoluteAt, HOUR); // idle 60분을 요청해도

    jest.advanceTimersByTime(11 * 60_000); // 총 91분
    await expect(repo.findValid('s-1')).resolves.toBeNull();
  });

  // absolute는 활동과 무관한 상한이다 — 이게 없으면 리프레시로 영원히 연장된다.
  it('absolute 상한을 넘으면 활동이 있어도 회전할 수 없다', async () => {
    const issued = await create('s-1', HOUR, user, 2 * HOUR);
    const first = await rotateOk(issued.refreshCredential);
    jest.advanceTimersByTime(2 * HOUR + 1);

    await expect(rotateStatus(first.refreshCredential)).resolves.toBe(
      'rejected',
    );
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

    await expect(rotateStatus(issued.refreshCredential)).resolves.toBe(
      'rejected',
    );
  });

  it('로그아웃하면 리프레시 자격증명도 함께 죽는다', async () => {
    const issued = await create('s-1');
    await repo.delete('s-1');
    await expect(rotateStatus(issued.refreshCredential)).resolves.toBe(
      'rejected',
    );
  });

  // ──────────────── 재사용 탐지 (RFC 9700) ────────────────

  // 회전만으로는 탈취가 드러나지 않는다. 이미 소비된 자격증명이 한참 뒤에 다시 오는 것은
  // "그 값이 두 곳에 존재한다"는 뜻이므로, 어느 쪽이 공격자인지 모른 채 세션을 끊는다.
  it('유예 창을 지난 재사용은 세션을 폐기한다', async () => {
    const issued = await create('s-1');
    const rotated = await rotateOk(issued.refreshCredential);

    jest.advanceTimersByTime(REFRESH_REUSE_GRACE_MS + 1);
    await expect(rotateStatus(issued.refreshCredential)).resolves.toBe(
      'reused',
    );

    // 세션이 죽었으므로 공격자가 회전시킨 새 자격증명도 함께 무효가 된다 —
    // 이게 탐지의 목적이다(옛 값을 거부하는 것만으로는 공격자가 계속 쓴다).
    await expect(repo.findValid('s-1')).resolves.toBeNull();
    await expect(rotateStatus(rotated.refreshCredential)).resolves.toBe(
      'rejected',
    );
  });

  // 오탐 방지: 회전이 끝나기 전에 출발한 요청이 직후에 도착하는 것은 정상이다.
  it('유예 창 안의 재제시는 세션을 살려둔다', async () => {
    const issued = await create('s-1');
    const rotated = await rotateOk(issued.refreshCredential);

    jest.advanceTimersByTime(REFRESH_REUSE_GRACE_MS - 1);
    await expect(rotateStatus(issued.refreshCredential)).resolves.toBe('raced');

    // 먼저 회전에 성공한 쪽의 자격증명은 그대로 살아 있어야 한다.
    await expect(rotateStatus(rotated.refreshCredential)).resolves.toBe(
      'rotated',
    );
  });

  // ⚠️ 폐기 DoS 방지 — 세션 id는 자격증명의 앞부분이라 유출되기 쉽다.
  // 발급된 적 없는 값까지 폐기 신호로 보면 아무 문자열이나 붙여 남의 세션을 끊을 수 있다.
  it('발급된 적 없는 값은 오래 지나도 세션을 끊지 못한다', async () => {
    const issued = await create('s-1');
    await rotateOk(issued.refreshCredential);

    jest.advanceTimersByTime(REFRESH_REUSE_GRACE_MS + 1);
    await expect(rotateStatus('s-1.never-issued')).resolves.toBe('rejected');
    await expect(repo.findValid('s-1')).resolves.toEqual(user);
  });

  // 폐기하면 이력도 함께 사라져야 한다 — 남으면 같은 id의 세션이 다시 생겼을 때
  // 옛 이력이 새 세션의 판단에 끼어든다.
  it('세션을 폐기하면 소비 이력도 함께 지운다', async () => {
    const issued = await create('s-1');
    await rotateOk(issued.refreshCredential);
    expect(redis.indexSize('prism:refresh_used:s-1')).toBe(1);

    await repo.delete('s-1');
    expect(redis.indexSize('prism:refresh_used:s-1')).toBe(0);
  });

  it('전체 로그아웃도 소비 이력을 남기지 않는다', async () => {
    const issued = await create('s-1');
    await rotateOk(issued.refreshCredential);

    await repo.deleteAllForUser('u-1');
    expect(redis.indexSize('prism:refresh_used:s-1')).toBe(0);
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

  // ── 푸시 (plan/push.md) ──
  //
  // 토큰은 **세션 안에서만 살고 세션과 함께 사라진다** — 별도 테이블도, 정리 잡도 없다.
  describe('푸시 등록', () => {
    const PUSH = { token: 'fcm-tok-1', locale: 'ko' } as const;

    const createWithPush = (id: string) =>
      repo.create(id, user, HOUR, WEEK, 'iphone', PUSH);

    it('로그인 시점에 함께 기록된다', async () => {
      await createWithPush('s-1');

      const lookup = await repo.pushTargetFor('u-1', 's-1');
      expect(lookup).toEqual({ kind: 'ok', target: PUSH });
    });

    // 등록 없이 만든 세션은 재로그인 전까지 푸시 대상이 아니다 —
    // 화면에는 `Notifications off`로 정직하게 보인다.
    it('등록 없이 만들면 no-token이다', async () => {
      await repo.create('s-2', user, HOUR, WEEK, 'mac');

      expect(await repo.pushTargetFor('u-1', 's-2')).toEqual({
        kind: 'no-token',
      });
    });

    // 남의 세션 id로 남의 기기를 울릴 수 있으면 그것 자체가 공격이다.
    // 없는 세션과 남의 세션을 **구별해 주지 않는다**.
    it('남의 세션과 없는 세션은 같은 답을 준다', async () => {
      await createWithPush('s-3');

      expect(await repo.pushTargetFor('u-2', 's-3')).toEqual({
        kind: 'not-owned',
      });
      expect(await repo.pushTargetFor('u-1', 'no-such')).toEqual({
        kind: 'not-owned',
      });
    });

    // ⚠️ 목록에는 **파생 불리언만** 나간다. 원본 토큰이 이 객체에 얹히면 호출부의
    // 스프레드를 타고 남의 기기 행까지 든 목록에 그대로 실려 나간다(plan/push.md §5-3).
    it('목록은 pushRegistered만 싣고 토큰은 싣지 않는다', async () => {
      await createWithPush('s-4');
      await repo.create('s-5', user, HOUR, WEEK, 'mac');

      const list = await repo.listForUser('u-1');
      const registered = list.map((s) => [s.id, s.pushRegistered]);
      expect(registered).toEqual(
        expect.arrayContaining([
          ['s-4', true],
          ['s-5', false],
        ]),
      );
      expect(JSON.stringify(list)).not.toContain('fcm-tok-1');
      for (const item of list) {
        expect(Object.keys(item)).not.toContain('pushToken');
      }
    });

    // 회전은 자격증명만 교체하고 본체는 건드리지 않는다 — 그래서 필드를 더해도
    // 옮겨 담는 코드가 필요 없다(plan/push.md §5-1).
    it('회전해도 토큰이 살아남는다', async () => {
      const issued = await createWithPush('s-6');
      await repo.rotate(issued.refreshCredential, HOUR);

      expect(await repo.pushTargetFor('u-1', 's-6')).toEqual({
        kind: 'ok',
        target: PUSH,
      });
    });

    // 이 필드가 생기기 전에 만들어진 세션은 값이 없다 — 거부하면 배포 순간에 살아
    // 있던 세션이 목록에서 통째로 사라진다(device를 unknown으로 접는 것과 같은 규칙).
    it('예전 형식의 레코드도 거부하지 않는다', async () => {
      await repo.create('s-7', user, HOUR, WEEK, 'mac');
      const raw = await redis.get('prism:session:s-7');
      const record = parseJsonValue(raw ?? '{}') as { [k: string]: JsonValue };
      delete record.locale;
      await redis.setEx('prism:session:s-7', JSON.stringify(record), 3600);

      const list = await repo.listForUser('u-1');
      expect(list.find((s) => s.id === 's-7')?.pushRegistered).toBe(false);
    });
  });

  // 끄기는 **권한을 되돌리는 것이 아니다** — 이 세션을 대상에서 빼는 것뿐이다(§5-15).
  describe('clearPushToken', () => {
    it('토큰을 빼고 목록이 그 사실을 말한다', async () => {
      await repo.create('s-1', user, HOUR, WEEK, 'mac', {
        token: 'fcm-1',
        locale: 'ko',
      });
      expect((await repo.listForUser('u-1'))[0]?.pushRegistered).toBe(true);

      await expect(repo.clearPushToken('u-1', 's-1')).resolves.toBe(true);

      expect((await repo.listForUser('u-1'))[0]?.pushRegistered).toBe(false);
    });

    // 유휴 창을 밀면 "손을 뗀 지 얼마나 됐나"가 거짓이 된다(plan/auth.md §6).
    // 목록의 `expiresAt`은 인덱스 score라, 밀렸다면 이 값이 함께 움직인다.
    it('유휴 창을 밀지 않는다', async () => {
      await repo.create('s-1', user, HOUR, WEEK, 'mac', {
        token: 'fcm-1',
        locale: 'ko',
      });
      const before = (await repo.listForUser('u-1'))[0]?.expiresAt;

      jest.advanceTimersByTime(60_000);
      await repo.clearPushToken('u-1', 's-1');

      expect((await repo.listForUser('u-1'))[0]?.expiresAt).toBe(before);
    });

    it('남의 세션은 건드리지 않는다', async () => {
      await repo.create('s-1', user, HOUR, WEEK, 'mac', {
        token: 'fcm-1',
        locale: 'ko',
      });

      await expect(repo.clearPushToken('other', 's-1')).resolves.toBe(false);
      expect((await repo.listForUser('u-1'))[0]?.pushRegistered).toBe(true);
    });
  });
});
