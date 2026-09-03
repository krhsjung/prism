import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  AUTH_ERROR_CODES,
  PRESENCE_RENEW_MS,
  PresenceRepository,
  SessionsRepository,
  type AuthErrorCode,
} from '@app/common';
import type { SocketConnection } from './connection';
import { ConnectionRegistry } from './connection-registry';

// 같은 사용자에게 갈 알림을 모으는 창.
//
// 탭 여럿이 함께 깨어나거나 앱이 포그라운드로 돌아오면 연결 이벤트가 한꺼번에 터진다.
// 그때마다 알리면 **클라이언트마다 재조회가 한 번씩** 나가 알림 폭풍이 조회 폭풍이 된다.
// 신호에는 페이로드가 없어 여러 번을 한 번으로 접어도 잃는 정보가 없다.
const BROADCAST_COALESCE_MS = 50;

// 인증을 기다려 주는 시간. 101은 됐는데 아무 말도 하지 않는 소켓이 남아 있으면 안 된다.
const AUTH_DEADLINE_MS = 5_000;

// presence의 주인.
//
// **데이터는 나르지 않고 신호만 나른다**(contracts.ts의 소켓 프로토콜 주석 참고).
// 목록은 클라이언트가 GET /auth/sessions로 다시 가져가고, 그 경로에만 붙어 있는
// 스탬핑·공유 회전·중앙 거절이 그대로 지켜진다.
@Injectable()
export class SessionPresenceGateway implements OnModuleDestroy {
  private readonly logger = new Logger(SessionPresenceGateway.name);
  // 사용자별로 모아 두는 알림 한 건. `exclude`는 이 창의 **유일한** 원인이었던 연결이다
  // (자기 접속을 자기가 통보받을 필요는 없다 — scheduleBroadcast 주석 참고).
  private readonly pending = new Map<
    string,
    { timer: NodeJS.Timeout; exclude: SocketConnection | null }
  >();
  private sweep: NodeJS.Timeout | null = null;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly presence: PresenceRepository,
    private readonly sessions: SessionsRepository,
  ) {}

  // 인증을 통과한 연결이 들어왔다.
  async open(connection: SocketConnection): Promise<void> {
    this.registry.add(connection);
    await this.presence.touch(
      connection.userId,
      connection.sessionId,
      connection.id,
    );
    // ready는 "이제 isConnected를 믿어도 된다"는 신호**일 뿐**이다 — 목록을 가져오라는
    // 신호가 아니다.
    //
    // 이 연결이 알아야 할 것은 이미 다 알고 있다: 다른 기기의 presence는 각자의 소켓이
    // 쓴 값이라 우리가 붙는 것과 무관하게 정확하고, 우리 자신의 행은 목록에서 `isCurrent`로
    // 그려져 `isConnected`를 읽지도 않는다. 그래서 아래 알림에서 **자기 자신은 뺀다** —
    // 넣으면 한 번 붙을 때마다 조회가 두 번 나간다.
    connection.send({ type: 'ready' });
    this.scheduleBroadcast(connection.userId, connection);
  }

  // 연결이 닫혔다(정상 종료·회선 끊김·우리가 끊음 — 어느 쪽이든 같다).
  async close(connection: SocketConnection): Promise<void> {
    // 등록되어 있지 않으면 이미 처리된 것이다 — presence를 두 번 지우거나
    // 알림을 두 번 보내지 않는다.
    if (!this.registry.has(connection)) return;
    this.registry.remove(connection);
    // TTL을 기다리지 않는다 — 기다리면 앱을 닫은 뒤에도 다른 기기의 목록에 최대 1분간
    // Active로 남는다.
    await this.presence.remove(
      connection.userId,
      connection.sessionId,
      connection.id,
    );
    this.scheduleBroadcast(connection.userId);
  }

  // 인증 실패. 코드를 먼저 실어 보내고 닫는다 — 클라이언트가 "갱신하면 살아나는가"를
  // 판단할 수 있어야 한다(SESSION_EXPIRED만 갱신으로 살아난다).
  reject(connection: SocketConnection, code: AuthErrorCode): void {
    connection.send({ type: 'error', code });
    connection.close();
  }

  /**
   * "방금 세션을 폐기했다"는 신호를 받았다. **믿지 않고 다시 읽는다.**
   *
   * 스윕이 결국 같은 일을 하지만 최대 PRESENCE_RENEW_MS만큼 늦다 — 해제한 사람은 상대
   * 기기가 즉시 쫓겨나기를 기대한다. 클라이언트가 깨워 주면 그 자리에서 확인할 수 있고,
   * 신호 자체에는 아무 권한도 실려 있지 않다: 무엇이 폐기됐는지는 **세션 저장소만** 안다.
   *
   * 그래서 남이 이 메시지를 보내도 얻는 것이 없다 — 자기 사용자의 연결을 한 번 더
   * 검증하게 만들 뿐이고, 멀쩡한 세션은 그대로 남는다.
   */
  async resync(origin: SocketConnection): Promise<void> {
    for (const connection of this.registry.connectionsOf(origin.userId)) {
      const user = await this.sessions.findValid(connection.sessionId);
      if (user) continue;
      // 로그아웃·만료·다른 기기에서 폐기됨 — 스윕과 같은 처리다.
      this.reject(connection, AUTH_ERROR_CODES.UNAUTHORIZED);
      await this.close(connection);
    }
    // 소켓이 없는 세션을 폐기했을 수도 있다(끊을 것이 없어 위 루프가 조용하다) —
    // 그때도 남은 기기의 목록은 바뀌었으므로 알린다. 폐기한 쪽은 HTTP 응답으로
    // 이미 최신이라 빼 둔다.
    this.scheduleBroadcast(origin.userId, origin);
  }

  start(): void {
    if (this.sweep) return;
    this.sweep = setInterval(() => void this.tick(), PRESENCE_RENEW_MS);
    // 타이머 하나 때문에 프로세스가 안 죽는 일이 없게 한다.
    this.sweep.unref?.();
  }

  // 주기 스윕 — 한 번에 세 가지 일을 한다.
  //
  //  1) 반쯤 죽은 TCP 잡기(프로토콜 ping/pong)
  //  2) **다른 기기에서 폐기된 세션** 끊기
  //  3) presence 갱신(하트비트)
  //
  // ⚠️ 여기서 재검증하는 것은 **세션이지 토큰이 아니다.** 액세스 토큰은 15분인데 소켓은
  // 몇 시간을 사므로, verifySession을 다시 돌리면 멀쩡한 소켓이 첫 틱에 죽는다.
  // 세션 레코드의 TTL은 클라이언트의 평상시 /auth/refresh 트래픽이 밀어 준다.
  async tick(): Promise<void> {
    for (const connection of this.registry.all()) {
      // 하트비트는 app-level이다 — 브라우저 JS는 프로토콜 ping/pong을 관찰할 수 없어,
      // 이것이 없으면 웹이 죽은 서버를 붙들고 몇 시간이고 앉아 있는다.
      connection.send({ type: 'heartbeat' });
      connection.probe();

      const user = await this.sessions.findValid(connection.sessionId);
      if (!user) {
        // 로그아웃·만료·다른 기기에서 폐기됨. 셋을 구분할 방법이 없고 구분할 이유도 없다.
        this.reject(connection, AUTH_ERROR_CODES.UNAUTHORIZED);
        await this.close(connection);
        continue;
      }

      // findValid를 기다리는 사이에 소켓이 닫혔을 수 있다. 확인하지 않고 touch하면
      // close가 방금 지운 presence를 되살려, 끊긴 기기가 최대 1분간 Active로 남는다.
      if (!this.registry.has(connection)) continue;
      await this.presence.touch(
        connection.userId,
        connection.sessionId,
        connection.id,
      );
    }
  }

  // 알림을 모아 보낸다(위 BROADCAST_COALESCE_MS 주석 참고).
  //
  // `origin`은 이 알림을 **일으킨** 연결이다. 자기 접속을 자기가 통보받을 이유가 없어
  // 대상에서 빼는데, ⚠️ **혼자 원인일 때만** 그렇다. 탭 둘이 같은 창 안에서 붙으면
  // 원인이 둘인데 각자를 자기 것에서 빼면 **서로의 접속을 아무도 모르게 된다** —
  // 그때는 아무도 빼지 않고 둘 다 보낸다(각자 한 번 더 가져오지만 정확하다).
  private scheduleBroadcast(userId: string, origin?: SocketConnection): void {
    const existing = this.pending.get(userId);
    if (existing) {
      // 원인이 갈렸다(다른 연결이거나, origin 없는 이벤트 — 종료·폐기) → 전원에게.
      if (existing.exclude !== (origin ?? null)) existing.exclude = null;
      return;
    }
    const timer = setTimeout(() => {
      const entry = this.pending.get(userId);
      this.pending.delete(userId);
      this.registry.broadcast(
        userId,
        { type: 'sessionsChanged' },
        entry?.exclude,
      );
    }, BROADCAST_COALESCE_MS);
    timer.unref?.();
    this.pending.set(userId, { timer, exclude: origin ?? null });
  }

  // 파드가 내려간다. presence를 걷어내지 않으면 다른 기기의 목록에 최대 PRESENCE_TTL_MS
  // 동안 "붙어 있음"이 남는다 — 롤아웃마다 1분씩 거짓말을 하게 된다.
  async onModuleDestroy(): Promise<void> {
    if (this.sweep) clearInterval(this.sweep);
    this.sweep = null;
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();

    for (const connection of this.registry.all()) {
      this.registry.remove(connection);
      try {
        await this.presence.remove(
          connection.userId,
          connection.sessionId,
          connection.id,
        );
      } catch (error) {
        // Redis가 먼저 내려갔을 수 있다. 여기서 던지면 나머지 연결이 정리되지 않는다 —
        // 남은 항목은 TTL이 치운다.
        this.logger.warn(
          `presence cleanup failed on shutdown: ${String(error)}`,
        );
      }
      connection.close();
    }
  }

  get authDeadlineMs(): number {
    return AUTH_DEADLINE_MS;
  }
}
