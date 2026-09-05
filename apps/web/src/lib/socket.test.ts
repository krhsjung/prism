import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 소켓은 만료를 만나면 **기존 공유 회전**을 타야 한다 — 자기 회전을 새로 시작하면
// 1회용 리프레시 자격증명이 두 번 소비돼 멀쩡한 세션이 죽는다.
vi.mock('./api', () => ({
  api: { refreshSession: vi.fn() },
}));
import { api } from './api';
import { connectSessionSocket, type SessionSocket } from './socket';
import type { CallServerMessage } from './contracts.gen';

// 실제 WebSocket 대신 열고 닫고 메시지를 밀어 넣을 수 있는 가짜.
class FakeSocket {
  static instances: FakeSocket[] = [];
  // 실제 WebSocket의 상수. socket.ts가 `WebSocket.OPEN`으로 읽으므로 가짜도 가져야 한다.
  static readonly OPEN = 1;
  readyState = 0;
  // 클라 → 서버로 나간 프레임(JSON 문자열).
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  closed = false;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: string) {
    this.sent.push(data);
  }

  emit(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  // 서버가 끊거나 회선이 죽은 경우 — 어느 쪽이든 클라이언트가 보는 것은 close뿐이다.
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  close() {
    this.closed = true;
    this.drop();
  }
}

const latest = () => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('no socket was created');
  return socket;
};

