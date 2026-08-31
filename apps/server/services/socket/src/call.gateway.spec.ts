import { FakeRedis } from '@app/redis/testing/fake-redis';
import {
  PresenceRepository,
  RING_TIMEOUT_MS,
  SessionsRepository,
  type CallClientMessage,
  type IceServer,
  type SessionInfo,
  type SocketDownstreamMessage,
} from '@app/common';
import { PrismConfigService } from '@app/config';
import { CallGateway } from './call.gateway';
import type { SocketConnection } from './connection';
import { ConnectionRegistry } from './connection-registry';

const ICE_SERVERS: IceServer[] = [{ urls: ['stun:stun.example:3478'] }];

// 사용자 하나의 세션 셋 — 대시보드가 그리는 것과 같은 목록이다.
const owned: SessionInfo[] = [
  {
    id: 's-mac',
    startedAt: '2026-08-28T00:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z',
    device: 'mac',
  },
  {
    id: 's-phone',
    startedAt: '2026-08-28T00:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z',
    device: 'iphone',
  },
  {
    id: 's-idle',
    startedAt: '2026-08-28T00:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z',
    device: 'windows',
  },
];

// 소켓 없이 도메인만 본다 — 게이트웨이가 `ws`가 아니라 SocketConnection에만 의존하도록
// 짠 이유가 이것이다(presence 스펙과 같은 모양).
class FakeConnection implements SocketConnection {
  sent: SocketDownstreamMessage[] = [];
  closed = false;
  probes = 0;

  constructor(
    readonly id: string,
    readonly userId: string,
    readonly sessionId: string,
  ) {}

