import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallProvider } from './CallProvider';
import { useCall } from './call-context';
import { SessionSocketContext } from '../session-socket-context';
import type { CallClientMessage, CallServerMessage } from '../contracts.gen';

// 협상은 **실패하는 자리**다 — 코덱이 겹치지 않거나, 늦게 온 답이 `stable`인 연결에
// 들어오거나, 양쪽이 동시에 재협상을 낸다. 그 갈래들이 화면을 `연결 중`에 가두거나
// 남의 통화를 끊지 않는지가 이 스펙의 질문이다(plan/webrtc.md §6).

class FakePeer {
  static made: FakePeer[] = [];
  static failOn: 'none' | 'answer' = 'none';

  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState = 'new';
  closed = false;
  // CallProvider가 실제로 읽는 모양만 흉내 낸다.
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  readonly config: RTCConfiguration;

  constructor(config: RTCConfiguration) {
    this.config = config;
    FakePeer.made.push(this);
  }

  addTrack() {}
  getSenders() {
    return [];
  }
  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'v=0 mine' });
  }
  createAnswer() {
    if (FakePeer.failOn === 'answer') {
      return Promise.reject(new DOMException('no codec', 'InvalidStateError'));
    }
    return Promise.resolve({ type: 'answer', sdp: 'v=0 mine-answer' });
  }
  setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
    return Promise.resolve();
  }
  setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    return Promise.resolve();
  }
  addIceCandidate() {
    return Promise.resolve();
  }
  getStats() {
    return Promise.resolve(new Map());
  }
  close() {
    this.closed = true;
  }
}

let sent: CallClientMessage[];
let deliver: (message: CallServerMessage) => void;

function Probe() {
  const {
    startCall, acceptIncoming, cancelCall, hangUp, setIcePolicy, resumeCall,
    call, incoming, notice,
  } = useCall();
  return (
    <>
      <button onClick={() => startCall({ id: 'peer-1', device: 'mac' })}>call</button>
      <button onClick={acceptIncoming}>accept</button>
      <button onClick={cancelCall}>cancel</button>
      <button onClick={hangUp}>hangup</button>
      <button onClick={() => setIcePolicy('relay')}>relay</button>
      <button onClick={() => resumeCall('c-1')}>resume</button>
      <span data-testid="status">{call ? call.status : 'none'}</span>
      <span data-testid="incoming">{incoming ? 'ringing' : 'none'}</span>
      <span data-testid="notice">{notice?.kind ?? 'none'}</span>
    </>
  );
}

function renderApp(ready = true) {
  const socket = {
    ready,
    changed: 0,
    send: (message: CallClientMessage) => {
      sent.push(message);
      return true;
    },
    subscribeCall: (handler: (m: CallServerMessage) => void) => {
      deliver = handler;
      return () => {};
    },
  };
  const view = render(
    <MemoryRouter initialEntries={['/webrtc']}>
      <SessionSocketContext.Provider value={socket}>
        <CallProvider>
          <Probe />
        </CallProvider>
      </SessionSocketContext.Provider>
    </MemoryRouter>,
  );
  return {
    ...view,
    // 같은 트리를 다시 그리되 소켓의 ready만 바꾼다 — 회선이 끊긴 순간을 흉내 낸다.
    setReady(next: boolean) {
      view.rerender(
        <MemoryRouter initialEntries={['/webrtc']}>
          <SessionSocketContext.Provider value={{ ...socket, ready: next }}>
            <CallProvider>
              <Probe />
            </CallProvider>
          </SessionSocketContext.Provider>
        </MemoryRouter>,
      );
    },
  };
}

const status = () => screen.getByTestId('status').textContent;

// 거는 쪽으로 `연결 중`까지 간다.
async function callerConnecting() {
  fireEvent.click(screen.getByText('call'));
  await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));
  deliver({ type: 'ringing', callId: 'c-1' });
  deliver({ type: 'accepted', callId: 'c-1', iceServers: [] });
  await waitFor(() => expect(status()).toBe('connecting'));
}

// 받는 쪽으로 `연결 중`까지 간다.
async function calleeConnecting() {
  deliver({ type: 'incoming', callId: 'c-1', from: { id: 'peer-1', device: 'mac' } });
  await waitFor(() => expect(screen.getByTestId('incoming').textContent).toBe('ringing'));
  fireEvent.click(screen.getByText('accept'));
  await waitFor(() => expect(sent).toContainEqual({ type: 'accept', callId: 'c-1' }));
  deliver({ type: 'accepted', callId: 'c-1', iceServers: [] });
  await waitFor(() => expect(status()).toBe('connecting'));
}

