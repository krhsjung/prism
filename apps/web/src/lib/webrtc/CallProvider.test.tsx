import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallProvider } from './CallProvider';
import { useCall } from './call-context';
import { SessionSocketContext } from '../session-socket-context';
import type { CallClientMessage, CallServerMessage } from '../contracts.gen';

// jsdom에는 MediaStream이 없다. 우리가 쓰는 것은 트랙 목록과 stop()뿐이라 그만큼만 만든다.
function fakeStream() {
  const track = (kind: string) => ({ kind, enabled: true, stop: vi.fn() });
  const tracks = [track('audio'), track('video')];
  return {
    tracks,
    stream: {
      getTracks: () => tracks,
      getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
      getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    } as object as MediaStream,
  };
}

let sent: CallClientMessage[];
let deliver: (message: CallServerMessage) => void;
let media: ReturnType<typeof fakeStream>;
let getUserMedia: ReturnType<typeof vi.fn>;

function Probe() {
  const {
    startCall, acceptIncoming, selectCamera, selectMicrophone, startPreview,
    localStream, mediaError, incoming,
  } = useCall();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => startCall({ id: 'peer-1', device: 'mac' })}>call</button>
      <button onClick={startPreview}>preview</button>
      <button onClick={acceptIncoming}>accept</button>
      <button onClick={() => selectCamera('c1')}>pick</button>
      <button onClick={() => selectMicrophone('m1')}>pick-mic</button>
      <button onClick={() => navigate('/dashboard')}>leave</button>
      <span data-testid="stream">{localStream ? 'open' : 'closed'}</span>
      <span data-testid="error">{mediaError ?? 'none'}</span>
      <span data-testid="incoming">{incoming ? 'ringing' : 'none'}</span>
    </>
  );
}

