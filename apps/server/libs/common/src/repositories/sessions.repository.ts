import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { REDIS, type RedisClient } from '@app/redis';
import {
  AUTH_PROVIDERS,
  decodeDeviceKind,
  decodeObject,
  decodeString,
  parseJsonValue,
  type AuthProvider,
  type DeviceKind,
  type SessionInfo,
  type User,
} from '../types/contracts';

// 세션 본체. idle 만료는 키 TTL이 처리하므로 여기 담지 않고, 연장 불가 상한만 담는다.
interface SessionRecord {
  userId: string;
  provider: AuthProvider;
  displayName: string;
  createdAt: string; // 사용자 가입 시각(User.createdAt)
  startedAt: number; // epoch(ms) — 이 세션이 시작된 시각(로그인 시점)
  // 기기 종류(enum). UA 원문이 아니다 — 로그인 시점에 네 갈래로 접어 이 값만 남긴다.
  device: DeviceKind;
  absoluteExpiresAt: number; // epoch(ms) — 리프레시로도 넘을 수 없는 상한
}

// 세션 생성/갱신 결과 — 리프레시 자격증명은 **이때만** 평문으로 존재한다.
export interface IssuedSession {
  sessionId: string;
  refreshCredential: string;
}

// Apple은 표시 이름을 최초 로그인에만 한 번 준다 — 이후 세션엔 없을 수 있어 일반 라벨로 대체.
const FALLBACK_DISPLAY_NAME = 'Member';

const sessionKey = (id: string) => `prism:session:${id}`;
const refreshKey = (id: string) => `prism:refresh:${id}`;
const userIndexKey = (userId: string) => `prism:user_sessions:${userId}`;
// 이미 소비된(회전된) 자격증명의 해시 이력. member=해시, score=소비 시각(epoch ms).
const consumedKey = (id: string) => `prism:refresh_used:${id}`;

// 자격증명은 `<sessionId>.<secret>` — 자체적으로 어느 세션인지 말하므로
// 액세스 토큰이 이미 만료된 상태에서도 갱신을 시작할 수 있다.
const CREDENTIAL_SEPARATOR = '.';
const SECRET_BYTES = 32;

// 회전 직후의 짧은 유예 창. 이 안에서 옛 자격증명이 다시 오는 것은 탈취가 아니라
// **회전이 끝나기 전에 이미 출발한 요청**이다.
//
// 브라우저의 쿠키 항아리는 하나뿐이라 탭이 여러 개여도 각 탭이 stale 값을 들고 있을 수
// 있는 시간은 "요청 하나의 왕복" 뿐이다. 그래서 창을 크게 잡을 이유가 없고, 크게 잡으면
// 그만큼 탈취 탐지가 늦어진다.
export const REFRESH_REUSE_GRACE_MS = 30_000;

// 세션 하나가 남기는 소비 이력의 상한. 이력은 갱신 횟수만큼 쌓이므로
// "짧은 액세스 수명 + 긴 세션" 조합에서는 상한이 없으면 수만 건이 된다.
// 넘쳐서 밀려난 아주 오래된 자격증명은 탐지 대신 단순 거부로 처리된다(안전한 쪽으로 실패).
const CONSUMED_HISTORY_LIMIT = 128;

// 회전 실패는 원인마다 대응이 다르다 — 문자열 하나로 뭉치지 않고 판별 유니온으로 넘긴다.
//  - rotated:  성공. 새 자격증명을 발급했다
//  - raced:    유예 창 안의 재제시. 탭 경합이므로 **세션을 유지**한다
//  - reused:   유예 창 밖의 재사용. 탈취 신호로 보고 **세션을 폐기했다**
//  - rejected: 발급된 적 없는 값·세션 없음·상한 초과. 세션은 건드리지 않는다
export type RotateOutcome =
  | { status: 'rotated'; user: User; refreshCredential: string }
  | { status: 'raced' }
  | { status: 'reused' }
  | { status: 'rejected' };

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

