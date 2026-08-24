import { Inject, Injectable } from '@nestjs/common';
import { REDIS, type RedisClient } from '@app/redis';

// 지금 소켓을 붙들고 있는 세션들. 대시보드의 `SessionListItem.isConnected`가 읽는 값이다.
//
// **세션과 별개의 저장소인 이유**는 수명이 다르기 때문이다. 세션은 몇 시간~7일을 살고
// 리프레시로 연장되지만, 연결은 앱을 백그라운드로 내리는 순간 끝난다. 세션 레코드에
// 필드로 얹으면 연결이 끊길 때마다 세션 본체를 다시 써야 하고, 그러면 쓰기 경합이
// 리프레시 회전(compareAndRenew)과 겹친다.
//
// **쓰는 쪽과 읽는 쪽이 다른 프로세스다.** socket 서비스가 쓰고 auth 서비스가 읽는다.
// 그래서 프로세스 메모리가 아니라 (두 서비스가 공유하는) Redis에 둔다.
//
// 저장 구조는 SessionsRepository의 사용자별 인덱스를 **그대로 베꼈다** — 정렬 집합에
// score를 만료 시각으로 두고, 접근할 때 지나간 항목을 걷어낸다. 정리가 두 겹인 것도 같다:
// 읽을 때 pruneExpired가 걷어내고, 그와 별개로 집합 키 자체가 마지막 항목의 만료 시각에
// 사라진다(zAdd의 Lua가 PEXPIREAT을 top score로 걸어 준다). 두 번째가 없으면 다시
// 돌아오지 않는 사용자의 키가 영원히 남는다.
//
// 이 구조를 고른 결과로 **RedisClient에 새 명령을 하나도 더하지 않았다** — 실 Redis가
// 필요한 통합 스펙(PRISM_REDIS_URL 게이트)을 건드리지 않는다는 뜻이다.

// 하드 크래시(정상 종료 없이 죽은 프로세스·끊긴 회선)가 Active로 남아 있을 수 있는
// 최대 시간. 정상 종료는 즉시 지우므로 이 값은 **비정상 종료에만** 해당한다.
export const PRESENCE_TTL_MS = 60_000;

// socket 서비스가 자기 연결을 훑으며 presence를 갱신하는 주기.
// TTL의 1/3이라 한 번을 통째로 거르더라도 아직 만료되지 않는다.
export const PRESENCE_RENEW_MS = 20_000;

const userPresenceKey = (userId: string) => `prism:user_presence:${userId}`;

// member는 `<sessionId>:<connectionId>`다.
//
// 세션 하나가 소켓을 **여럿** 열 수 있다(브라우저 탭 여러 개). member를 sessionId만으로
// 두면 탭 하나를 닫을 때 다른 탭이 붙들고 있는 presence까지 지워진다 — 연결 단위로 세고
// 세션 단위로 읽어야 "하나라도 살아 있으면 연결됨"이 성립한다.
//
// 세션 id는 randomUUID()라 콜론을 담지 않으므로 첫 콜론으로 가르면 모호하지 않다.
const MEMBER_SEPARATOR = ':';
const memberOf = (sessionId: string, connectionId: string) =>
  `${sessionId}${MEMBER_SEPARATOR}${connectionId}`;

const sessionIdOf = (member: string): string | null => {
  const at = member.indexOf(MEMBER_SEPARATOR);
  // 구분자가 없거나 맨 앞이면 우리가 쓴 형식이 아니다 — 조용히 버린다.
  return at > 0 ? member.slice(0, at) : null;
};

@Injectable()
export class PresenceRepository {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  // 연결을 등록한다. **최초 등록과 하트비트가 같은 호출이다** — ZADD가 이미 있는 member의
  // score를 덮어쓰므로 "있으면 갱신, 없으면 추가"를 따로 나눌 이유가 없다.
  //
  // 여기서는 만료된 항목을 걷어내지 않는다. 지나간 항목의 score는 언제나 방금 넣은 것보다
  // **낮으므로** 집합 키의 수명(top score)을 늘리지 못하고, 정리는 읽는 쪽이 어차피 한다.
  // 연결마다 20초씩 도는 경로라 명령 하나를 아끼는 편이 낫다.
  async touch(
    userId: string,
    sessionId: string,
    connectionId: string,
  ): Promise<void> {
    await this.redis.zAdd(
      userPresenceKey(userId),
      Date.now() + PRESENCE_TTL_MS,
      memberOf(sessionId, connectionId),
    );
  }

  // 연결이 정상적으로 닫혔다. TTL을 기다리지 않고 즉시 지운다 —
  // 기다리면 사용자가 앱을 닫은 뒤에도 다른 기기의 목록에 최대 1분간 Active로 남는다.
  async remove(
    userId: string,
    sessionId: string,
    connectionId: string,
  ): Promise<void> {
    await this.redis.zRem(
      userPresenceKey(userId),
      memberOf(sessionId, connectionId),
    );
  }

  // 이 사용자의 세션 중 지금 연결을 붙들고 있는 것들.
  //
  // 세션 id가 아니라 연결이 담겨 있으므로 접두어만 거둬 집합으로 접는다 — 한 세션이
  // 소켓을 셋 열고 있어도 결과에는 한 번만 나온다.
  async connectedSessionIds(userId: string): Promise<Set<string>> {
    const key = userPresenceKey(userId);
    await this.redis.zRemRangeByScore(key, 0, Date.now());
    const items = await this.redis.zRangeWithScores(key);
    const ids = new Set<string>();
    for (const { member } of items) {
      const sessionId = sessionIdOf(member);
      if (sessionId) ids.add(sessionId);
    }
    return ids;
  }
}