function renderApp(start = '/webrtc') {
  const socket = {
    ready: true,
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
  return render(
    <MemoryRouter initialEntries={[start]}>
      <SessionSocketContext.Provider value={socket}>
        <CallProvider>
          <Routes>
            <Route path="/webrtc" element={<Probe />} />
            <Route path="/dashboard" element={<><span>dashboard</span><Probe /></>} />
          </Routes>
        </CallProvider>
      </SessionSocketContext.Provider>
    </MemoryRouter>,
  );
}

// 카메라를 얻는 것이 비동기라, 스트림이 열린 것을 보고 나서 다음으로 간다.
async function startCall() {
  fireEvent.click(screen.getByText('call'));
  await waitFor(() => expect(screen.getByTestId('stream').textContent).toBe('open'));
}

describe('CallProvider — 장치 수명', () => {
  beforeEach(() => {
    sent = [];
    media = fakeStream();
    getUserMedia = vi.fn(async () => media.stream);
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia,
        enumerateDevices: async () => [],
      },
    });
  });

  // vitest의 globals가 꺼져 있어 자동 정리가 걸리지 않는다 — 남겨 두면 다음 테스트가
  // 이전 렌더의 버튼까지 함께 찾는다(DashboardPage 스펙과 같은 이유).
  afterEach(cleanup);

  // 화면을 열어 둔 것만으로 카메라 표시등이 켜져 있으면, "우리는 보고 있지 않다"는
  // 말을 화면이 증명하지 못한다.
  it('로비에 들어온 것만으로는 카메라를 열지 않는다', () => {
    renderApp();

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByTestId('stream').textContent).toBe('closed');
  });

  it('통화를 시작할 때 비로소 권한을 묻는다', async () => {
    renderApp();

    await startCall();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // 카메라를 **먼저** 얻고 나서 서버로 나간다 — 얻지 못하면 걸지 않는다.
    expect(sent).toEqual([{ type: 'call', to: 'peer-1' }]);
  });

  it('통화가 끝나면 트랙을 놓는다 — 끄는 것이 아니라 놓는다', async () => {
    renderApp();
    await startCall();

    // `ringing` 전이라 아직 callId가 없다 — 이 창에서 통화가 끝나는 길은 오류다.
    deliver({ type: 'callError', code: 'unreachable' });

    await waitFor(() =>
      expect(screen.getByTestId('stream').textContent).toBe('closed'),
    );
    for (const track of media.tracks) expect(track.stop).toHaveBeenCalled();
  });

  // 받는 쪽에서 카메라를 얻지 못하면 수락할 수 없다. 아무 말도 하지 않으면 거는 쪽이
  // 45초를 다 기다리므로 거절은 보내되, **왜 그랬는지가 받는 쪽 화면에 남아야 한다** —
  // 그러지 않으면 "받기를 눌렀는데 거절됐다"가 된다.
  it('카메라를 못 얻으면 거절하되 이유를 남기고 통화 화면으로 옮긴다', async () => {
    getUserMedia.mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    );
    renderApp('/dashboard');

    deliver({
      type: 'incoming',
      callId: 'call-9',
      from: { id: 'peer-1', device: 'mac' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('incoming').textContent).toBe('ringing'),
    );
    fireEvent.click(screen.getByText('accept'));

    await waitFor(() =>
      expect(sent).toContainEqual({ type: 'decline', callId: 'call-9' }),
    );
    // 권한 거부라는 사실이 남아야 화면이 그 문구를 그린다.
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('denied'),
    );
    // 대시보드에서 받았어도 이유를 볼 수 있는 곳으로 옮긴다.
    // (이동은 위 오류 표시와 같은 렌더에 실리지 않으므로 기다려서 본다)
    await waitFor(() => expect(screen.queryByText('dashboard')).toBeNull());
  });

  // 카메라·마이크가 **없는 PC**에서는 브라우저가 권한 창을 띄우지도 않고 곧바로
  // 거절한다. 누르기 전에 말해 주지 않으면 "눌러도 아무 일이 없는" 화면이 되고,
  // 사용자에게는 원인을 짐작할 단서가 하나도 없다.
  it('장치가 하나도 없으면 로비에 들어온 것만으로 알려 준다', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia,
        enumerateDevices: async () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    renderApp();

    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('not-found'),
    );
    // **권한을 묻지 않고** 알아낸 사실이다 — 표시등도 켜지지 않는다.
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  // "연결한 뒤 다시 시도해 주세요"라고 말해 놓고 연결해도 그대로면 그 문장이 거짓이 된다.
  it('웹캠을 꽂으면 그 안내가 스스로 사라진다', async () => {
    let plugged = false;
    const listeners: (() => void)[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia,
        enumerateDevices: async () =>
          plugged ? [{ kind: 'videoinput', deviceId: 'cam-1', label: '' }] : [],
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
        removeEventListener: () => {},
      },
    });
    renderApp();
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('not-found'),
    );

    plugged = true;
    for (const fire of listeners) fire();

    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('none'),
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  // 오류 문구는 하나같이 "고치고 다시 시도해 주세요"라고 말한다 — 그런데 버튼을
  // 치워 버리면 시도할 길이 새로고침밖에 없다. 브라우저가 거부를 기억한 오리진에서는
  // 첫 클릭이 곧바로 오류가 되므로, 그 자리가 그대로 막다른 길이 된다.
  it('카메라를 못 얻어도 다시 시도할 길이 남는다', async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException('denied', 'NotAllowedError'),
    );
    renderApp();

    fireEvent.click(screen.getByText('preview'));
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('denied'),
    );

    // 두 번째 누름이 실제로 다시 묻는다.
    fireEvent.click(screen.getByText('preview'));
    await waitFor(() =>
      expect(screen.getByTestId('stream').textContent).toBe('open'),
    );
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('error').textContent).toBe('none');
  });

  // 브라우저는 안전한 컨텍스트(https·localhost)에서만 `navigator.mediaDevices`를 준다.
  // 없을 때 `getUserMedia`가 던지는 것은 DOMException이 아니라 `TypeError`라, 그대로
  // 두면 `unavailable`로 접혀 화면이 **"다른 앱이 카메라를 쓰고 있습니다"**라고 말한다 —
  // 있지도 않은 앱을 찾게 만드는 오답이라 부르기 전에 가른다.
  it('보안 연결이 아니면 카메라를 부르지 않고 그 사실을 말한다', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    renderApp();

    fireEvent.click(screen.getByText('call'));

    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('insecure'),
    );
    // 부를 수 없는 것을 불러 보지 않는다 — 스트림도 서버로 나간 것도 없다.
    expect(screen.getByTestId('stream').textContent).toBe('closed');
    expect(sent).toEqual([]);
  });

  // 고른 장치가 사라져도(뽑혔거나 사이트 권한 재설정으로 id가 바뀌었거나) 통화를
  // 통째로 포기하지 않는다 — 기본 장치로라도 붙는 편이 낫다.
  it('고른 장치로 실패하면 제약을 풀고 다시 얻는다', async () => {
    getUserMedia
      .mockRejectedValueOnce(new DOMException('gone', 'OverconstrainedError'))
      .mockResolvedValue(media.stream);
    renderApp();

    fireEvent.click(screen.getByText('pick'));

    await waitFor(() =>
      expect(screen.getByTestId('stream').textContent).toBe('open'),
    );
    // 첫 번째는 exact 제약, 두 번째는 제약 없이.
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('error').textContent).toBe('none');
  });

  // 고른 마이크가 **실제로 걸려야** 의미가 있다. 네이티브에서 바로 이것이 빠져 있었다 —
  // Android는 고른 값을 상태에만 담고 녹음 장치에는 걸지 않았다.
  it('마이크를 고르면 그 장치로 다시 얻는다', async () => {
    renderApp();

    fireEvent.click(screen.getByText('pick-mic'));

    await waitFor(() =>
      expect(screen.getByTestId('stream').textContent).toBe('open'),
    );
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: { deviceId: { exact: 'm1' } } }),
    );
  });

  // 카메라와 마이크는 **같은 문**을 지난다 — 한쪽만 걸리면 세 플랫폼의 대칭이 깨진다.
  it('카메라를 고르면 그 장치로 다시 얻는다', async () => {
    renderApp();

    fireEvent.click(screen.getByText('pick'));

    await waitFor(() =>
      expect(screen.getByTestId('stream').textContent).toBe('open'),
    );
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ deviceId: { exact: 'c1' } }),
      }),
    );
  });

  // 통화만 남기고 미디어를 놓으면 상대는 검은 화면과 침묵을 본다. 통화를 남기는 쪽도
  // 안 된다 — 축소된 통화 UI가 없어 다른 화면에서는 끝낼 방법이 없는 유령이 된다.
  it('다른 페이지로 가면 통화를 끊고 트랙을 놓는다', async () => {
    renderApp();
    await startCall();
    deliver({ type: 'ringing', callId: 'call-1' });

    fireEvent.click(screen.getByText('leave'));

    await waitFor(() => expect(screen.getByText('dashboard')).toBeTruthy());
    expect(sent).toContainEqual({ type: 'hangup', callId: 'call-1' });
    for (const track of media.tracks) expect(track.stop).toHaveBeenCalled();
  });
});