// 서버 보유 세션 리포지토리. 토큰이 아니라 이 저장소가 "로그인 상태"의 원천이라,
// 여기서 지우면 그 순간부터 해당 토큰은 무효다(즉시 폐기).
//
// 저장소로 Redis를 쓰는 이유는 세션이 **만료가 본질인 데이터**이기 때문이다.
// 본체는 키 TTL로 스스로 사라지므로 만료 행을 치우는 별도 작업이 필요 없다.
//
// 사용자별 인덱스(정렬 집합)는 "내 세션 목록 / 전체 로그아웃"에 필요한데,
// score를 **만료 시각**으로 두고 접근할 때마다 지나간 항목을 걷어낸다.
//
// 정리는 두 겹이다. 접근 시 pruneIndex가 지나간 항목을 걷어내고, 그와 별개로
// 집합 키 자체가 마지막 항목의 만료 시각에 사라진다(zAdd가 걸어준다).
// 두 번째가 없으면 **다시 찾아오지 않는 사용자**의 인덱스를 아무도 건드리지 않아
// 만료된 항목을 안은 채 영구히 남는다 — 키 수는 활성 사용자가 아니라 누적 사용자
// 수에 비례해 늘어난다.
@Injectable()
export class SessionsRepository {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  // 세션을 만들고 리프레시 자격증명을 발급한다.
  // 저장하는 것은 secret의 해시뿐 — 저장소가 유출돼도 그것만으로는 갱신할 수 없다.
  async create(
    id: string,
    user: User,
    idleTtlMs: number,
    absoluteTtlMs: number,
    // 세션을 만든 기기의 **종류**. 호출부가 이미 UA를 접어서 넘긴다 — 여기까지 원문이
    // 내려오지 않으므로, 저장소에 UA가 새어 들어갈 경로 자체가 없다.
    device: DeviceKind = 'unknown',
  ): Promise<IssuedSession> {
    const record: SessionRecord = {
      userId: user.id,
      provider: user.provider,
      displayName: user.displayName,
      createdAt: user.createdAt,
      startedAt: Date.now(),
      absoluteExpiresAt: Date.now() + absoluteTtlMs,
      device,
    };
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const ttlSeconds = Math.ceil(idleTtlMs / 1000);

    await this.redis.setEx(sessionKey(id), JSON.stringify(record), ttlSeconds);
    await this.redis.setEx(refreshKey(id), sha256(secret), ttlSeconds);
    await this.pruneIndex(user.id);
    await this.redis.zAdd(userIndexKey(user.id), Date.now() + idleTtlMs, id);

    return {
      sessionId: id,
      refreshCredential: `${id}${CREDENTIAL_SEPARATOR}${secret}`,
    };
  }

  // 유효한 세션이면 사용자로 복원한다. 만료는 키 TTL이 처리하므로 조회되면 유효한 것이다.
  async findValid(id: string): Promise<User | null> {
    const record = await this.readRecord(id);
    if (!record) return null;
    // 상한은 TTL과 별개로 직접 확인한다 — TTL은 초 단위로 올림되고 인덱스 score는
    // 밀리초라, 저장소 수명에만 기대면 상한을 잠깐 넘겨 살아 있을 수 있다.
    if (record.absoluteExpiresAt <= Date.now()) return null;
    return {
      id: record.userId,
      provider: record.provider,
      displayName: record.displayName,
      createdAt: record.createdAt,
    };
  }

