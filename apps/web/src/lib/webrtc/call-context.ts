import { createContext, useContext } from 'react';
import type {
  CallEndReason,
  CallErrorCode,
  SessionRef,
} from '../contracts.gen';
import type { MediaDeviceOption, MediaErrorKind } from './media';
import type { SignalLogEntry } from './signal-log';
import type { CallStats } from './stats';

/**
 * 통화의 상태. **배지 여섯 변형과 1:1**이다(plan/webrtc.md §4) — 화면이 배지를 그리려고
 * 상태를 다시 조합하지 않게, 여기서 이미 그 모양으로 나눠 둔다.
 *
 * `notified`(푸시로 깨웠다)는 아직 도달할 수 없다 — 소켓이 없는 기기는 서버가
 * `unreachable`로 거절하고, 푸시 경로는 push 슬라이스와 함께 붙는다(§8-11).
 * 문구와 배지는 이미 있으므로 그때 갈래 하나만 늘면 된다.
 */
export type CallStatus =
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/** ICE 정책. 화면에서 바꿀 수 있는 두 가지 중 하나다(§4). */
export type IcePolicy = 'all' | 'relay';

/**
 * 로비에 띄우는 한 줄. **통화가 끝난 뒤에도 남는 것은 이것뿐이다** — 부재중 목록을
 * 두지 않기로 했고(§2), 저장이 생기면 그 저장은 세션보다 오래 살기 때문이다.
 */
export type CallNotice =
  | { kind: 'declined' }
  | { kind: 'ended'; reason: CallEndReason }
  | { kind: 'error'; code: CallErrorCode }
  // 알림을 늦게 열었다. `from`은 없을 수 있다 — 서버가 그 통화를 더는 기억하지
  // 못하거나 애초에 내 통화가 아니었으면 기기 종류를 지어내지 않는다(§6).
  | { kind: 'expired'; from?: SessionRef };

/** 걸려 온 통화 하나. **앱 어디서든** 뜬다(§4). */
export interface Incoming {
  callId: string;
  from: SessionRef;
}

export interface ActiveCall {
  /** 서버가 발급한다. `call`을 보내고 `ringing`을 받기 전까지는 **없다**. */
  callId: string | null;
  /** 상대. 루프백에서는 없다 — 상대가 나 자신이라 기기 종류를 말할 것이 없다. */
  peer: SessionRef | null;
  status: CallStatus;
  /** 건 쪽인가. **offer를 내는 역할이 여기서 나온다**(§6). */
  isCaller: boolean;
  /** 한 페이지 안의 두 PeerConnection — 소켓도 서버도 지나지 않는다(§4). */
  isLoopback: boolean;
  connectedAtMs: number | null;
}

export interface CallContextValue {
  // ── 로비(장치) ──
  localStream: MediaStream | null;
  mediaError: MediaErrorKind | null;
  cameras: MediaDeviceOption[];
  microphones: MediaDeviceOption[];
  cameraId: string | null;
  microphoneId: string | null;
  selectCamera(deviceId: string): void;
  selectMicrophone(deviceId: string): void;
  /**
   * 카메라·마이크를 놓는다(표시등이 꺼진다).
   *
   * **로비에서는 장치를 열지 않는다.** 권한은 통화가 시작되는 순간(`Call`·`Accept`·
   * `Test`)에 묻고, 통화가 끝나거나 화면을 벗어나면 놓는다 — 화면을 열어 둔 것만으로
   * 카메라 표시등이 켜져 있지 않게.
   */
  releaseMedia(): void;
  /**
   * 로비에서 카메라를 **미리** 켠다(= 권한을 처음 묻는다).
   *
   * 아직 허용한 적이 없으면 브라우저가 장치 이름조차 주지 않아 시안의 선택 메뉴를
   * 그릴 수 없다. 그때만 화면이 이 버튼을 내고, 누르면 통화 시작과 같은 경로를 탄다 —
   * **자동으로는 켜지지 않는다**(§7).
   */
  startPreview(): void;
  micOn: boolean;
  cameraOn: boolean;
  toggleMic(): void;
  toggleCamera(): void;

  // ── 통화 ──
  call: ActiveCall | null;
  remoteStream: MediaStream | null;
  /** 걸려 온 통화. **앱 어디서든** 뜬다(§4). */
  incoming: Incoming | null;
  notice: CallNotice | null;

  // ── 진단 ──
  stats: CallStats | null;
  log: readonly SignalLogEntry[];
  clearLog(): void;
  icePolicy: IcePolicy;
  setIcePolicy(policy: IcePolicy): void;

  // ── 동작 ──
  /**
   * 걸기를 눌렀고 카메라를 여는 중이다.
   *
   * 그동안에는 아직 통화가 없어서 `call`이 비어 있다 — 화면이 이 값으로 버튼을 잠그지
   * 않으면 두 번 누른 사람이 통화를 두 개 걸고, 두 번째가 받는 `busy`가 첫 통화를 지운다.
   */
  starting: boolean;
  startCall(target: SessionRef): void;
  startLoopback(): void;
  acceptIncoming(): void;
  declineIncoming(): void;
  /** 벨을 접는다(거는 쪽). 붙은 뒤로는 `hangUp`의 자리다. */
  cancelCall(): void;
  /** 실패한 통화를 **같은 상대에게** 다시 건다(§4의 타일 `Try again`). */
  retryCall(): void;
  hangUp(): void;
}

const NOT_IN_PROVIDER = (): void => {
  throw new Error('CallProvider is missing');
};

export const CallContext = createContext<CallContextValue>({
  localStream: null,
  mediaError: null,
  cameras: [],
  microphones: [],
  cameraId: null,
  microphoneId: null,
  selectCamera: NOT_IN_PROVIDER,
  selectMicrophone: NOT_IN_PROVIDER,
  releaseMedia: NOT_IN_PROVIDER,
  startPreview: NOT_IN_PROVIDER,
  micOn: true,
  cameraOn: true,
  toggleMic: NOT_IN_PROVIDER,
  toggleCamera: NOT_IN_PROVIDER,
  call: null,
  remoteStream: null,
  incoming: null,
  notice: null,
  stats: null,
  log: [],
  clearLog: NOT_IN_PROVIDER,
  icePolicy: 'all',
  setIcePolicy: NOT_IN_PROVIDER,
  starting: false,
  startCall: NOT_IN_PROVIDER,
  startLoopback: NOT_IN_PROVIDER,
  acceptIncoming: NOT_IN_PROVIDER,
  declineIncoming: NOT_IN_PROVIDER,
  cancelCall: NOT_IN_PROVIDER,
  retryCall: NOT_IN_PROVIDER,
  hangUp: NOT_IN_PROVIDER,
});

export function useCall(): CallContextValue {
  return useContext(CallContext);
}
