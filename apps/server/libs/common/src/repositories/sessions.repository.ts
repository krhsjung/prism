import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { REDIS, type RedisClient } from '@app/redis';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../i18n';
import {
  AUTH_PROVIDERS,
  decodeDeviceKind,
  decodeObject,
  decodeString,
  parseJsonValue,
  type AuthProvider,
  type DeviceKind,
  MAX_PUSH_TOKEN_LENGTH,
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
  // FCM 등록 토큰. **응답으로 나가지 않는다** — 목록에는 파생 불리언
  // (`SessionInfo.pushRegistered`)만 실린다(plan/push.md §5-3).
  //
  // 별도 테이블에 두지 않는 이유는 수명이다: 세션에 담으면 **로그아웃·폐기·유휴 만료가
  // 그대로 토큰의 수명**이 되고, Postgres와 백업에는 기기 식별자가 남지 않는다(§5-1).
  // "저장하지 않는다"가 아니라 **"세션과 함께 사라진다"**이다.
  pushToken?: string;
  // 이 세션을 만든 기기의 표시 언어. **서버가 그리는 알림 문구**를 고르는 데만 쓴다 —
  // 받는 쪽의 언어는 보내는 쪽의 요청에서 알 수 없기 때문이다(plan/push.md D4).
  locale?: Locale;
}

// 세션에 함께 기록되는 푸시 등록. **로그인 시점에만** 들어온다 — 살아 있는 세션
// 레코드를 고치는 경로를 만들지 않으려는 것이다(plan/push.md §5-2).
export interface PushRegistration {
  token: string;
  locale: Locale;
}

// 푸시를 보낼 때 필요한 것 전부. `pushTargetFor`만 이것을 돌려준다.
export interface PushTarget {
  token: string;
  locale: Locale;
}

// 대상 조회의 세 갈래. `not-owned`는 **없는 세션과 남의 세션을 구별해 주지 않는다** —
// 남의 세션 id를 넣어 존재를 떠보는 경로를 열지 않기 위해서다(unknown-session과 같은 이유).
export type PushLookup =
  | { kind: 'ok'; target: PushTarget }
  | { kind: 'no-token' }
  | { kind: 'not-owned' };

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