  // 리프레시 자격증명을 회전한다.
  //
  // 회전만으로는 탈취를 **탐지**하지 못한다. 옛 자격증명이 거부되기만 하면, 공격자가
  // 먼저 회전시킨 뒤 피해자가 실패하는 상황과 단순한 오류가 구분되지 않기 때문이다.
  // 그래서 소비된 해시를 이력으로 남기고, 나중에 제시된 값이 그 이력에 있으면
  // "이미 쓴 자격증명을 또 쓴다"는 신호로 읽는다(RFC 9700 refresh token reuse).
  //
  // 다만 즉시 폐기는 오탐을 부른다 — 회전 직전에 출발한 요청이 회전 직후 도착하는
  // 정상 경합이 있다. 유예 창(REFRESH_REUSE_GRACE_MS) 안이면 세션을 살려둔다.
  async rotate(credential: string, idleTtlMs: number): Promise<RotateOutcome> {
    const separator = credential.indexOf(CREDENTIAL_SEPARATOR);
    if (separator <= 0) return { status: 'rejected' };
    const id = credential.slice(0, separator);
    const secret = credential.slice(separator + 1);
    if (!secret) return { status: 'rejected' };

    const record = await this.readRecord(id);
    if (!record) return { status: 'rejected' };

    // 상한을 넘었으면 활동과 무관하게 끝이다. 세션도 함께 정리한다.
    if (record.absoluteExpiresAt <= Date.now()) {
      await this.deleteById(id, record.userId);
      return { status: 'rejected' };
    }

    // idle 만료가 상한을 넘지 않도록 자른다.
    const ttlMs = Math.min(idleTtlMs, record.absoluteExpiresAt - Date.now());
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    const presented = sha256(secret);
    const nextSecret = randomBytes(SECRET_BYTES).toString('base64url');

    // 자격증명 교체 · 본체 수명 연장 · 인덱스 갱신 · 소비 이력 기록이 **한 번에** 일어난다.
    // 나눠서 하면 교체만 성공하고 죽었을 때 "새 자격증명인데 본체는 옛 수명" 또는
    // "살아 있는데 인덱스에 없는 세션"(목록·전체 폐기에서 누락)이 생기고,
    // 이력만 누락되면 그 자격증명의 재사용을 영영 탐지하지 못한다.
    const rotated = await this.redis.compareAndRenew({
      key: refreshKey(id),
      expected: presented,
      next: sha256(nextSecret),
      ttlSeconds,
      renewKeys: [sessionKey(id)],
      index: {
        key: userIndexKey(record.userId),
        member: id,
        score: Date.now() + ttlMs,
      },
      consumed: {
        key: consumedKey(id),
        member: presented,
        score: Date.now(),
        keep: CONSUMED_HISTORY_LIMIT,
      },
    });
    if (!rotated) {
      return this.classifyRejected(id, record.userId, presented);
    }

    return {
      status: 'rotated',
      user: {
        id: record.userId,
        provider: record.provider,
        displayName: record.displayName,
        createdAt: record.createdAt,
      },
      refreshCredential: `${id}${CREDENTIAL_SEPARATOR}${nextSecret}`,
    };
  }

  // 교체에 실패한 자격증명이 "이미 소비된 것"인지 이력에서 확인한다.
  //
  // ⚠️ 이력에 **없는** 값은 폐기 대상이 아니다. 발급된 적 없는 값까지 폐기 신호로 보면,
  // 세션 id만 아는 사람이 아무 문자열이나 붙여 남의 세션을 끊을 수 있다(폐기 DoS).
  // 폐기는 "한때 유효했음을 증명한" 값에만 적용한다.
  private async classifyRejected(
    id: string,
    userId: string,
    presented: string,
  ): Promise<RotateOutcome> {
    const consumedAt = await this.redis.zScore(consumedKey(id), presented);
    if (consumedAt === null) return { status: 'rejected' };

    // 회전 직후의 재제시 = 이미 출발했던 요청. 세션을 유지한다.
    if (Date.now() - consumedAt <= REFRESH_REUSE_GRACE_MS) {
      return { status: 'raced' };
    }

    // 유예 창 밖의 재사용 — 자격증명이 두 곳에 존재한다는 뜻이다. 어느 쪽이 공격자인지
    // 알 수 없으므로 세션 전체를 끊고 재로그인시킨다(둘 다 잃는 것이 안전한 쪽).
    await this.deleteById(id, userId);
    return { status: 'reused' };
  }

  // 로그아웃 — 이 세션만 폐기한다(다른 기기의 세션은 그대로).
  async delete(id: string): Promise<void> {
    const record = await this.readRecord(id);
    await this.deleteById(id, record?.userId);
  }

  // 내 세션 목록. 만료된 항목을 먼저 걷어내므로 인덱스가 스스로 정리된다.
  // 인덱스는 만료 시각만 알고 있어 시작 시각은 본체에서 읽는다 — 사용자당 세션이
  // 몇 개뿐이라 왕복 비용보다 인덱스를 단순하게 두는 쪽이 낫다.
  async listForUser(userId: string): Promise<SessionInfo[]> {
    await this.pruneIndex(userId);
    const items = await this.redis.zRangeWithScores(userIndexKey(userId));
    const sessions: SessionInfo[] = [];
    for (const { member, score } of items) {
      const record = await this.readRecord(member);
      // 인덱스에는 남았는데 본체가 없으면(경합) 목록에서 제외한다.
      if (!record) continue;
      sessions.push({
        id: member,
        startedAt: new Date(record.startedAt).toISOString(),
        expiresAt: new Date(score).toISOString(),
        device: record.device,
      });
    }
    return sessions;
  }