describe('세션 소켓', () => {
  let handle: SessionSocket | null = null;
  let changed: number;
  let ready: boolean[];
  // 통화 메시지는 presence와 같은 소켓으로 오지만 다른 계약이다 — 갈라져 오는지 본다.
  let callMessages: CallServerMessage[];

  beforeEach(() => {
    vi.useFakeTimers();
    // 모듈 mock의 호출 이력은 restoreAllMocks로 지워지지 않는다.
    vi.clearAllMocks();
    FakeSocket.instances = [];
    changed = 0;
    ready = [];
    callMessages = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    // 지터가 섞여 있어 재연결 시점이 흔들린다 — 테스트에서는 상한으로 고정한다.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.mocked(api.refreshSession).mockResolvedValue({
      ok: true,
      ttlMs: 900_000,
      rejected: false,
    });

    handle = connectSessionSocket({
      onSessionsChanged: () => {
        changed++;
      },
      onReadyChange: (next) => ready.push(next),
      onCallMessage: (message) => callMessages.push(message),
    });
  });

  afterEach(() => {
    handle?.close();
    handle = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ready는 붙었다고만 알린다', () => {
    latest().open();
    latest().emit({ type: 'ready' });

    expect(ready.at(-1)).toBe(true);
  });

  // ⚠️ 회귀 방지: 로그인 한 번에 조회가 한 번이어야 한다.
  //
  // 첫 연결에서 가져올 이유가 없다 — 화면이 마운트에서 이미 가져왔고 그 데이터는
  // 정확하다. 다른 기기의 presence는 각자의 소켓이 쓴 값이라 우리가 붙는 것과 무관하고,
  // 우리 자신의 행은 isCurrent로 그려져 isConnected를 읽지도 않는다.
  it('첫 연결의 ready로는 가져오지 않는다', () => {
    latest().open();
    latest().emit({ type: 'ready' });

    expect(changed).toBe(0);
  });

  // 끊겨 있던 동안에는 sessionsChanged가 우리에게 닿지 못한다 — 그사이 다른 기기의
  // 변화를 통째로 놓쳤을 수 있으므로 재연결에서는 반드시 메운다.
  it('재연결의 ready는 놓친 변화를 메우러 가져온다', () => {
    latest().open();
    latest().emit({ type: 'ready' });
    expect(changed).toBe(0);

    latest().drop();
    vi.advanceTimersByTime(2_000);
    latest().open();
    latest().emit({ type: 'ready' });

    expect(changed).toBe(1);
  });

  // 소켓은 목록을 나르지 않는다 — 신호만 주고 재조회는 호출부의 HTTP 경로가 한다.
  it('sessionsChanged마다 다시 가져오게 한다', () => {
    latest().open();
    latest().emit({ type: 'ready' });
    latest().emit({ type: 'sessionsChanged' });
    latest().emit({ type: 'sessionsChanged' });

    expect(changed).toBe(2);
  });

  // 로그인 흐름 전체: 마운트 조회(화면이 한다) + 소켓이 시키는 조회 = 1 + 0.
  it('로그인 한 번에 소켓이 시키는 조회는 0회다', () => {
    latest().open();
    latest().emit({ type: 'ready' });
    vi.advanceTimersByTime(1_000);

    expect(changed).toBe(0);
    expect(ready.at(-1)).toBe(true);
  });

  it('끊기면 붙어 있지 않다고 알리고 다시 붙는다', () => {
    latest().open();
    latest().emit({ type: 'ready' });
    const first = latest();

    first.drop();
    expect(ready.at(-1)).toBe(false);

    vi.advanceTimersByTime(2_000);
    expect(FakeSocket.instances.length).toBe(2);
  });

  // ⚠️ 회귀 방지: 소켓이 끊기는 이유는 대부분 인증과 무관하다(회선·프록시·파드 재시작).
  // 여기서 회전이나 로그아웃이 일어나면 오프라인이 곧 로그아웃이 된다.
  it('끊김만으로는 회전도 로그아웃도 하지 않는다', () => {
    latest().open();
    latest().emit({ type: 'ready' });

    latest().drop();
    vi.advanceTimersByTime(60_000);

    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  // 재시도가 즉시 반복되면 죽은 서버를 두드린다 — 간격이 벌어져야 한다.
  it('재연결 간격이 점점 벌어진다', () => {
    latest().drop();
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances.length).toBe(2);

    latest().drop();
    // 첫 간격(1s)만큼으로는 아직 열리지 않는다.
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances.length).toBe(2);

    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances.length).toBe(3);
  });

  // 브라우저 JS는 프로토콜 ping/pong을 관찰할 수 없다 — 서버 하트비트가 끊기는 것이
  // 죽은 회선을 알아채는 유일한 방법이다. 이것이 없으면 목록이 영영 갱신되지 않는다.
  it('하트비트가 끊기면 죽은 것으로 보고 다시 붙는다', () => {
    latest().open();
    latest().emit({ type: 'ready' });

    vi.advanceTimersByTime(46_000);
    expect(ready.at(-1)).toBe(false);

    vi.advanceTimersByTime(2_000);
    expect(FakeSocket.instances.length).toBe(2);
  });

  it('하트비트가 오는 동안에는 끊지 않는다', () => {
    latest().open();
    latest().emit({ type: 'ready' });

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(20_000);
      latest().emit({ type: 'heartbeat' });
    }

    expect(ready.at(-1)).toBe(true);
    expect(FakeSocket.instances.length).toBe(1);
  });

  describe('만료', () => {
    // 소켓이 스스로 회전하면 1회용 자격증명이 두 번 소비된다 — 반드시 공유 문을 탄다.
    it('SESSION_EXPIRED면 공유 회전을 한 번만 부르고 다시 붙는다', async () => {
      latest().open();
      latest().emit({ type: 'error', code: 'SESSION_EXPIRED' });
      await vi.waitFor(() => expect(api.refreshSession).toHaveBeenCalledTimes(1));

      vi.advanceTimersByTime(2_000);
      expect(FakeSocket.instances.length).toBe(2);
    });

    // 오프라인·5xx는 판정 불가다. 세션을 버리지 않고 다시 시도한다.
    it('회전이 일시적으로 실패하면 로그아웃하지 않고 다시 시도한다', async () => {
      vi.mocked(api.refreshSession).mockResolvedValue({
        ok: false,
        ttlMs: null,
        rejected: false,
      });

      latest().open();
      latest().emit({ type: 'error', code: 'SESSION_EXPIRED' });
      await vi.waitFor(() => expect(api.refreshSession).toHaveBeenCalled());

      vi.advanceTimersByTime(2_000);
      expect(FakeSocket.instances.length).toBe(2);
    });

    // 확정 거절이면 다시 붙어 봐야 같은 답이다 — 대신 목록을 부르게 해서
    // 그 요청의 401을 중앙 경로가 처리하게 한다.
    it('회전이 확정 거절되면 재연결을 멈추고 목록에 판단을 넘긴다', async () => {
      vi.mocked(api.refreshSession).mockResolvedValue({
        ok: false,
        ttlMs: null,
        rejected: true,
      });

      latest().open();
      const before = changed;
      latest().emit({ type: 'error', code: 'SESSION_EXPIRED' });
      await vi.waitFor(() => expect(changed).toBe(before + 1));

      vi.advanceTimersByTime(60_000);
      expect(FakeSocket.instances.length).toBe(1);
    });
  });

  // ⚠️ 회귀 방지: 소켓이 스스로 세션을 끝내면 공지가 중복되거나, 이미 끝난 세션의
  // 오류로 새 세션을 끊는다. 판단은 늘 HTTP 경로에 넘긴다.
  it('확정 거절에도 로그아웃하지 않고 목록만 다시 부른다', () => {
    latest().open();
    const before = changed;

    latest().emit({ type: 'error', code: 'UNAUTHORIZED' });

    expect(changed).toBe(before + 1);
    expect(api.refreshSession).not.toHaveBeenCalled();
    // 다시 붙어 봐야 같은 답이다.
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances.length).toBe(1);
  });

  it('계약에 없는 메시지는 무시하고 연결을 유지한다', () => {
    latest().open();
    latest().emit({ type: 'nope' });
    latest().emit({ type: 'ready' });
    latest().emit({ type: 'sessionsChanged' });

    expect(ready.at(-1)).toBe(true);
    expect(changed).toBe(1);
  });

  // ── 통화 시그널링 ──
  //
  // 같은 소켓이지만 계약이 다르다. 갈라지지 않으면 presence가 시그널링을 살아 있다는
  // 증거로 삼게 되고, 그러면 반쯤 죽은 소켓이 계속 Active로 남는다(plan/webrtc.md §5).
  describe('통화', () => {
    it('통화 메시지는 presence를 건드리지 않고 통화 쪽으로만 간다', () => {
      latest().open();
      latest().emit({ type: 'ready' });

      latest().emit({
        type: 'incoming',
        callId: 'call-1',
        from: { id: 'session-1', device: 'mac' },
      });

      expect(callMessages).toEqual([
        {
          type: 'incoming',
          callId: 'call-1',
          from: { id: 'session-1', device: 'mac' },
        },
      ]);
      // 첫 ready는 재조회를 시키지 않고, 통화 메시지도 시키지 않는다.
      expect(changed).toBe(0);
    });

    it('계약에 없는 통화 메시지는 버린다', () => {
      latest().open();
      latest().emit({ type: 'incoming', callId: 'call-1' }); // from이 없다

      expect(callMessages).toEqual([]);
    });

    it('붙어 있으면 보낸다', () => {
      latest().open();

      expect(handle?.send({ type: 'call', to: 'session-1' })).toBe(true);
      expect(latest().sent).toEqual([
        JSON.stringify({ type: 'call', to: 'session-1' }),
      ]);
    });

    // 큐에 쌓지 않는 것이 중요하다 — 시그널링 메시지는 그 통화에서만 뜻이 있어서,
    // 재연결 뒤에 밀어 넣으면 이미 끝난 통화에 대고 말하게 된다.
    it('끊겨 있으면 보내지 않고 false를 돌려준다', () => {
      latest().open();
      latest().drop();

      expect(handle?.send({ type: 'hangup', callId: 'call-1' })).toBe(false);
    });
  });

  // 닫은 뒤 도착한 것은 지난 세션의 것이다 — 다음 세션에 흘러들면 안 된다.
  it('닫은 뒤에는 다시 붙지 않는다', () => {
    latest().open();
    const socket = latest();

    handle?.close();
    handle = null;
    socket.drop();
    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances.length).toBe(1);
  });
});