// 유휴 창을 다시 미는 최소 간격. 활동마다 밀면 요청 하나에 쓰기가 셋씩 붙는데, 창이
// 이만큼 줄어든 뒤에만 밀어도 유휴 만료의 의미는 같다 — 정확성이 아니라 쓰기 절약이다.
const TOUCH_MIN_INTERVAL_MS = 10_000;

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
  // absoluteExpiresAt를 함께 주는 이유는 `touch`와 같다 — 회전한 요청이 활동이면 바로
  // 창을 밀어야 하는데, 그 값은 방금 읽은 레코드에 이미 있다.
  | {
      status: 'rotated';
      user: User;
      refreshCredential: string;
      absoluteExpiresAt: number;
    }
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
    // 푸시 등록은 **로그인 시점에만** 들어온다(plan/push.md §5-2). 없으면 그 세션은
    // 재로그인 전까지 푸시 대상이 아니다 — 목록에서 `Notifications off`로 정직하게 보인다.
    push?: PushRegistration,
  ): Promise<IssuedSession> {
    const record: SessionRecord = {
      userId: user.id,
      provider: user.provider,
      displayName: user.displayName,
      createdAt: user.createdAt,
      startedAt: Date.now(),
      absoluteExpiresAt: Date.now() + absoluteTtlMs,
      device,
      ...(push ? { pushToken: push.token, locale: push.locale } : {}),
    };
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const ttlSeconds = Math.ceil(idleTtlMs / 1000);

    await this.redis.setEx(sessionKey(id), JSON.stringify(record), ttlSeconds);
    await this.redis.setEx(refreshKey(id), sha256(secret), ttlSeconds);
    await this.pruneIndex(user.id);
    // 인덱스 score는 **Redis 시계**로 찍는다(slideSession과 같은 자리에서). 여기서 앱
    // 시계로 찍으면 이 세션만 다른 시계의 값을 갖게 되고, 밀기·정리와 어긋난다.
    await this.redis.slideSession({
      keys: [sessionKey(id), refreshKey(id)],
      ttlMs: idleTtlMs,
      index: { key: userIndexKey(user.id), member: id },
      // 방금 만든 세션이라 "너무 이르다"로 건너뛰면 안 된다.
      minIntervalMs: 0,
    });

    return {
      sessionId: id,
      refreshCredential: `${id}${CREDENTIAL_SEPARATOR}${secret}`,
    };
  }

  /**
   * 세션의 **유휴 창을 민다**(sliding idle).
   *
   * 창을 미는 것은 회전이 아니라 **활동**이다. 자격증명 교체(rotate)는 사용자가 눌러서
   * 일어날 수도, 서버가 밀어 준 신호 때문에 일어날 수도 있어 그 자리에서는 둘을 구분할 수
   * 없다 — 그래서 미는 일을 떼어 내 "인증된 요청이 서버에 닿는 순간"에 붙였다
   * (`JwtAuthGuard`, plan/auth.md §6).
   *
   * 실패해도 던지지 않는다. 미는 데 실패했다고 요청을 막을 이유가 없다 — 최악이라도
   * 세션이 예정대로 만료될 뿐이고, 그것은 안전한 쪽의 실패다.
   */
  async touch(
    id: string,
    userId: string,
    absoluteExpiresAt: number,
    idleTtlMs: number,
  ): Promise<void> {
    // 레코드를 다시 읽지 않는다 — 부르는 쪽(가드)이 방금 인증하며 읽은 값을 그대로 준다.
    // idle 연장이 absolute 상한을 넘지 않도록 자른다(rotate와 같은 규칙).
    const ttlMs = Math.min(idleTtlMs, absoluteExpiresAt - Date.now());
    if (ttlMs <= 0) return;

    await this.redis.slideSession({
      // 세션 본체와 자격증명은 **함께** 밀어야 한다. 한쪽만 밀면 "본체는 살아 있는데
      // 회전할 수 없는" 또는 그 반대의 세션이 생긴다.
      keys: [sessionKey(id), refreshKey(id)],
      ttlMs,
      // score(만료 시각)는 **Redis가 자기 시계로** 계산한다 — 앱 시계로 찍으면 왕복
      // 시간만큼 실제 키 수명보다 이르게 남아, 그 틈에 목록·전체 폐기가 살아 있는 세션을
      // 놓친다(둘 다 인덱스만 본다).
      index: { key: userIndexKey(userId), member: id },
      minIntervalMs: TOUCH_MIN_INTERVAL_MS,
    });
  }

  // 유효한 세션이면 사용자로 복원한다. 만료는 키 TTL이 처리하므로 조회되면 유효한 것이다.
  async findValid(id: string): Promise<User | null> {
    return (await this.findValidSession(id))?.user ?? null;
  }

  /**
   * `findValid`와 같되 **상한도 함께** 준다.
   *
   * 인증한 요청이 유휴 창을 밀려면 상한을 알아야 하는데, 그 값은 여기서 읽은 레코드에
   * 이미 있다 — 따로 읽으면 요청마다 Redis 왕복이 하나 더 붙는다.
   */
  async findValidSession(
    id: string,
  ): Promise<{ user: User; absoluteExpiresAt: number } | null> {
    const record = await this.readRecord(id);
    if (!record) return null;
    // 상한은 TTL과 별개로 직접 확인한다 — TTL은 초 단위로 올림되고 인덱스 score는
    // 밀리초라, 저장소 수명에만 기대면 상한을 잠깐 넘겨 살아 있을 수 있다.
    if (record.absoluteExpiresAt <= Date.now()) return null;
    return {
      user: {
        id: record.userId,
        provider: record.provider,
        displayName: record.displayName,
        createdAt: record.createdAt,
      },
      absoluteExpiresAt: record.absoluteExpiresAt,
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
      // **회전은 창을 밀지 않는다.** 자격증명 교체는 활동이 아니다 — 사용자가 눌러서 나간
      // 요청일 수도, 서버가 밀어 준 신호 때문에 나간 재조회일 수도 있고 이 자리에서는 둘을
      // 구분할 수 없다. 미는 것은 아래 `touch`이고, 그것은 **요청이 인증될 때** 일어난다
      // (plan/auth.md §6). 그래서 ttlSeconds는 여기서 쓰이지 않고 남은 수명이 유지된다.
      keepTtl: true,
      renewKeys: [sessionKey(id)],
      // 만료 시각이 그대로이므로 인덱스 score도 다시 쓸 것이 없다.
      index: undefined,
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
      absoluteExpiresAt: record.absoluteExpiresAt,
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
        // ⚠️ **파생 불리언만 나간다.** 원본 토큰이 이 객체에 한 번이라도 얹히면
        // 호출부의 스프레드(`{ ...s, isCurrent, isConnected }`)를 타고 **남의 기기
        // 행까지 든 목록에 그대로 실려 나간다**. 토큰을 돌려주는 문은 pushTargetFor뿐이다.
        pushRegistered: record.pushToken !== undefined,
      });
    }
    return sessions;
  }

  // 푸시를 보낼 대상. **토큰을 돌려주는 유일한 메서드다.**
  //
  // 소유권을 여기서 함께 확인한다 — 남의 세션 id를 넣어 남의 기기를 울릴 수 있으면
  // 그것 자체가 공격이다(deleteOwned가 폐기 DoS를 막는 것과 같은 자리).
  //
  // 세 갈래를 **한 번의 읽기로** 가른다. 호출부가 "내 것이 아님"과 "토큰 없음"을 다르게
  // 답해야 하기 때문이다 — 앞의 것은 404(없는 세션과 구별해 주지 않는다), 뒤의 것은
  // `no-token`이다. 두 메서드로 나누면 같은 레코드를 두 번 읽는다.
  async pushTargetFor(userId: string, sessionId: string): Promise<PushLookup> {
    const record = await this.readRecord(sessionId);
    if (!record || record.userId !== userId) return { kind: 'not-owned' };
    if (!record.pushToken) return { kind: 'no-token' };
    return {
      kind: 'ok',
      target: {
        token: record.pushToken,
        locale: record.locale ?? DEFAULT_LOCALE,
      },
    };
  }

  /**
   * 살아 있는 세션에 등록 토큰을 붙인다. **유휴 창은 밀지 않는다.**
   *
   * 원래는 이 문을 열지 않았다(§5-2) — 세션 레코드를 고치면 남은 TTL을 보존해야 하는데
   * `setEx`뿐이라 수명이 리셋되기 때문이었다. 그 사이 `SET ... KEEPTTL`이 들어와
   * 기술적 이유는 사라졌고, 남은 것은 판단이었다. **재로그인 한 번**으로 치기엔 대가가
   * 컸다: 권한을 준 뒤 로그인을 두 번 해야 하고, 그 사실을 화면이 계속 설명해야 했다.
   *
   * 그래서 로그인 화면에서 권한을 먼저 받는 흐름을 버리고, 푸시 화면이 권한과 등록을
   * 함께 처리한다. 자세한 것은 plan/push.md §5-2.
   *
   * 소유권은 여기서 확인한다 — 남의 세션 id로 남의 기기에 토큰을 심을 수 있으면
   * 그것 자체가 공격이다(`pushTargetFor`와 같은 자리).
   *
   * **활동으로 치지 않는다.** 알림을 켜는 것은 사용자의 손짓이지만, 그것으로 세션 수명을
   * 밀면 유휴 창이 "손을 뗀 지 얼마나 됐나"를 말하지 않게 된다(plan/auth.md §6).
   */
  async attachPushToken(
    userId: string,
    sessionId: string,
    push: PushRegistration,
  ): Promise<boolean> {
    const record = await this.readRecord(sessionId);
    if (!record || record.userId !== userId) return false;
    return this.redis.setKeepTtl(
      sessionKey(sessionId),
      JSON.stringify({
        ...record,
        pushToken: push.token,
        locale: push.locale,
      }),
    );
  }

  /**
   * 이 세션을 푸시 대상에서 뺀다. **권한을 되돌리는 것이 아니다.**
   *
   * 브라우저·OS의 알림 권한은 한 방향으로만 움직여 앱이 끌 수 없다 — 끌 수 있는 것은
   * "이 세션이 푸시 대상인가"뿐이고, 그것이 목록의 `Notifications off`가 말하는 값이다.
   * 그래서 화면의 토글도 딱 그만큼만 약속한다(plan/push.md §5-15).
   *
   * `attachPushToken`과 같은 규칙이다 — 소유권을 확인하고, 유휴 창은 밀지 않는다.
   * 기기의 등록 토큰 자체는 그대로 두므로 다시 켜는 데 권한 창이 필요하지 않다.
   */
  async clearPushToken(userId: string, sessionId: string): Promise<boolean> {
    const record = await this.readRecord(sessionId);
    if (!record || record.userId !== userId) return false;
    // 필드를 지운다 — `undefined`로 두면 JSON.stringify가 키를 빼므로 readRecord가
    // 예전 세션과 같은 모양으로 읽는다(`pushToken`이 없으면 대상이 아니다).
    const { pushToken: _dropped, ...rest } = record;
    return this.redis.setKeepTtl(sessionKey(sessionId), JSON.stringify(rest));
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
        // device와 **같은 규칙**으로 접는다 — 이 필드들이 생기기 전에 만들어진 세션은
        // 값이 없다. 거부하면 배포 순간에 살아 있던 세션이 통째로 사라진다.
        ...(typeof obj.pushToken === 'string' &&
        obj.pushToken.length > 0 &&
        obj.pushToken.length <= MAX_PUSH_TOKEN_LENGTH
          ? { pushToken: obj.pushToken }
          : {}),
        locale: LOCALES.find((l) => l === obj.locale) ?? DEFAULT_LOCALE,
      };
    } catch {
      return null;
    }
  }

  // 지나간 항목을 인덱스에서 걷어낸다. 본체는 TTL로 이미 사라졌으므로 인덱스만 정리하면 된다.
  private async pruneIndex(userId: string): Promise<void> {
    // 자르는 기준도 **Redis 시계**다 — score를 Redis가 찍으므로 섞으면 시계 차이만큼
    // 살아 있는 항목을 지우거나 죽은 항목을 남긴다.
    await this.redis.pruneExpired(userIndexKey(userId));
  }
}