  // 소유권 범위 폐기 — 세션 id만으로 지우지 않는다. 남의 id를 넣어도 지워지면 안 된다.
  //
  // 소유권은 **세션 본체**로 판단하고, 자격증명을 먼저 지운 뒤 인덱스를 정리한다.
  // 예전처럼 인덱스에서 먼저 빼면(zRem이 소유권 검사를 겸하던 방식) 그 뒤 삭제가
  // 실패했을 때 소유 기록만 사라지고 자격증명은 살아남는다 — 재시도는 404가 되고
  // 전체 폐기는 인덱스만 훑으므로 그 세션을 영영 못 찾는다.
  // 지금 순서에서는 최악이 "인덱스에 고아 항목이 남는 것"이고, 그건 TTL·정리로 사라진다.
  async deleteOwned(userId: string, sessionId: string): Promise<boolean> {
    const record = await this.readRecord(sessionId);
    if (!record || record.userId !== userId) return false;
    await this.redis.del(
      sessionKey(sessionId),
      refreshKey(sessionId),
      consumedKey(sessionId),
    );
    await this.redis.zRem(userIndexKey(userId), sessionId);
    return true;
  }

  // 전체 로그아웃(모든 기기).
  async deleteAllForUser(userId: string): Promise<number> {
    const items = await this.redis.zRangeWithScores(userIndexKey(userId));
    const keys = items.flatMap(({ member }) => [
      sessionKey(member),
      refreshKey(member),
      consumedKey(member),
    ]);
    if (keys.length > 0) await this.redis.del(...keys);
    await this.redis.del(userIndexKey(userId));
    return items.length;
  }

  private async deleteById(id: string, userId?: string): Promise<void> {
    await this.redis.del(sessionKey(id), refreshKey(id), consumedKey(id));
    if (userId) await this.redis.zRem(userIndexKey(userId), id);
  }

  // 저장한 형식과 다르면(구버전 등) 없는 세션으로 취급한다 — 조용히 실패하지 않게
  // 경계에서 디코딩한다.
  private async readRecord(id: string): Promise<SessionRecord | null> {
    const raw = await this.redis.get(sessionKey(id));
    if (!raw) return null;
    try {
      const obj = decodeObject(parseJsonValue(raw), 'SessionRecord');
      const provider = AUTH_PROVIDERS.find((p) => p === obj.provider);
      if (!provider) return null;
      // 시각 필드가 없으면 이전 형식으로 저장된 세션이다 — 상한도 시작 시각도 모르는
      // 세션은 올바르게 관리할 수 없다(목록에 1970이 뜨고, 상한 판단이 불가능하다).
      // 없는 세션으로 취급해 재로그인시킨다.
      if (
        typeof obj.startedAt !== 'number' ||
        typeof obj.absoluteExpiresAt !== 'number'
      ) {
        return null;
      }
      return {
        userId: decodeString(obj.userId, 'SessionRecord.userId'),
        provider,
        displayName:
          typeof obj.displayName === 'string' && obj.displayName.trim()
            ? obj.displayName
            : FALLBACK_DISPLAY_NAME,
        createdAt: decodeString(obj.createdAt, 'SessionRecord.createdAt'),
        startedAt: obj.startedAt,
        // 이 필드가 생기기 전에 만들어진 세션은 값이 없다 — 거부하지 않고 unknown으로
        // 접는다. 배포 순간에 살아 있던 세션이 목록에서 통째로 사라지면 안 된다.
        device: decodeDeviceKind(obj.device),
        absoluteExpiresAt: obj.absoluteExpiresAt,
      };
    } catch {
      return null;
    }
  }

  // 지나간 항목을 인덱스에서 걷어낸다. 본체는 TTL로 이미 사라졌으므로 인덱스만 정리하면 된다.
  private async pruneIndex(userId: string): Promise<void> {
    await this.redis.zRemRangeByScore(userIndexKey(userId), 0, Date.now());
  }
}
