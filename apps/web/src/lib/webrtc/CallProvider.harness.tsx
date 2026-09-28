import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, vi } from 'vitest';
import { CallProvider } from './CallProvider';
import { Probe } from './CallProvider.probe';
import { SessionSocketContext } from '../session-socket-context';
import type { CallClientMessage, CallServerMessage } from '../contracts.gen';

// CallProvider 스펙들이 나눠 쓰는 발판 — 가짜 피어 연결·소켓·화면 조각.
//
// 시그널링과 재연결이 **같은 발판**을 쓰는 것이 요점이다: 두 스펙이 서로 다른 가짜 위에서
// 돌면 한쪽만 통과하는 회귀를 놓친다(둘 다 같은 `route`·`applyConnectionState`를 지난다).

/** CallProvider가 실제로 읽는 모양만 흉내 낸다. */
export class FakePeer {
  static made: FakePeer[] = [];
  static failOn: 'none' | 'answer' = 'none';
  /** 원격 기술 붙이기를 붙들어 둔다 — 그 사이에 온 후보가 어디로 가는지 보려고. */
  static holdRemote: Promise<void> | null = null;

  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  closed = false;
  /** `createOffer`에 넘어온 옵션들 — ICE restart가 같은 연결에서 나갔는지 본다. */
  offers: RTCOfferOptions[] = [];
  candidates: RTCIceCandidateInit[] = [];
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  readonly config: RTCConfiguration;

  constructor(config: RTCConfiguration = {}) {
    this.config = config;
    FakePeer.made.push(this);
  }

  addTrack() {}
  getSenders() {
    return [];
  }
  createOffer(options: RTCOfferOptions = {}) {
    this.offers.push(options);
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
    return FakePeer.holdRemote ?? Promise.resolve();
  }
  addIceCandidate(candidate: RTCIceCandidateInit) {
    this.candidates.push(candidate);
    return Promise.resolve();
  }
  getStats() {
    return Promise.resolve(new Map());
  }
  close() {
    this.closed = true;
  }
  /** 브라우저가 연결 상태를 바꿨다 — 핸들러까지 부른다. */
  fire(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

export let sent: CallClientMessage[] = [];
export let deliver: (message: CallServerMessage) => void = () => {};

/** 카메라·마이크와 `RTCPeerConnection`을 가짜로 바꾼다 — 각 스펙의 `beforeEach`에서 부른다. */
export function stubCallEnvironment() {
  sent = [];
  FakePeer.made = [];
  FakePeer.failOn = 'none';
  FakePeer.holdRemote = null;
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
}

export function renderApp(ready = true) {
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

export const status = () => screen.getByTestId('status').textContent;

/** 거는 쪽으로 `연결 중`까지 간다. */
export async function callerConnecting() {
  fireEvent.click(screen.getByText('call'));
  await waitFor(() => expect(sent).toContainEqual({ type: 'call', to: 'peer-1' }));
  deliver({ type: 'ringing', callId: 'c-1' });
  deliver({ type: 'accepted', callId: 'c-1', iceServers: [] });
  await waitFor(() => expect(status()).toBe('connecting'));
}

/** 받는 쪽으로 `연결 중`까지 간다. */
export async function calleeConnecting() {
  deliver({ type: 'incoming', callId: 'c-1', from: { id: 'peer-1', device: 'mac' } });
  await waitFor(() => expect(screen.getByTestId('incoming').textContent).toBe('ringing'));
  fireEvent.click(screen.getByText('accept'));
  await waitFor(() => expect(sent).toContainEqual({ type: 'accept', callId: 'c-1' }));
  deliver({ type: 'accepted', callId: 'c-1', iceServers: [] });
  await waitFor(() => expect(status()).toBe('connecting'));
}
