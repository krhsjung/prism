import { FakeRedis } from '@app/redis/testing/fake-redis';
import {
  PRESENCE_RENEW_MS,
  PresenceRepository,
  SessionsRepository,
  type SocketServerMessage,
  type User,
} from '@app/common';
import type { SocketConnection } from './connection';
import { ConnectionRegistry } from './connection-registry';
import { SessionPresenceGateway } from './session-presence.gateway';

const user: User = {
  id: 'u-1',
  provider: 'google',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// 소켓 없이 도메인 로직만 본다 — 게이트웨이가 `ws`가 아니라 SocketConnection에만
// 의존하도록 짠 이유가 이것이다.
class FakeConnection implements SocketConnection {
  sent: SocketServerMessage[] = [];
  closed = false;
  probes = 0;

  constructor(
    readonly id: string,
    readonly userId: string,
    readonly sessionId: string,
  ) {}

  send(message: SocketServerMessage): void {
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
  }

  probe(): void {
    this.probes++;
  }

  types(): string[] {
    return this.sent.map((m) => m.type);
  }
}

describe('SessionPresenceGateway', () => {
  let redis: FakeRedis;
  let registry: ConnectionRegistry;
  let presence: PresenceRepository;
  let sessions: { findValid: jest.Mock };
  let gateway: SessionPresenceGateway;

  beforeEach(() => {
    jest.useFakeTimers();
    redis = new FakeRedis();
    registry = new ConnectionRegistry();
    presence = new PresenceRepository(redis);
    sessions = { findValid: jest.fn(() => Promise.resolve(user)) };
    gateway = new SessionPresenceGateway(
      registry,
      presence,
      sessions as object as SessionsRepository,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const connected = () => presence.connectedSessionIds('u-1');

  // 알림은 모아 보내므로, 확인하려면 창이 닫힐 만큼 시계를 밀어야 한다.
  const flush = async () => {
    jest.advanceTimersByTime(100);
    await Promise.resolve();
  };

  it('연결되면 presence에 등록되고 ready를 먼저 받는다', async () => {
    const c = new FakeConnection('c-1', 'u-1', 's-1');
    await gateway.open(c);

    expect(c.sent[0]).toEqual({ type: 'ready' });
    expect([...(await connected())]).toEqual(['s-1']);
  });

  // ⚠️ 회귀 방지: 자기 접속을 자기가 통보받으면 목록을 한 번 더 가져온다.
  // 로그인 한 번에 GET /auth/sessions가 3~4번 나가던 원인이 이것이었다.
  // 알 필요도 없다 — 다른 기기의 presence는 각자의 소켓이 쓴 값이라 이미 정확하고,
  // 자기 행은 목록에서 isCurrent로 그려져 isConnected를 읽지도 않는다.
  it('방금 붙은 연결은 자기 접속 알림을 받지 않는다', async () => {
    const c = new FakeConnection('c-1', 'u-1', 's-1');
    await gateway.open(c);
    await flush();

    expect(c.types()).toEqual(['ready']);
  });

  // 제외의 핵심 예외. 창 안에서 원인이 둘이면 각자를 빼는 순간 **서로의 접속을 아무도
  // 모르게 된다** — 그때는 아무도 빼지 않는다.
  it('탭 둘이 같은 창에서 붙으면 둘 다 알림을 받는다', async () => {
    const first = new FakeConnection('c-1', 'u-1', 's-1');
    const second = new FakeConnection('c-2', 'u-1', 's-2');

    await gateway.open(first);
    await gateway.open(second); // 코얼레싱 창(50ms) 안이다
    await flush();

    expect(first.types()).toContain('sessionsChanged');
    expect(second.types()).toContain('sessionsChanged');
  });

  // 종료는 origin이 없다(끊긴 연결은 이미 레지스트리에 없다) — 남은 전원이 받아야 한다.
  // 접속 알림의 제외가 뒤이은 종료 알림까지 삼키면 안 된다.
  it('접속 직후의 종료 알림은 남은 전원이 받는다', async () => {
    const watcher = new FakeConnection('c-0', 'u-1', 's-0');
    await gateway.open(watcher);
    await flush();
    watcher.sent = [];

    const leaving = new FakeConnection('c-1', 'u-1', 's-1');
    await gateway.open(leaving);
    await gateway.close(leaving); // 같은 창 안에서 붙었다 끊긴다
    await flush();

    expect(watcher.types()).toContain('sessionsChanged');
  });

  // 다른 기기가 붙었다는 것을 이미 붙어 있던 기기가 알아야 목록이 그 자리에서 갱신된다.
  it('둘째 기기가 붙으면 첫 기기에 sessionsChanged가 간다', async () => {
    const first = new FakeConnection('c-1', 'u-1', 's-1');
    await gateway.open(first);
    await flush();
    first.sent = [];

    await gateway.open(new FakeConnection('c-2', 'u-1', 's-2'));
    await flush();

    expect(first.types()).toContain('sessionsChanged');
  });

  it('연결이 끊기면 presence에서 빠지고 남은 기기에 알린다', async () => {
    const first = new FakeConnection('c-1', 'u-1', 's-1');
    const second = new FakeConnection('c-2', 'u-1', 's-2');
    await gateway.open(first);
    await gateway.open(second);
    await flush();
    first.sent = [];

    await gateway.close(second);
    await flush();

    expect([...(await connected())]).toEqual(['s-1']);
    expect(first.types()).toContain('sessionsChanged');
  });

  // 신호에는 페이로드가 없어 여러 번을 한 번으로 접어도 잃는 정보가 없다.
  // 접지 않으면 탭이 함께 깨어날 때 알림 폭풍이 곧 재조회 폭풍이 된다.
  it('동시에 여럿이 붙어도 알림 하나로 합쳐진다', async () => {
    const watcher = new FakeConnection('c-0', 'u-1', 's-0');
    await gateway.open(watcher);
    await flush();
    watcher.sent = [];

    await gateway.open(new FakeConnection('c-1', 'u-1', 's-1'));
    await gateway.open(new FakeConnection('c-2', 'u-1', 's-2'));
    await gateway.open(new FakeConnection('c-3', 'u-1', 's-3'));
    await flush();

    expect(watcher.types().filter((t) => t === 'sessionsChanged')).toHaveLength(
      1,
    );
  });

  it('다른 사용자에게는 알리지 않는다', async () => {
    const mine = new FakeConnection('c-1', 'u-1', 's-1');
    const theirs = new FakeConnection('c-9', 'u-2', 's-9');
    await gateway.open(mine);
    await gateway.open(theirs);
    await flush();
    theirs.sent = [];

    await gateway.open(new FakeConnection('c-2', 'u-1', 's-2'));
    await flush();

    expect(theirs.types()).not.toContain('sessionsChanged');
  });

  describe('스윕', () => {
    it('presence를 갱신해 만료를 뒤로 민다', async () => {
      await gateway.open(new FakeConnection('c-1', 'u-1', 's-1'));

      // 갱신이 없었다면 TTL(60s)이 지나 사라졌을 만큼 민다.
      for (let i = 0; i < 4; i++) {
        jest.advanceTimersByTime(PRESENCE_RENEW_MS);
        await gateway.tick();
      }

      expect([...(await connected())]).toEqual(['s-1']);
    });

    it('하트비트를 보내고 프로토콜 ping을 찌른다', async () => {
      const c = new FakeConnection('c-1', 'u-1', 's-1');
      await gateway.open(c);
      c.sent = [];

      await gateway.tick();

      expect(c.types()).toContain('heartbeat');
      expect(c.probes).toBe(1);
    });

    // 다른 기기에서 폐기된 세션이 소켓을 계속 붙들고 있으면 안 된다.
    // 코드를 실어 보내는 이유는 클라이언트가 "갱신하면 살아나는가"를 판단해야 하기 때문이다.
    it('폐기된 세션은 UNAUTHORIZED를 받고 닫힌다', async () => {
      const c = new FakeConnection('c-1', 'u-1', 's-1');
      await gateway.open(c);
      c.sent = [];
      sessions.findValid.mockResolvedValue(null);

      await gateway.tick();

      expect(c.sent).toContainEqual({
        type: 'error',
        code: 'UNAUTHORIZED',
      });
      expect(c.closed).toBe(true);
      expect((await connected()).size).toBe(0);
    });

    // ⚠️ 회귀 방지: 세션이 아니라 토큰을 재검증하면 액세스 토큰이 15분이라
    // 멀쩡한 소켓이 첫 틱에 죽는다. 스윕은 findValid만 본다.
    it('세션이 살아 있으면 몇 틱이 지나도 끊지 않는다', async () => {
      const c = new FakeConnection('c-1', 'u-1', 's-1');
      await gateway.open(c);

      for (let i = 0; i < 10; i++) await gateway.tick();

      expect(c.closed).toBe(false);
    });

    // findValid를 기다리는 사이에 소켓이 닫히는 경합. 확인하지 않고 touch하면
    // close가 방금 지운 presence를 되살려 끊긴 기기가 최대 1분간 Active로 남는다.
    it('검증 중에 닫힌 연결의 presence를 되살리지 않는다', async () => {
      const c = new FakeConnection('c-1', 'u-1', 's-1');
      await gateway.open(c);

      // findValid가 떠 있는 동안 소켓이 닫히도록 만든다.
      sessions.findValid.mockImplementation(async () => {
        await gateway.close(c);
        return user;
      });

      await gateway.tick();

      expect((await connected()).size).toBe(0);
    });
  });

  // 롤아웃마다 1분씩 "붙어 있음"이 남으면 안 된다.
  // 세션 폐기는 auth 서비스가 처리하고 socket은 그 사실을 전달받는 통로가 없다 —
  // 스윕이 돌 때까지(최대 PRESENCE_RENEW_MS) 폐기된 기기가 멀쩡히 앉아 있다.
  // 해제한 클라이언트가 자기 소켓으로 깨워 주면 그 자리에서 끝난다.
  describe('재검증(sessionsRevoked)', () => {
    it('폐기된 연결을 즉시 끊는다 — 스윕을 기다리지 않는다', async () => {
      const revoker = new FakeConnection('c-1', 'u-1', 's-1');
      const revoked = new FakeConnection('c-2', 'u-1', 's-2');
      await gateway.open(revoker);
      await gateway.open(revoked);
      // 폐기된 것은 s-2뿐이다.
      sessions.findValid.mockImplementation((sessionId: string) =>
        Promise.resolve(sessionId === 's-2' ? null : user),
      );

      await gateway.resync(revoker);

      expect(revoked.sent).toContainEqual({
        type: 'error',
        code: 'UNAUTHORIZED',
      });
      expect(revoked.closed).toBe(true);
      // 멀쩡한 세션은 그대로다.
      expect(revoker.closed).toBe(false);
    });

    it('남은 기기에 sessionsChanged가 간다', async () => {
      const revoker = new FakeConnection('c-1', 'u-1', 's-1');
      const other = new FakeConnection('c-2', 'u-1', 's-2');
      const revoked = new FakeConnection('c-3', 'u-1', 's-3');
      await gateway.open(revoker);
      await gateway.open(other);
      await gateway.open(revoked);
      revoker.sent = [];
      other.sent = [];
      sessions.findValid.mockImplementation((sessionId: string) =>
        Promise.resolve(sessionId === 's-3' ? null : user),
      );

      await gateway.resync(revoker);
      jest.advanceTimersByTime(100);

      expect(other.types()).toContain('sessionsChanged');
    });

    // 소켓이 없는 세션을 폐기했을 수도 있다 — 끊을 것이 없어도 남은 기기의 목록은
    // 바뀌었으므로 알려야 한다.
    it('끊을 것이 없어도 알린다', async () => {
      const revoker = new FakeConnection('c-1', 'u-1', 's-1');
      const other = new FakeConnection('c-2', 'u-1', 's-2');
      await gateway.open(revoker);
      await gateway.open(other);
      other.sent = [];

      await gateway.resync(revoker);
      jest.advanceTimersByTime(100);

      expect(other.types()).toContain('sessionsChanged');
      expect(other.closed).toBe(false);
    });

    // 신호에는 아무 권한도 실려 있지 않다 — 무엇이 폐기됐는지는 세션 저장소만 안다.
    it('남의 연결은 건드리지 않는다', async () => {
      const mine = new FakeConnection('c-1', 'u-1', 's-1');
      const theirs = new FakeConnection('c-2', 'u-2', 's-2');
      await gateway.open(mine);
      await gateway.open(theirs);
      theirs.sent = [];
      sessions.findValid.mockResolvedValue(null);

      await gateway.resync(mine);
      jest.advanceTimersByTime(100);

      expect(theirs.closed).toBe(false);
      expect(theirs.sent).toEqual([]);
    });
  });

  it('종료 시 presence를 걷어내고 연결을 닫는다', async () => {
    const c = new FakeConnection('c-1', 'u-1', 's-1');
    await gateway.open(c);

    await gateway.onModuleDestroy();

    expect((await connected()).size).toBe(0);
    expect(c.closed).toBe(true);
  });
});
