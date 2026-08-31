import { Injectable } from '@nestjs/common';
import type { SocketServerMessage } from '@app/common';
import type { SocketConnection } from './connection';

// 지금 이 프로세스에 붙어 있는 연결들. 알림을 누구에게 보낼지 정하는 곳이다.
//
// ⚠️ **프로세스 메모리다 — replicaCount: 1일 때만 온전하다.**
// 파드를 늘리면 presence 자체는 여전히 정확하다(공유 Redis에 있다). 깨지는 것은
// `sessionsChanged` 알림의 도달 범위뿐이고, 다른 파드에 붙은 클라이언트는 자동으로
// 회복되지 않는다 — 사용자가 당겨서 새로고침해야 한다. "우아한 저하"가 아니라
// **실시간 갱신 누락**이므로, 파드를 늘리기 전에 아래 승격을 먼저 해야 한다.
//
// 승격 방법: RedisClient에 publish/subscribe를 더하고(IoredisService는 구독 전용
// 연결을 하나 더 열어야 한다 — 구독 모드에서는 일반 명령을 못 쓴다), 아래 broadcast를
// publish + 로컬 배달로 바꾼다. 변경은 이 파일 안에서 끝난다.
// (plan/webrtc.md가 방 상태에 대해 적어 둔 것과 같은 경로다)
@Injectable()
export class ConnectionRegistry {
  private readonly byUser = new Map<string, Set<SocketConnection>>();

  add(connection: SocketConnection): void {
    const set = this.byUser.get(connection.userId) ?? new Set();
    set.add(connection);
    this.byUser.set(connection.userId, set);
  }

  remove(connection: SocketConnection): void {
    const set = this.byUser.get(connection.userId);
    if (!set) return;
    set.delete(connection);
    // 빈 집합을 남기면 로그인했다 나간 사용자 수만큼 키가 쌓인다.
    if (set.size === 0) this.byUser.delete(connection.userId);
  }

  // 아직 등록되어 있는가. 스윕이 비동기 작업을 마치고 돌아왔을 때, 그 사이에 소켓이
  // 닫혔는지 확인하는 데 쓴다 — 확인하지 않으면 이미 지운 presence를 되살린다.
  has(connection: SocketConnection): boolean {
    return this.byUser.get(connection.userId)?.has(connection) ?? false;
  }

  connectionsOf(userId: string): SocketConnection[] {
    return [...(this.byUser.get(userId) ?? [])];
  }

  // 이 세션이 지금 붙들고 있는 연결들. **통화가 상대를 찾는 경로다.**
  //
  // presence(Redis)를 보지 않는 이유는 둘이 답하는 질문이 다르기 때문이다 — presence는
  // "어딘가에 붙어 있나"이고 여기서 필요한 것은 "**내가 지금 배달할 수 있나**"이다.
  // 파드가 늘면 두 답이 갈리는데, 그때 승격해야 하는 자리가 곧 broadcast와 같다.
  connectionsOfSession(userId: string, sessionId: string): SocketConnection[] {
    return this.connectionsOf(userId).filter((c) => c.sessionId === sessionId);
  }

  all(): SocketConnection[] {
    return [...this.byUser.values()].flatMap((set) => [...set]);
  }

  // `exclude`는 "이 알림의 원인이었고, 그래서 이미 알고 있는 연결"이다.
  // 방금 붙은 연결이 자기 접속을 자기가 통보받으면 목록을 한 번 더 가져오게 된다.
  broadcast(
    userId: string,
    message: SocketServerMessage,
    exclude?: SocketConnection | null,
  ): void {
    for (const connection of this.connectionsOf(userId)) {
      if (connection === exclude) continue;
      connection.send(message);
    }
  }
}