describe('CallProvider — 시그널링', () => {
  beforeEach(() => {
    sent = [];
    FakePeer.made = [];
    FakePeer.failOn = 'none';
    const track = (kind: string) => ({ kind, enabled: true, stop: vi.fn() });
    const tracks = [track('audio'), track('video')];
    const stream = {
      getTracks: () => tracks,
      getAudioTracks: () => [tracks[0]],
      getVideoTracks: () => [tracks[1]],
    } as object as MediaStream;
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(stream)),
        enumerateDevices: () => Promise.resolve([]),
      },
    });
    vi.stubGlobal('RTCPeerConnection', FakePeer);
  });

  afterEach(cleanup);

  it('accepted를 받은 거는 쪽이 offer를 낸다', async () => {
    renderApp();
    await callerConnecting();

    await waitFor(() =>
      expect(sent).toContainEqual({ type: 'offer', callId: 'c-1', sdp: 'v=0 mine' }),
    );
  });

  it('받는 쪽은 offer를 내지 않고 기다린다', async () => {
    renderApp();
    await calleeConnecting();

    expect(sent.filter((m) => m.type === 'offer')).toEqual([]);
  });

  // ⚠️ 양쪽이 동시에 재협상을 내면(각자 ICE 정책을 바꾼다) 서로의 offer가 서로의 연결을
  // 갈아 치우고 뒤이은 answer가 갈 곳을 잃는다. **거는 쪽이 무례하고 받는 쪽이 정중하다.**
  it('glare: 거는 쪽은 자기 offer를 지키고 상대 것을 버린다', async () => {
    renderApp();
    await callerConnecting();
    await waitFor(() => expect(sent.some((m) => m.type === 'offer')).toBe(true));
    sent.length = 0;

    deliver({ type: 'offer', callId: 'c-1', sdp: 'v=0 theirs' });

    await waitFor(() => expect(status()).toBe('connecting'));
    expect(sent.filter((m) => m.type === 'answer')).toEqual([]);
  });

  it('glare: 받는 쪽은 자기 offer를 접고 상대 것에 답한다', async () => {
    renderApp();
    await calleeConnecting();
    fireEvent.click(screen.getByText('relay'));
    await waitFor(() => expect(sent.some((m) => m.type === 'offer')).toBe(true));

    deliver({ type: 'offer', callId: 'c-1', sdp: 'v=0 theirs' });

    await waitFor(() =>
      expect(sent).toContainEqual({
        type: 'answer',
        callId: 'c-1',
        sdp: 'v=0 mine-answer',
      }),
    );
  });

  // 버려진 offer의 답이나 늦게 온 답이 `stable`인 연결에 들어가면 그대로 던진다.
  it('내가 내지 않은 offer의 answer는 버린다', async () => {
    renderApp();
    await calleeConnecting();
    deliver({ type: 'offer', callId: 'c-1', sdp: 'v=0 theirs' });
    await waitFor(() => expect(sent.some((m) => m.type === 'answer')).toBe(true));
    const peer = FakePeer.made.at(-1);

    deliver({ type: 'answer', callId: 'c-1', sdp: 'v=0 late' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peer?.remoteDescription).toEqual({ type: 'offer', sdp: 'v=0 theirs' });
  });

  // 그냥 돌아서면 화면이 `연결 중`에 영원히 갇힌다 — 벨의 45초는 붙기 전에만 도는
  // 서버 시계라, 협상이 깨진 통화를 끝내 주지 않는다.
  it('SDP가 실패하면 연결 실패로 접는다', async () => {
    FakePeer.failOn = 'answer';
    renderApp();
    await calleeConnecting();

    deliver({ type: 'offer', callId: 'c-1', sdp: 'v=0 theirs' });

    await waitFor(() => expect(status()).toBe('failed'));
  });

  // 벨은 세션의 모든 연결에 울리지만 받는 것은 하나다.
  it('다른 기기가 받으면 벨만 닫고 알림은 남기지 않는다', async () => {
    renderApp();
    deliver({ type: 'incoming', callId: 'c-9', from: { id: 'peer-1', device: 'mac' } });
    await waitFor(() => expect(screen.getByTestId('incoming').textContent).toBe('ringing'));

    deliver({ type: 'claimed', callId: 'c-9' });

    await waitFor(() => expect(screen.getByTestId('incoming').textContent).toBe('none'));
    expect(screen.getByTestId('notice').textContent).toBe('none');
  });

  it('다른 기기가 거절해도 벨은 닫힌다', async () => {
    renderApp();
    deliver({ type: 'incoming', callId: 'c-9', from: { id: 'peer-1', device: 'mac' } });
    await waitFor(() => expect(screen.getByTestId('incoming').textContent).toBe('ringing'));

    deliver({ type: 'declined', callId: 'c-9' });

    await waitFor(() => expect(screen.getByTestId('incoming').textContent).toBe('none'));
  });

  // 지난 통화에 대한 늦은 답 하나가 지금 붙어 있는 통화를 끊으면 안 된다.
  it('남의 callId로 온 expired는 지금 통화를 건드리지 않는다', async () => {
    renderApp();
    await callerConnecting();

    deliver({ type: 'expired', callId: 'c-old' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(status()).toBe('connecting');
  });

  // `call`은 보냈고 `ringing`은 오지 않은 왕복 사이에 취소하면, 그냥 지우는 것으로는
  // 서버의 통화가 남아 상대 벨이 45초를 마저 울린다.
  it('ringing 전에 취소하면 id를 받는 순간 cancel을 보낸다', async () => {
    renderApp();
    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));

    fireEvent.click(screen.getByText('cancel'));
    deliver({ type: 'ringing', callId: 'c-1' });

    await waitFor(() => expect(sent).toContainEqual({ type: 'cancel', callId: 'c-1' }));
    expect(status()).toBe('none');
  });

  // 서버는 `call` 하나에 `ringing`이나 `callError` 하나로만 답한다. 오류로 답했다면
  // 기다리던 취소도 함께 접어야 한다 — 남겨 두면 그 표가 **다음** 통화의 `ringing`을
  // 도착하자마자 끊는다.
  it('취소를 기다리다 오류로 답받으면 그 표를 다음 통화로 넘기지 않는다', async () => {
    renderApp();
    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));
    fireEvent.click(screen.getByText('cancel'));

    deliver({ type: 'callError', code: 'unreachable' });
    await waitFor(() => expect(status()).toBe('none'));
    // 이미 취소한 사람에게 오류를 다시 말하지 않는다.
    expect(screen.getByTestId('notice').textContent).toBe('none');

    sent.length = 0;
    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));
    deliver({ type: 'ringing', callId: 'c-2' });

    await waitFor(() => expect(status()).toBe('ringing'));
    expect(sent.filter((m) => m.type === 'cancel')).toEqual([]);
  });

  // ⚠️ `ringing`·`callError`에는 **어느 시도의 답인지가 실려 있지 않다.** 취소하자마자
  // 새로 걸면 앞 시도의 `ringing`이 새 통화의 것으로 읽히고(엉뚱한 callId를 달게 된다),
  // 앞 통화는 서버에 남아 상대 벨을 계속 울린다. 한 번에 하나만 떠 있게 해서 막는다.
  it('취소해도 앞 시도의 답이 오기 전에는 새로 걸 수 없다', async () => {
    renderApp();
    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));
    fireEvent.click(screen.getByText('cancel'));
    sent.length = 0;

    fireEvent.click(screen.getByText('call'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([]);

    // 앞 시도의 답이 오면 그때 취소가 나가고, 문이 다시 열린다.
    deliver({ type: 'ringing', callId: 'c-1' });
    await waitFor(() => expect(sent).toContainEqual({ type: 'cancel', callId: 'c-1' }));

    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));
  });

  // 화면을 벗어나는 길(라우트 이탈·앱 종료)은 `hangUp`을 지난다. 서버가 보기에는
  // 취소와 같은 사건이라, callId를 아직 못 받은 자리에서도 같은 결말이어야 한다 —
  // 아니면 상대 벨만 45초를 마저 울린다. 나가는 동사는 `cancel`이다: 그 시점의 서버
  // 통화는 반드시 벨 단계이고, 거는 쪽이 벨을 접는 동사가 그것이다.
  it('ringing 전에 끊어도 id를 받는 순간 서버에 알린다', async () => {
    renderApp();
    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));

    fireEvent.click(screen.getByText('hangup'));
    deliver({ type: 'ringing', callId: 'c-1' });

    await waitFor(() => expect(sent).toContainEqual({ type: 'cancel', callId: 'c-1' }));
    expect(status()).toBe('none');
  });

  // 두 번 누르면 두 획득이 겹치고 `call`이 두 번 나간다 — 두 번째가 받는 `busy` 하나가
  // 멀쩡히 울리고 있는 첫 통화를 지운다.
  it('연타해도 call은 한 번만 나간다', async () => {
    renderApp();

    fireEvent.click(screen.getByText('call'));
    fireEvent.click(screen.getByText('call'));

    await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));
    expect(sent.filter((m) => m.type === 'call')).toHaveLength(1);
  });

  it('통화 중 busy가 와도 지금 통화를 지우지 않는다', async () => {
    renderApp();
    await callerConnecting();

    deliver({ type: 'callError', code: 'busy' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(status()).toBe('connecting');
  });

  // 창구의 소켓이 사라지면 서버가 통화를 끝내고 상대에게 알린다 — 그 메시지는 없어진
  // 소켓으로 가므로, 이쪽은 스스로 접지 않으면 카메라를 쥔 채 유령 통화를 그린다.
  it('소켓이 끊기면 통화를 접는다', async () => {
    const view = renderApp();
    await callerConnecting();

    view.setReady(false);

    await waitFor(() => expect(status()).toBe('none'));
  });
  // ── 푸시로 깨우기 (plan/webrtc.md §8-9) ──
  //
  // 소켓이 없는 기기는 서버가 알림으로 깨우고 `notified`로 답한다. `ringing`과 **같은
  // 답이고 다른 상태다** — 기다리는 성격이 달라 화면의 배지와 문구를 가른다(§4).
  describe('푸시 경로', () => {
    it('notified는 ringing과 같은 자리를 채우되 상태가 다르다', async () => {
      renderApp();
      fireEvent.click(screen.getByText('call'));
      await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));

      deliver({ type: 'notified', callId: 'c-1' });

      await waitFor(() => expect(status()).toBe('notified'));
    });

    // 클라이언트는 경로를 요청하지 않는다 — 알림으로 알렸든 소켓으로 울렸든 그 뒤의
    // 흐름은 같다(수락하면 `accepted`가 오고 offer를 낸다).
    it('알림 경로에서도 수락되면 그대로 연결로 간다', async () => {
      renderApp();
      fireEvent.click(screen.getByText('call'));
      await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));
      deliver({ type: 'notified', callId: 'c-1' });
      await waitFor(() => expect(status()).toBe('notified'));

      deliver({ type: 'accepted', callId: 'c-1', iceServers: [] });

      await waitFor(() => expect(status()).toBe('connecting'));
    });

    // `ringing` 전에 취소한 경우와 **같은 규칙**이다 — id를 받는 순간 보낸다.
    it('notified 전에 취소하면 id를 받는 순간 cancel을 보낸다', async () => {
      renderApp();
      fireEvent.click(screen.getByText('call'));
      await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));
      fireEvent.click(screen.getByText('cancel'));

      deliver({ type: 'notified', callId: 'c-1' });

      await waitFor(() => expect(sent).toContainEqual({ type: 'cancel', callId: 'c-1' }));
    });

    // 알림을 열고 들어왔다 — 늦게 온 기기의 유일한 질문이다(§6).
    it('resume은 통화가 없을 때만 나간다', async () => {
      renderApp();

      fireEvent.click(screen.getByText('resume'));

      await waitFor(() =>
        expect(sent).toContainEqual({ type: 'resume', callId: 'c-1' }),
      );
    });

    it('이미 벨이 울리는 중이면 resume을 보내지 않는다', async () => {
      renderApp();
      deliver({ type: 'incoming', callId: 'c-1', from: { id: 'peer-1', device: 'mac' } });
      await waitFor(() =>
        expect(screen.getByTestId('incoming').textContent).toBe('ringing'),
      );

      fireEvent.click(screen.getByText('resume'));

      expect(sent).not.toContainEqual({ type: 'resume', callId: 'c-1' });
    });

    // 창이 지난 뒤 열었다 — 이것이 **푸시 경로의 정상 결말**이다(§8-10).
    it('expired는 이미 끝난 통화를 알린다', async () => {
      renderApp();

      deliver({
        type: 'expired',
        callId: 'c-1',
        from: { id: 'peer-1', device: 'mac' },
      });

      await waitFor(() =>
        expect(screen.getByTestId('notice').textContent).toBe('expired'),
      );
    });
  });
});