  send(message: SocketDownstreamMessage): void {
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

  last(): SocketDownstreamMessage | undefined {
    return this.sent[this.sent.length - 1];
  }
}

describe('CallGateway', () => {
  let redis: FakeRedis;
  let registry: ConnectionRegistry;
  let presence: PresenceRepository;
  let sessions: { listForUser: jest.Mock };
  let gateway: CallGateway;
  let mac: FakeConnection;
  let phone: FakeConnection;

  beforeEach(() => {
    jest.useFakeTimers();
    redis = new FakeRedis();
    registry = new ConnectionRegistry();
    presence = new PresenceRepository(redis);
    sessions = { listForUser: jest.fn(() => Promise.resolve(owned)) };
    gateway = new CallGateway(
      registry,
      sessions as object as SessionsRepository,
      { iceServers: ICE_SERVERS } as object as PrismConfigService,
    );
    mac = connect('c-mac', 's-mac');
    phone = connect('c-phone', 's-phone');
  });

  afterEach(() => {
    gateway.onModuleDestroy();
    jest.useRealTimers();
  });

  function connect(id: string, sessionId: string): FakeConnection {
    const connection = new FakeConnection(id, 'u-1', sessionId);
    registry.add(connection);
    return connection;
  }

  const send = (from: FakeConnection, message: CallClientMessage) =>
    gateway.handle(from, message);

  // 벨이 울리는 상태까지 끌고 간다. callId는 **서버가 발급하므로** 여기서 받아 온다.
  async function ring(): Promise<string> {
    await send(mac, { type: 'call', to: 's-phone' });
    const ringing = mac.last();
    if (ringing?.type !== 'ringing')
      throw new Error(`not ringing: ${ringing?.type}`);
    return ringing.callId;
  }

  async function connected(): Promise<string> {
    const callId = await ring();
    await send(phone, { type: 'accept', callId });
    return callId;
  }

  it('거는 쪽은 ringing을, 받는 쪽은 incoming을 받는다', async () => {
    const callId = await ring();

    expect(mac.last()).toEqual({ type: 'ringing', callId });
    expect(phone.last()).toEqual({
      type: 'incoming',
      callId,
      // 상대를 가리키는 값은 **기기 종류뿐**이다 — 화면이 필요로 하는 전부다.
      from: { id: 's-mac', device: 'mac' },
    });
  });

  // callId를 클라가 만들면 남의 통화에 ice를 흘려 넣을 수 있다 — 서버가 발급한다.
  it('callId는 서버가 발급한다(추측 불가 · 통화마다 다르다)', async () => {
    const first = await ring();
    await send(mac, { type: 'hangup', callId: first });
    const second = await ring();

    expect(second).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  // 벨은 그 세션의 **모든** 연결에 울린다 — 사용자가 어느 탭에 있는지 서버는 모른다.
  it('탭이 여럿이면 그 세션의 모든 연결이 벨을 받는다', async () => {
    const secondTab = connect('c-phone-2', 's-phone');
    await ring();

    expect(phone.types()).toContain('incoming');
    expect(secondTab.types()).toContain('incoming');
  });

  it('자기 자신에게는 걸 수 없다 — 루프백은 클라이언트 안에서 끝난다', async () => {
    await send(mac, { type: 'call', to: 's-mac' });

    expect(mac.last()).toEqual({ type: 'callError', code: 'self' });
    expect(phone.sent).toEqual([]);
  });

  // 없는 세션과 남의 세션을 **구별해 주지 않는다** — 구별해 주면 남의 세션 id를 넣어
  // 존재를 떠보는 경로가 열린다.
  it('내 세션이 아니면 없는 세션과 같은 코드로 거절한다', async () => {
    await send(mac, { type: 'call', to: 's-someone-else' });
    const strangerCode = mac.last();

    mac.sent = [];
    sessions.listForUser.mockResolvedValueOnce(owned);
    await send(mac, { type: 'call', to: 's-does-not-exist' });

    expect(strangerCode).toEqual({
      type: 'callError',
      code: 'unknown-session',
    });
    expect(mac.last()).toEqual(strangerCode);
  });

  // 도달 가능 여부를 소유권보다 **먼저** 답하면 그것 자체가 존재를 알려 주는 신호가 된다.
  it('소유권을 도달 가능 여부보다 먼저 확인한다', async () => {
    // 소켓이 없는 남의 세션 — 답은 unreachable이 아니라 unknown-session이어야 한다.
    await send(mac, { type: 'call', to: 's-not-mine' });

    expect(mac.last()).toEqual({ type: 'callError', code: 'unknown-session' });
  });

  // 소켓이 없는 내 세션. 푸시로 깨우는 경로는 push 슬라이스와 함께 붙는다(§8-11).
  it('소켓이 없는 세션은 unreachable이다', async () => {
    await send(mac, { type: 'call', to: 's-idle' });

    expect(mac.last()).toEqual({ type: 'callError', code: 'unreachable' });
  });

  it('한 세션은 한 통화만 — 통화 중인 상대는 busy다', async () => {
    await connected();
    const other = connect('c-idle', 's-idle');

    await send(other, { type: 'call', to: 's-phone' });

    expect(other.last()).toEqual({ type: 'callError', code: 'busy' });
  });

  // 상한은 **양쪽 모두**에 걸린다 — 클라이언트가 화면을 두 개 열어도 서버가 막는다.
  it('이미 통화 중인 세션은 새로 걸 수도 없다', async () => {
    await connected();

    await send(mac, { type: 'call', to: 's-idle' });

    expect(mac.last()).toEqual({ type: 'callError', code: 'busy' });
  });

  it('수락하면 양쪽이 ICE 서버와 함께 accepted를 받는다', async () => {
    const callId = await connected();
    const accepted = { type: 'accepted', callId, iceServers: ICE_SERVERS };

    expect(mac.last()).toEqual(accepted);
    expect(phone.last()).toEqual(accepted);
  });

  // 타이머는 서버만 갖는다 — 지나면 양쪽을 끊고, 거는 쪽이 영원히 울리지 않는다.
  it('45초가 지나면 서버가 양쪽에 ended{timeout}을 보낸다', async () => {
    const callId = await ring();
    jest.advanceTimersByTime(RING_TIMEOUT_MS);

    const ended = { type: 'ended', callId, reason: 'timeout' };
    expect(mac.last()).toEqual(ended);
    expect(phone.last()).toEqual(ended);
  });

  it('수락하면 벨의 상한이 풀린다', async () => {
    const callId = await connected();
    jest.advanceTimersByTime(RING_TIMEOUT_MS * 2);

    expect(mac.last()).toEqual({
      type: 'accepted',
      callId,
      iceServers: ICE_SERVERS,
    });
  });

  // 거절은 종료와 다른 결말이다 — 화면이 오류가 아니라 알림 한 줄로 받는다.
  it('거절은 ended가 아니라 declined다', async () => {
    const callId = await ring();
    await send(phone, { type: 'decline', callId });

    expect(mac.last()).toEqual({ type: 'declined', callId });
  });

  it('거는 쪽이 취소하면 벨이 멈춘다', async () => {
    const callId = await ring();
    await send(mac, { type: 'cancel', callId });

    expect(phone.last()).toEqual({ type: 'ended', callId, reason: 'hangup' });
  });

  // 취소는 **거는 쪽의** 동사다. 받는 쪽에는 decline이 있다.
  it('받는 쪽의 cancel은 통화를 끝내지 못한다', async () => {
    const callId = await ring();
    await send(phone, { type: 'cancel', callId });

    expect(mac.types()).not.toContain('ended');
  });

  it('통화 중 종료는 양쪽에 ended{hangup}으로 간다', async () => {
    const callId = await connected();
    await send(phone, { type: 'hangup', callId });

    const ended = { type: 'ended', callId, reason: 'hangup' };
    expect(mac.last()).toEqual(ended);
    expect(phone.last()).toEqual(ended);
  });

  it('SDP와 ICE는 상대 창구로 그대로 넘어간다', async () => {
    const callId = await connected();
    const candidate = { candidate: 'candidate:1 1 udp 1 10.0.0.1 1 typ host' };

    await send(mac, { type: 'offer', callId, sdp: 'v=0 offer' });
    await send(phone, { type: 'answer', callId, sdp: 'v=0 answer' });
    await send(mac, { type: 'ice', callId, candidate });

    expect(phone.sent.slice(-2)).toEqual([
      { type: 'offer', callId, sdp: 'v=0 offer' },
      { type: 'ice', callId, candidate },
    ]);
    expect(mac.last()).toEqual({ type: 'answer', callId, sdp: 'v=0 answer' });
  });

  // 벨을 함께 받았던 탭은 **창구가 아니다** — 아니면 answer가 두 번 간다.
  it('먼저 받은 연결만 창구가 되고 다른 탭의 릴레이는 버려진다', async () => {
    const secondTab = connect('c-phone-2', 's-phone');
    const callId = await connected();
    secondTab.sent = [];
    mac.sent = [];

    await send(secondTab, {
      type: 'answer',
      callId,
      sdp: 'v=0 from-other-tab',
    });

    expect(mac.sent).toEqual([]);
  });

  it('당사자가 아닌 연결의 릴레이는 버려진다', async () => {
    const callId = await connected();
    const outsider = connect('c-idle', 's-idle');
    mac.sent = [];
    phone.sent = [];

    await send(outsider, { type: 'offer', callId, sdp: 'v=0 not-mine' });
    await send(outsider, { type: 'hangup', callId });

    expect(mac.sent).toEqual([]);
    expect(phone.sent).toEqual([]);
  });

  it('붙기 전에는 SDP를 릴레이하지 않는다', async () => {
    const callId = await ring();
    phone.sent = [];

    await send(mac, { type: 'offer', callId, sdp: 'v=0 too-early' });

    expect(phone.sent).toEqual([]);
  });

  // 세션 폐기(스윕이 소켓을 닫는다)와 회선 끊김이 **같은 문으로** 들어온다.
  it('창구의 소켓이 사라지면 상대가 ended{peer-gone}을 받는다', async () => {
    const callId = await connected();
    registry.remove(phone);
    gateway.close(phone);

    expect(mac.last()).toEqual({ type: 'ended', callId, reason: 'peer-gone' });
  });

  // ⚠️ 회귀 방지: 여기서 끊으면 `resume`이 존재할 이유가 없어진다. 벨이 울리는 동안의
  // 소켓 단절은 끝이 아니라 **다시 붙어 물어볼 수 있는 창**이고, 그 창을 재는 것이
  // 45초 타이머다.
  it('벨이 울리는 중 받는 쪽이 끊겨도 통화는 살아 있다', async () => {
    const callId = await ring();
    registry.remove(phone);
    gateway.close(phone);

    expect(mac.types()).not.toContain('ended');

    const reopened = connect('c-phone-3', 's-phone');
    await send(reopened, { type: 'resume', callId });

    expect(reopened.last()).toEqual({
      type: 'incoming',
      callId,
      from: { id: 's-mac', device: 'mac' },
    });
  });

  it('끝난 통화의 resume은 누가 걸었는지와 함께 expired를 받는다', async () => {
    const callId = await ring();
    jest.advanceTimersByTime(RING_TIMEOUT_MS);
    phone.sent = [];

    await send(phone, { type: 'resume', callId });

    expect(phone.last()).toEqual({
      type: 'expired',
      callId,
      from: { id: 's-mac', device: 'mac' },
    });
  });

  // 통화가 없어졌는지와 **애초에 남의 통화였는지**를 구별해 주지 않는다 —
  // unknown-session과 같은 이유다. 기기 종류를 지어내지도 않는다.
  it('모르는 callId와 남의 통화는 같은 expired로 답한다', async () => {
    const callId = await ring();
    const outsider = connect('c-idle', 's-idle');

    await send(outsider, { type: 'resume', callId });
    const stranger = outsider.last();

    await send(outsider, { type: 'resume', callId: 'never-existed' });

    expect(stranger).toEqual({ type: 'expired', callId });
    expect(outsider.last()).toEqual({
      type: 'expired',
      callId: 'never-existed',
    });
  });

  // ⚠️ 회귀 방지 — plan/webrtc.md §5의 선. 클라 → 서버 방향이 열려도 `isConnected`는
  // 여전히 소켓의 **존재만** 본다. 시그널링 메시지를 살아 있다는 증거로 쓰면 반쯤 죽은
  // 소켓이 계속 Active로 남는다.
  it('시그널링은 presence를 밀지 않는다', async () => {
    const callId = await connected();
    await send(mac, { type: 'offer', callId, sdp: 'v=0 offer' });
    await send(mac, { type: 'hangup', callId });

    expect([...(await presence.connectedSessionIds('u-1'))]).toEqual([]);
  });
});
