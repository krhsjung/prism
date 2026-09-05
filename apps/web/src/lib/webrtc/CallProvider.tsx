import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSessionSocket } from '../session-socket-context';
import { log as logger } from '../log';
import {
  CallContext,
  type ActiveCall,
  type CallContextValue,
  type CallNotice,
  type IcePolicy,
  type Incoming,
} from './call-context';
import {
  classifyMediaError,
  hasDeviceLabels,
  hasNoDevices,
  isMediaSupported,
  listMediaDevices,
  openLocalMedia,
  setTracksEnabled,
  stopStream,
  type MediaDeviceOption,
  type MediaErrorKind,
} from './media';
import {
  appendSignal,
  signalEntry,
  type SignalLogEntry,
} from './signal-log';
import { StatsSampler, type CallStats } from './stats';
import type {
  CallClientMessage,
  CallServerMessage,
  IceServer,
  SessionRef,
} from '../contracts.gen';

// 지표를 읽는 간격. 1초보다 촘촘하면 숫자가 읽기 전에 바뀌고, 느리면 통화 품질이
// 무너지는 순간을 놓친다.
const STATS_INTERVAL_MS = 1_000;

// 보낸 `call`의 답(`ringing`·`callError`)을 기다리는 상한.
//
// 서버는 `call` 하나에 **정확히 한 번** 답하지만, 그 프레임이 상한에 걸려 버려지면
// (socket.server.ts의 계수기) 답이 영영 오지 않는다. 그동안 다음 통화를 막아 두므로
// (아래 `starting`), 풀어 주는 시계가 없으면 화면이 걸린 채로 남는다.
const ANSWER_TIMEOUT_MS = 10_000;

// `연결 중`이 이보다 오래 가면 실패로 본다.
//
// 서버의 벨 상한(45초)은 **붙기 전에만** 도는 시계라, 수락한 뒤 협상이 멈춘 통화는
// 아무도 끝내 주지 않는다. TURN까지 도는 ICE는 느려도 십수 초면 끝나므로 30초는
// 넉넉하고, 그보다 오래 걸리는 통화는 어차피 쓸 수 없다.
const CONNECT_TIMEOUT_MS = 30_000;

function nameOf(error: DOMException | Error): string {
  return error instanceof DOMException || error instanceof Error
    ? error.name
    : 'NonError';
}

/**
 * 카메라·마이크를 얻는다. **고른 장치가 없으면 제약을 풀고 한 번 더 물어본다.**
 *
 * `deviceId: { exact }`는 그 장치가 사라진 순간(뽑혔거나, 사용자가 사이트 권한을
 * 재설정해 id가 바뀌었거나) `OverconstrainedError`로 끝난다. 그때 통화를 통째로 포기하는
 * 것은 과하다 — 기본 장치로라도 붙는 편이 낫고, 어느 장치인지는 진단이 말해 준다.
 */
async function acquire(
  cameraId: string | undefined,
  microphoneId: string | undefined,
): Promise<MediaStream> {
  try {
    return await openLocalMedia({ cameraId, microphoneId });
  } catch (error) {
    if (!cameraId && !microphoneId) throw error;
    logger.net('media_retry_without_device', {
      name: nameOf(error as object as DOMException),
    });
    return openLocalMedia({});
  }
}

/**
 * 통화 하나를 붙들고 있는 자리.
 *
 * **화면이 아니라 앱에 매단다.** 걸려 온 통화는 WebRTC 페이지가 아니라 앱 위에 떠야
 * 하고(plan/webrtc.md §4), 대시보드를 보고 있어도 울려야 한다 — 소켓이 이미 앱 전역에
 * 붙어 있는 것과 같은 이유다.
 *
 * **미디어도 여기서 연다.** 수락은 카메라를 먼저 얻은 **뒤에** 서버로 나간다 —
 * 반대로 하면 `offer`가 스트림보다 먼저 도착해 트랙 없는 응답을 만들고, 카메라가
 * 실패한 통화를 이미 수락해 버린 상태가 된다.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { ready, send, subscribeCall } = useSessionSocket();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<MediaErrorKind | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceOption[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceOption[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [microphoneId, setMicrophoneId] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  const [call, setCall] = useState<ActiveCall | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [notice, setNotice] = useState<CallNotice | null>(null);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [signalLog, setSignalLog] = useState<SignalLogEntry[]>([]);
  const [icePolicy, setIcePolicyState] = useState<IcePolicy>('all');
  // 걸기를 눌렀고 카메라를 여는 중이다 — 화면이 이 값으로 버튼을 잠근다.
  const [starting, setStarting] = useState(false);

  // ── 렌더와 무관하게 최신을 봐야 하는 것들 ──
  //
  // 시그널링 핸들러는 소켓이 부르므로 렌더 주기와 무관하다. 상태만 보면 한 렌더 뒤진
  // 값으로 통화를 판단하게 된다.
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const loopbackRef = useRef<RTCPeerConnection[]>([]);
  const callRef = useRef<ActiveCall | null>(null);
  // 걸려 온 통화를 핸들러가 렌더 없이 봐야 한다(`claimed`·`ended`가 모달을 닫는다).
  const incomingRef = useRef<Incoming | null>(null);
  const iceServersRef = useRef<IceServer[]>([]);
  const icePolicyRef = useRef<IcePolicy>('all');
  // `setRemoteDescription` 전에 온 후보는 넣을 수 없다 — 붙들고 있다가 나중에 넣는다.
  const pendingRemoteRef = useRef<RTCIceCandidateInit[]>([]);
  const samplerRef = useRef(new StatsSampler());
  // 이번 로비 방문에서 장치 목록을 이미 읽었는가.
  const probedRef = useRef(false);
  // 내가 낸 offer의 답을 기다리는 중인가. **glare(양쪽이 동시에 재협상)를 가르는 값이다.**
  const offeringRef = useRef(false);
  // `연결 중`이 끝나기를 기다리는 시계. 서버의 45초는 붙기 **전에만** 도므로,
  // 협상이 조용히 멈춘 통화를 끝내 주는 것은 이것뿐이다.
  const connectTimerRef = useRef<number | null>(null);
  // 보낸 `call`이 아직 답을 못 받았다 — 두 번째 누름을 막는 문.
  //
  // ⚠️ **취소한 뒤에도 답이 올 때까지 닫혀 있다.** `ringing`과 `callError`에는 어느
  // 시도의 답인지가 실려 있지 않아서, 취소하자마자 새로 걸면 앞 시도의 `ringing`이
  // 새 통화의 것으로 읽힌다(그리고 앞 통화는 서버에 남아 상대 벨을 계속 울린다).
  // 한 번에 하나만 떠 있게 하면 그 모호함이 아예 생기지 않는다.
  const startingRef = useRef(false);
  // `ringing`을 기다리는 사이에 취소했다. id를 알게 되는 순간 서버에도 알려야 한다.
  const cancelPendingRef = useRef(false);
  const answerTimerRef = useRef<number | null>(null);
  // 지금 몇 번째 미디어 획득인가. 늦게 끝난 획득이 이미 지난 화면의 카메라를 켜 두지
  // 않게 하는 표다 — 취소할 수 없는 `getUserMedia`를 다루는 유일한 길이다.
  const mediaGenerationRef = useRef(0);

  const putCall = useCallback((next: ActiveCall | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  /**
   * 걸려 온 통화를 쓴다. **ref와 상태를 같은 줄에서 함께 옮긴다**(`putCall`과 같은 규칙).
   *
   * ⚠️ 효과로 ref를 뒤따라 맞추면 한 박자 늦는다. 시그널링은 렌더 주기와 무관해서
   * `incoming` 바로 뒤에 `claimed`·`ended`가 같은 틱에 올 수 있고, 그때 늦은 ref는
   * 아직 비어 있어 **벨 창이 닫히지 않는다.** 네이티브 두 곳은 상태를 직접 읽어 이
   * 어긋남이 없다 — 웹만 갈라져 있던 자리다.
   */
  const putIncoming = useCallback((next: Incoming | null) => {
    incomingRef.current = next;
    setIncoming(next);
  }, []);

  const patchCall = useCallback(
    (patch: Partial<ActiveCall>) => {
      const current = callRef.current;
      if (!current) return;
      const next = { ...current, ...patch };
      callRef.current = next;
      setCall(next);
    },
    [],
  );

  const record = useCallback(
    (
      direction: 'sent' | 'received',
      message: CallClientMessage | CallServerMessage,
    ) => {
      setSignalLog((entries) =>
        appendSignal(entries, signalEntry(direction, message, Date.now())),
      );
    },
    [],
  );

  const sendSignal = useCallback(
    (message: CallClientMessage): boolean => {
      const ok = send(message);
      // **보내지 못한 것은 로그에 남기지 않는다.** 로그는 "무슨 일이 있었나"인데,
      // 나가지 않은 줄이 섞이면 상대가 왜 못 받았는지를 로그가 설명하지 못한다.
      if (ok) record('sent', message);
      else logger.net('call_send_dropped', { type: message.type });
      return ok;
    },
    [record, send],
  );

  // ── 미디어 ────────────────────────────────────────────────────────────────

  const openMedia = useCallback(
    async (next?: { cameraId?: string; microphoneId?: string }) => {
      const wantedCamera = next?.cameraId ?? cameraId ?? undefined;
      const wantedMic = next?.microphoneId ?? microphoneId ?? undefined;
      // `getUserMedia`는 중간에 멈출 수 없다 — 그래서 시작할 때 표를 뽑고, 끝난 뒤에
      // 그 표가 아직 유효한지 본다. 화면을 벗어났거나 다른 획득이 시작됐으면 방금 연
      // 것을 **그 자리에서 놓는다**(아니면 보이지 않는 화면에서 표시등이 켜져 있다).
      // 브라우저가 미디어 API를 주지 않으면 **부르기 전에** 접는다 — `getUserMedia`가
      // 던지는 `TypeError`는 DOMException이 아니라 `unavailable`로 접히고, 화면이
      // 있지도 않은 "다른 앱"을 찾으라고 말하게 된다.
      if (!isMediaSupported()) {
        logger.error('media_unsupported');
        setMediaError('insecure');
        return null;
      }
      mediaGenerationRef.current += 1;
      const generation = mediaGenerationRef.current;
      try {
        const stream = await acquire(wantedCamera, wantedMic);
        if (generation !== mediaGenerationRef.current) {
          stopStream(stream);
          return null;
        }
        // 새 스트림을 얻은 **뒤에** 옛 것을 놓는다 — 먼저 놓으면 장치를 바꾸는
        // 사이에 카메라가 한 번 꺼졌다 켜지고, 실패하면 아무것도 남지 않는다.
        const previous = streamRef.current;
        streamRef.current = stream;
        setLocalStream(stream);
        setMediaError(null);
        // 지금의 음소거·카메라 상태를 새 트랙에도 그대로 입힌다.
        setTracksEnabled(stream, 'audio', micOn);
        setTracksEnabled(stream, 'video', cameraOn);
        if (previous && previous !== stream) stopStream(previous);

        // 라벨은 권한을 받은 **뒤에야** 채워진다 — 그래서 여기서 다시 읽는다.
        const devices = await listMediaDevices();
        setCameras(devices.cameras);
        setMicrophones(devices.microphones);

        // 통화 중이라면 보내는 트랙도 갈아 끼운다(재협상 없이 되는 유일한 교체다).
        const pc = pcRef.current;
        if (pc) {
          for (const sender of pc.getSenders()) {
            const kind = sender.track?.kind;
            const replacement = stream
              .getTracks()
              .find((track) => track.kind === kind);
            if (replacement) await sender.replaceTrack(replacement);
          }
        }
        return stream;
      } catch (error) {
        if (generation !== mediaGenerationRef.current) return null;
        // catch가 잡는 것은 타입이 없다 — 예외 객체로 좁혀 넘기고, 아니면
        // classifyMediaError가 `unavailable`로 접는다.
        const failure = error as object as DOMException;
        // 화면은 세 갈래로만 말하므로, 원래 이름은 개발 콘솔에 남긴다 — 어느 갈래로
        // 접혔는지가 아니라 **무엇이 났는지**를 알아야 고칠 수 있다.
        logger.error('media_failed', { name: nameOf(failure) });
        setMediaError(classifyMediaError(failure));
        return null;
      }
    },
    [cameraId, cameraOn, micOn, microphoneId],
  );

  /**
   * 카메라·마이크를 **놓는다**. 표시등이 꺼지는 것이 이 함수의 관찰 가능한 결과다.
   *
   * 트랙을 `enabled = false`로 끄는 것(음소거·카메라 오프)과 다르다 — 그쪽은 장치를
   * 계속 쥔 채 신호만 죽이므로 표시등이 켜져 있다. 통화가 끝났는데 표시등이 남으면
   * 사용자는 우리가 아직 보고 있다고 읽는다.
   */
  const releaseMedia = useCallback(() => {
    // **진행 중인 획득도 함께 무효로 만든다.** 이것이 없으면 `카메라 켜기`를 누른
    // 직후 화면을 벗어났을 때, 뒤늦게 끝난 획득이 아무도 보지 않는 카메라를 켜 둔다.
    mediaGenerationRef.current += 1;
    stopStream(streamRef.current);
    streamRef.current = null;
    setLocalStream(null);
    setMediaError(null);
  }, []);

  /**
   * 로비에 들어오면 **장치 목록만** 읽는다.
   *
   * `getUserMedia`를 부르지 않으므로 권한 팝업도 뜨지 않고 카메라 표시등도 켜지지
   * 않는다. 이미 허용한 적이 있으면 브라우저가 이름을 주고, 그때 시안대로 카메라·마이크
   * 선택 메뉴가 채워진다. 허용한 적이 없으면 이름이 비어 있어 아무것도 그리지 않고,
   * 화면은 "카메라 켜기" 버튼 하나만 둔다.
   */
  const probeDevices = useCallback(async () => {
    // 여기서 실패해도 **화면은 아무 말도 하지 않는다** — 로비에 들어온 것만으로는
    // 물어보지 않기로 했고(§7), 고칠 거리는 `카메라 켜기`를 눌렀을 때 나온다.
    // 다만 조용히 던지게 두지는 않는다: 처리되지 않은 rejection은 콘솔에서 원인처럼
    // 보이는 자리를 하나 더 만든다.
    if (!isMediaSupported()) {
      logger.error('media_unsupported');
      return;
    }
    try {
      const devices = await listMediaDevices();
      // **없는 것은 미리 말한다.** 장치가 하나도 없으면 브라우저는 권한 창을 띄우지도
      // 않고 곧바로 거절한다 — 그대로 두면 "카메라 켜기"를 눌러도 아무 일이 없는
      // 화면이 되고, 원인을 짐작할 단서가 없다. 이것은 권한을 묻는 것이 아니라
      // **이미 알 수 있는 사실을 옮기는 것**이라 §7의 "먼저 묻지 않는다"와 어긋나지 않는다.
      if (hasNoDevices(devices)) {
        setMediaError('not-found');
        return;
      }
      // 장치가 돌아왔다(케이블을 꽂았다) — 그때 말한 것을 거둔다. 다른 오류는 건드리지
      // 않는다: 권한 거부는 장치가 생겼다고 풀리지 않는다.
      setMediaError((previous) => (previous === 'not-found' ? null : previous));
      if (!hasDeviceLabels(devices)) return;
      setCameras(devices.cameras);
      setMicrophones(devices.microphones);
    } catch (error) {
      logger.error('media_enumerate_failed', {
        name: nameOf(error as object as DOMException),
      });
    }
  }, []);

  /**
   * 장치가 꽂히거나 빠지는 것을 듣는다.
   *
   * 화면이 "연결한 뒤 다시 시도해 주세요"라고 말하는데 정작 연결해도 화면이 그대로면
   * 그 문장이 거짓이 된다. `devicechange`는 권한 없이도 오므로, 웹캠을 꽂는 순간
   * 안내가 스스로 사라진다.
   */
  useEffect(() => {
    const devices = isMediaSupported() ? navigator.mediaDevices : null;
    // `devicechange`는 오래된 Safari에 없다 — 없으면 안내가 스스로 사라지지 않을 뿐,
    // 버튼을 다시 누르는 길은 그대로다.
    if (typeof devices?.addEventListener !== 'function') return;
    const onChange = () => void probeDevices();
    devices.addEventListener('devicechange', onChange);
    return () => devices.removeEventListener('devicechange', onChange);
  }, [probeDevices]);

  /** 로비에서 미리 켜 본다. 통화 시작과 같은 경로를 타므로 권한도 여기서 처음 묻는다. */
  const startPreview = useCallback(() => {
    void openMedia();
  }, [openMedia]);

  const selectCamera = useCallback(
    (deviceId: string) => {
      setCameraId(deviceId);
      void openMedia({ cameraId: deviceId });
    },
    [openMedia],
  );

  const selectMicrophone = useCallback(
    (deviceId: string) => {
      setMicrophoneId(deviceId);
      void openMedia({ microphoneId: deviceId });
    },
    [openMedia],
  );

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      setTracksEnabled(streamRef.current, 'audio', !on);
      return !on;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraOn((on) => {
      setTracksEnabled(streamRef.current, 'video', !on);
      return !on;
    });
  }, []);

  // ── 피어 연결 ─────────────────────────────────────────────────────────────

  // 보낸 `call`의 답이 왔다(또는 더 기다리지 않는다) — 다음 통화를 열어 준다.
  const settleAttempt = useCallback(() => {
    if (answerTimerRef.current !== null) {
      clearTimeout(answerTimerRef.current);
      answerTimerRef.current = null;
    }
    startingRef.current = false;
    setStarting(false);
  }, []);

  const disarmConnectTimeout = useCallback(() => {
    if (connectTimerRef.current !== null) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  /**
   * 연결 상태를 배지로 옮긴다. **루프백과 릴레이가 같은 표를 쓴다** — 갈라 두면 한쪽만
   * `재연결 중`을 그리게 되고, 세 플랫폼의 대칭도 거기서 깨진다.
   */
  const applyConnectionState = useCallback(
    (pc: RTCPeerConnection) => {
      switch (pc.connectionState) {
        case 'connected':
          disarmConnectTimeout();
          patchCall({
            status: 'connected',
            connectedAtMs: callRef.current?.connectedAtMs ?? Date.now(),
          });
          return;
        // 끊김은 **실패가 아니다** — ICE가 스스로 되찾는 경우가 흔하다.
        case 'disconnected':
          patchCall({ status: 'reconnecting' });
          return;
        case 'failed':
          patchCall({ status: 'failed' });
          return;
        default:
          return;
      }
    },
    [disarmConnectTimeout, patchCall],
  );

  const teardownPeer = useCallback(() => {
    disarmConnectTimeout();
    offeringRef.current = false;
    pcRef.current?.close();
    pcRef.current = null;
    for (const pc of loopbackRef.current) pc.close();
    loopbackRef.current = [];
    pendingRemoteRef.current = [];
    samplerRef.current.reset();
    setRemoteStream(null);
    setStats(null);
  }, [disarmConnectTimeout]);

  /**
   * 협상이 더 갈 수 없다 — 배지가 `연결 실패`를 말하게 한다.
   *
   * **끊지는 않는다.** 타일에는 `Try again`이 있고(§4), 여기서 서버에 `hangup`을
   * 보내면 그 자리에 로비 알림이 대신 서서 다시 걸 길이 사라진다. 상대도 ICE가
   * 붙지 않아 같은 배지에 이른다.
   */
  const failCall = useCallback(() => {
    disarmConnectTimeout();
    offeringRef.current = false;
    patchCall({ status: 'failed' });
  }, [disarmConnectTimeout, patchCall]);

  /**
   * `연결 중`에 상한을 둔다.
   *
   * 벨의 45초는 **붙기 전에만** 도는 서버 시계다. 수락한 뒤로는 아무도 시간을 재지
   * 않아서, 상대가 조용히 사라지거나 SDP가 어긋나면 화면이 `연결 중`에 영원히 갇힌다.
   */
  const armConnectTimeout = useCallback(() => {
    disarmConnectTimeout();
    connectTimerRef.current = window.setTimeout(() => {
      connectTimerRef.current = null;
      const current = callRef.current;
      if (current && current.status !== 'connected') failCall();
    }, CONNECT_TIMEOUT_MS);
  }, [disarmConnectTimeout, failCall]);

  /**
   * 새 `RTCPeerConnection`을 만든다. **있던 것은 버린다** — offer를 받을 때마다
   * 새로 만드는 것이 재협상(ICE 정책 전환)까지 한 규칙으로 덮는 가장 단순한 길이다.
   */
  const buildPeer = useCallback(
    (callId: string): RTCPeerConnection => {
      pcRef.current?.close();
      pendingRemoteRef.current = [];
      samplerRef.current.reset();

      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current.map((server) => ({
          urls: server.urls,
          username: server.username,
          credential: server.credential,
        })),
        // 화면에서 바꿀 수 있는 두 가지 중 하나(§4). `relay`는 일부러 직접 경로를
        // 막아 TURN이 실제로 값을 하는지 보여 준다.
        iceTransportPolicy: icePolicyRef.current,
      });

      for (const track of streamRef.current?.getTracks() ?? []) {
        const stream = streamRef.current;
        if (stream) pc.addTrack(track, stream);
      }

      pc.onicecandidate = (event) => {
        if (!event.candidate) return; // null = 수집 끝. 계약에 없는 신호라 보내지 않는다.
        const init = event.candidate.toJSON();
        sendSignal({
          type: 'ice',
          callId,
          candidate: {
            candidate: init.candidate ?? '',
            sdpMid: init.sdpMid ?? undefined,
            sdpMLineIndex: init.sdpMLineIndex ?? undefined,
          },
        });
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) setRemoteStream(stream);
      };

      pc.onconnectionstatechange = () => applyConnectionState(pc);

      pcRef.current = pc;
      return pc;
    },
    [applyConnectionState, sendSignal],
  );

  const drainRemoteCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingRemoteRef.current;
    pendingRemoteRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // 한 후보가 못 들어가도 통화는 다른 후보로 붙는다.
        logger.net('call_candidate_rejected');
      }
    }
  }, []);

  /**
   * 연결을 새로 세우고 offer를 낸다 — 통화 시작과 재협상이 **같은 길**을 쓴다.
   *
   * `offeringRef`를 세우는 것이 이 함수의 두 번째 일이다: 답을 기다리는 중인지가
   * glare를 가르는 값이고(위 `offer` 갈래), 늦게 온 answer를 버리는 근거이기도 하다.
   */
  const offerNow = useCallback(
    async (callId: string) => {
      const pc = buildPeer(callId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      offeringRef.current = true;
      sendSignal({ type: 'offer', callId, sdp: offer.sdp ?? '' });
    },
    [buildPeer, sendSignal],
  );

  // ── 통화 끝내기 ───────────────────────────────────────────────────────────

  const finish = useCallback(
    (next: CallNotice | null) => {
      teardownPeer();
      putCall(null);
      setNotice(next);
      // 통화가 끝나면 **장치도 놓는다.** 로비로 돌아왔다고 카메라를 쥐고 있을 이유가
      // 없고, 다음 통화는 어차피 다시 연다(권한은 한 번 준 뒤로 다시 묻지 않는다).
      releaseMedia();
    },
    [putCall, releaseMedia, teardownPeer],
  );

  // ── 서버가 보내오는 것 ────────────────────────────────────────────────────

  const route = useCallback(
    async (message: CallServerMessage) => {
      record('received', message);
      const current = callRef.current;

      switch (message.type) {
        case 'incoming':
          // **자동 수락은 없다.** 내 기기라도 카메라가 말없이 켜지면 안 된다(§4).
          // 이미 통화 중이면 서버가 `busy`로 막으므로 여기 오지 않는다.
          putIncoming({ callId: message.callId, from: message.from });
          return;

        case 'ringing':
          // 보낸 `call`의 답이다 — 어느 쪽으로 갈리든 다음 통화를 열어 준다.
          settleAttempt();
          // 기다리는 사이에 취소했다 — 이제야 id를 알았으니 그때 못 보낸 것을 보낸다.
          if (cancelPendingRef.current) {
            cancelPendingRef.current = false;
            sendSignal({ type: 'cancel', callId: message.callId });
            return;
          }
          if (!current || current.callId) return;
          patchCall({ callId: message.callId });
          return;

        case 'accepted':
          if (!current || current.callId !== message.callId) return;
          iceServersRef.current = message.iceServers;
          putIncoming(null);
          patchCall({ status: 'connecting' });
          armConnectTimeout();
          // **`accepted`를 받은 거는 쪽이 offer를 낸다** — 첫 협상의 방향은 여기서
          // 확정되므로 glare가 없다(§6). 받는 쪽은 offer를 기다린다.
          if (current.isCaller) await offerNow(message.callId);
          return;

        case 'offer': {
          if (!current || current.callId !== message.callId) return;
          // ⚠️ **glare**: 양쪽이 동시에 재협상을 낼 수 있다(ICE 정책은 각자 바꾼다).
          // 서로의 offer가 서로의 연결을 갈아 치우면 뒤이은 answer가 갈 곳을 잃는다.
          //
          // 그래서 역할로 가른다 — **거는 쪽이 무례하고 받는 쪽이 정중하다.** 무례한
          // 쪽은 자기 offer를 지키고 상대 것을 버리며, 정중한 쪽은 자기 것을 접고
          // 상대 offer에 답한다. 버려진 offer는 답을 못 받을 뿐이고, 그 연결은
          // 어차피 다음 `buildPeer`가 닫는다.
          //
          // 정중한 쪽의 정책 변경이 사라지지도 않는다 — `iceTransportPolicy`는 각
          // 연결의 지역 설정이고, 아래 `buildPeer`가 지금 값으로 다시 세운다.
          if (offeringRef.current && current.isCaller) {
            logger.net('call_offer_ignored_glare');
            return;
          }
          offeringRef.current = false;
          // offer가 올 때마다 연결을 새로 세운다 — 통화 시작과 ICE 정책 전환에
          // 따른 재협상을 **한 규칙**으로 덮는다.
          const pc = buildPeer(message.callId);
          await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
          await drainRemoteCandidates(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({
            type: 'answer',
            callId: message.callId,
            sdp: answer.sdp ?? '',
          });
          patchCall({ status: 'connecting' });
          armConnectTimeout();
          return;
        }

        case 'answer': {
          const pc = pcRef.current;
          if (!pc || !current || current.callId !== message.callId) return;
          // 내가 낸 offer의 답이 아니면 버린다 — 늦게 온 답이나 버려진 offer의 답이
          // `stable`인 연결에 들어가면 그대로 던진다.
          if (!offeringRef.current) {
            logger.net('call_answer_ignored');
            return;
          }
          offeringRef.current = false;
          await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
          await drainRemoteCandidates(pc);
          return;
        }

        case 'ice': {
          if (!current || current.callId !== message.callId) return;
          const init: RTCIceCandidateInit = {
            candidate: message.candidate.candidate,
            sdpMid: message.candidate.sdpMid,
            sdpMLineIndex: message.candidate.sdpMLineIndex,
          };
          const pc = pcRef.current;
          // 원격 기술이 아직 없으면 넣을 수 없다 — 붙들고 있다가 넣는다.
          if (!pc || !pc.remoteDescription) {
            pendingRemoteRef.current.push(init);
            return;
          }
          try {
            await pc.addIceCandidate(init);
          } catch {
            logger.net('call_candidate_rejected');
          }
          return;
        }

        // 다른 탭·기기가 먼저 받았다. **끝이 아니라 "내 차례가 아니었다"라서**
        // 벨만 닫고 알림은 남기지 않는다 — 다른 기기에서 받은 전화가 조용히 사라지는
        // 것과 같다. 통화는 이 연결의 것이 아니었으므로 건드릴 것도 없다.
        case 'claimed':
          if (incomingRef.current?.callId === message.callId) putIncoming(null);
          return;

        case 'declined':
          // 거절은 **벨을 함께 받았던 연결에도** 온다 — 그 창을 닫아 주는 것이 이 줄이다.
          if (incomingRef.current?.callId === message.callId) putIncoming(null);
          if (current?.callId !== message.callId) return;
          finish({ kind: 'declined' });
          return;

        case 'ended':
          // 벨을 받고 있던 다른 탭에도 온다 — 그 탭의 모달을 닫아 주는 것이 이 줄이다.
          if (incomingRef.current?.callId === message.callId) putIncoming(null);
          if (current?.callId !== message.callId) return;
          finish({ kind: 'ended', reason: message.reason });
          return;

        case 'expired':
          // **내 통화에 대한 답일 때만 끝낸다.** callId를 보지 않으면 지난 통화에 대한
          // 늦은 답 하나가 지금 붙어 있는 통화를 끊는다.
          if (incomingRef.current?.callId === message.callId) putIncoming(null);
          if (current && current.callId !== message.callId) return;
          finish({ kind: 'expired', from: message.from });
          return;

        case 'callError':
          // 화면 전환 없이 알림 한 줄로 받는다 — 아직 통화가 아니었다(§3.2).
          //
          // **아직 callId를 받지 못한 통화의 답이다.** 이미 callId가 있는 통화를 이걸로
          // 끝내면, 두 번째 시도가 받은 `busy` 하나가 멀쩡히 울리고 있는 첫 통화를 지운다.
          if (current?.callId) return;
          // 서버는 `call` 하나에 `ringing`이나 `callError` **하나로만** 답한다.
          settleAttempt();
          // 오류로 답했다면 취소할 통화가 애초에 서지 않았으니 기다리던 취소도 함께 접는다.
          if (cancelPendingRef.current) {
            cancelPendingRef.current = false;
            // 사용자는 이미 취소했다 — 그 뒤에 온 오류를 알림으로 띄우지 않는다.
            return;
          }
          finish({ kind: 'error', code: message.code });
          return;
      }
    },
    [
      armConnectTimeout,
      buildPeer,
      drainRemoteCandidates,
      finish,
      offerNow,
      patchCall,
      putIncoming,
      record,
      sendSignal,
      settleAttempt,
    ],
  );

  /**
   * 시그널링 한 줄을 처리하되 **던지지 않는다.**
   *
   * 이 함수는 소켓 콜백이 부르고 아무도 결과를 기다리지 않으므로, 새어 나간 예외는
   * 처리되지 않은 rejection으로 사라지고 화면은 `연결 중`에 그대로 남는다. SDP 연산은
   * 형식이 어긋나거나(코덱이 겹치지 않는다) 상태가 맞지 않으면 실제로 던지는 자리라,
   * 실패를 배지로 옮기는 것이 이 껍데기의 일이다.
   */
  const handleServer = useCallback(
    async (message: CallServerMessage) => {
      try {
        await route(message);
      } catch (error) {
        logger.error('call_signal_failed', {
          type: message.type,
          name: nameOf(error as object as DOMException),
        });
        failCall();
      }
    },
    [failCall, route],
  );

  const handlerRef = useRef(handleServer);
  useEffect(() => {
    handlerRef.current = handleServer;
  }, [handleServer]);

  useEffect(
    // 구독은 **한 번만** 건다. 핸들러가 바뀔 때마다 다시 걸면 그사이 도착한 메시지를
    // 놓치므로, 최신 핸들러는 ref로 본다.
    () => subscribeCall((message) => void handlerRef.current(message)),
    [subscribeCall],
  );

  // ── 사용자가 하는 것 ──────────────────────────────────────────────────────

  const startCall = useCallback(
    (target: SessionRef) => {
      // ⚠️ **문을 먼저 닫는다.** 카메라를 얻는 동안에는 아직 통화가 없어서, 두 번
      // 누르면 두 획득이 겹치고 `call`이 두 번 나간다 — 두 번째가 받는 `busy` 하나가
      // 멀쩡히 울리고 있는 첫 통화를 지운다. 화면도 이 값으로 버튼을 잠근다.
      if (startingRef.current || callRef.current) return;
      startingRef.current = true;
      setStarting(true);
      cancelPendingRef.current = false;
      void (async () => {
        setNotice(null);
        // 카메라를 **먼저** 얻는다. 얻지 못하면 걸지 않는다 — 상대의 벨만 울리고
        // 이쪽은 붙을 수 없는 통화가 되기 때문이다.
        const stream = streamRef.current ?? (await openMedia());
        if (!stream) return settleAttempt();
        putCall({
          callId: null,
          peer: target,
          status: 'ringing',
          isCaller: true,
          isLoopback: false,
          connectedAtMs: null,
        });
        if (!sendSignal({ type: 'call', to: target.id })) {
          settleAttempt();
          finish({ kind: 'error', code: 'unreachable' });
          return;
        }
        // 나갔다 — 이제 문은 **서버의 답이 열어 준다**(위 `startingRef` 주석).
        answerTimerRef.current = window.setTimeout(() => {
          answerTimerRef.current = null;
          settleAttempt();
          cancelPendingRef.current = false;
          // 답 없이 시간이 지났다 — 서 있던 통화가 있으면 그 자리에서 접는다.
          if (callRef.current && !callRef.current.callId) {
            finish({ kind: 'error', code: 'unreachable' });
          }
        }, ANSWER_TIMEOUT_MS);
      })();
    },
    [finish, openMedia, putCall, sendSignal, settleAttempt],
  );

  const acceptIncoming = useCallback(() => {
    const pending = incomingRef.current;
    if (!pending) return;
    void (async () => {
      setNotice(null);
      const stream = streamRef.current ?? (await openMedia());
      if (!stream) {
        // 카메라를 얻지 못하면 수락할 수 없다. 아무 말도 하지 않으면 상대가 45초를
        // 다 기다리므로 **사실대로 거절**하되, 여기서 끝내면 받는 쪽에는 모달이
        // 사라진 것 말고 아무 일도 없다 — "받기를 눌렀는데 거절됐다"로 보인다.
        // 그래서 이유를 그릴 수 있는 화면으로 옮긴다(통화 화면이 mediaError를 띄운다).
        sendSignal({ type: 'decline', callId: pending.callId });
        putIncoming(null);
        navigate('/webrtc');
        return;
      }
      putCall({
        callId: pending.callId,
        peer: pending.from,
        status: 'connecting',
        isCaller: false,
        isLoopback: false,
        connectedAtMs: null,
      });
      putIncoming(null);
      sendSignal({ type: 'accept', callId: pending.callId });
      // 대시보드에서 받았을 수 있다 — 통화는 통화 화면에서 그린다.
      navigate('/webrtc');
    })();
  }, [navigate, openMedia, putCall, putIncoming, sendSignal]);

  const declineIncoming = useCallback(() => {
    const pending = incomingRef.current;
    if (!pending) return;
    sendSignal({ type: 'decline', callId: pending.callId });
    putIncoming(null);
  }, [putIncoming, sendSignal]);

  /**
   * 통화를 접으면서 서버에도 끝을 알린다. `cancel`과 `hangup`이 나눠 쓰는 몸통이다.
   *
   * ⚠️ **아직 callId가 없는 자리를 여기서 함께 본다** — `call`은 보냈고 `ringing`은
   * 오지 않은 왕복 사이다. 그냥 지우면 서버의 통화는 살아 있어 상대 벨이 45초를 마저
   * 울리고, 상대가 받으면 offer를 낼 사람이 없는 통화가 선다. 그래서 **끝낼 뜻을
   * 기억했다가** `ringing`이 오는 순간 보낸다. 취소 버튼만이 아니라 화면을 벗어나는
   * 길도 이 자리를 지나야 한다 — 서버가 보기에는 같은 사건이다.
   */
  const endCall = useCallback(
    (verb: 'cancel' | 'hangup') => {
      const current = callRef.current;
      if (current && !current.isLoopback) {
        if (current.callId) sendSignal({ type: verb, callId: current.callId });
        // 기억해 두는 동사는 언제나 `cancel`이다 — 그 시점의 서버 통화는 반드시 벨
        // 단계이고, 거는 쪽이 벨을 접는 동사가 그것이다.
        else cancelPendingRef.current = true;
      }
      finish(null);
    },
    [finish, sendSignal],
  );

  const cancelCall = useCallback(() => endCall('cancel'), [endCall]);

  const hangUp = useCallback(() => endCall('hangup'), [endCall]);

  // ── 루프백 ────────────────────────────────────────────────────────────────

  const startLoopback = useCallback(() => {
    void (async () => {
      setNotice(null);
      const stream = streamRef.current ?? (await openMedia());
      if (!stream) return;
      teardownPeer();

      // 한 페이지 안의 두 연결. **소켓도 서버도 지나지 않는다** — 그래서 시그널링
      // 로그가 비어 있는 것이 정상이고, 진단이 그 자리에 그렇게 적는다(§4).
      const a = new RTCPeerConnection();
      const b = new RTCPeerConnection();
      loopbackRef.current = [a, b];
      a.onicecandidate = (event) => {
        if (event.candidate) void b.addIceCandidate(event.candidate);
      };
      b.onicecandidate = (event) => {
        if (event.candidate) void a.addIceCandidate(event.candidate);
      };
      b.ontrack = (event) => {
        const [remote] = event.streams;
        if (remote) setRemoteStream(remote);
      };
      a.onconnectionstatechange = () => applyConnectionState(a);
      for (const track of stream.getTracks()) a.addTrack(track, stream);

      // 지표는 보내는 쪽에서 읽는다 — 화면의 `Video`가 상대 타일의 값이어야 한다.
      pcRef.current = a;
      putCall({
        callId: null,
        peer: null,
        status: 'connecting',
        isCaller: true,
        isLoopback: true,
        connectedAtMs: null,
      });
      // 루프백도 같은 시계를 쓴다 — 한 페이지 안이라도 붙지 못하면 `연결 중`에 갇힌다.
      armConnectTimeout();

      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);
    })();
  }, [applyConnectionState, armConnectTimeout, openMedia, putCall, teardownPeer]);

  // 실패한 통화를 **같은 상대에게** 다시 건다(§4: "타일에는 `Try again`만 둔다").
  // 새로 거는 것이지 되살리는 것이 아니다 — 서버의 통화는 이미 끝났고 `callId`도
  // 새로 받는다. 끊는 길을 먼저 지나야 피어와 장치가 정리된다.
  //
  // **`startLoopback` 아래에 있어야 한다** — `const`는 초기화 전에 읽을 수 없어,
  // 위에 두면 렌더 중 TDZ로 터진다(타입 검사는 이것을 잡지 못한다).
  const retryCall = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    const { peer, isLoopback } = current;
    hangUp();
    if (isLoopback) startLoopback();
    else if (peer) startCall(peer);
  }, [hangUp, startCall, startLoopback]);

  // ── ICE 정책 ──────────────────────────────────────────────────────────────

  const setIcePolicy = useCallback(
    (policy: IcePolicy) => {
      setIcePolicyState(policy);
      icePolicyRef.current = policy;
      const current = callRef.current;
      // 통화 중이면 **다시 붙인다** — 정책은 연결을 세울 때만 쓰이므로 지금 것에는
      // 소급되지 않는다. 서버는 offer의 방향을 강제하지 않아 어느 쪽이든 재협상을
      // 낼 수 있다(call.gateway.ts의 relay 주석).
      const callId = current?.callId;
      if (!callId || current.isLoopback) return;
      void (async () => {
        try {
          await offerNow(callId);
          patchCall({ status: 'connecting', connectedAtMs: null });
          armConnectTimeout();
        } catch (error) {
          logger.error('call_renegotiate_failed', {
            name: nameOf(error as object as DOMException),
          });
          failCall();
        }
      })();
    },
    [armConnectTimeout, failCall, offerNow, patchCall],
  );

  // ── 지표 ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!call || call.status === 'ringing') return;
    let cancelled = false;
    const tick = async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const next = await samplerRef.current.read(pc);
      if (!cancelled) setStats(next);
    };
    void tick();
    const id = setInterval(() => void tick(), STATS_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [call]);

  /**
   * 시그널링 소켓이 끊겼다 — **서버는 이미 이 통화를 끝냈다.**
   *
   * 창구의 소켓이 사라지면 서버가 `ended{peer-gone}`으로 접고 상대에게 알린다. 그
   * 메시지는 없어진 소켓으로 가므로 이쪽은 영영 받지 못하고, 재연결해도 통화 상태를
   * 되물을 길이 없다(`resume`은 벨 전용이다). 그대로 두면 카메라를 쥔 채 `연결됨`을
   * 그리고 있는데 상대는 이미 로비로 돌아간 화면이 된다.
   *
   * 미디어 자체는 P2P라 잠깐 더 흐를 수 있지만, **양쪽이 같은 것을 보는 쪽**을 고른다.
   * 루프백은 소켓을 쓰지 않으므로 건드리지 않는다.
   */
  useEffect(() => {
    if (ready) return;
    // 기다리던 `call`의 답도 오지 않는다 — 소켓이 없으면 서버는 답할 길이 없다.
    // 문을 열어 두지 않으면 재연결(또는 재로그인) 뒤에도 걸 수 없다.
    //
    // 규칙을 끄는 이유: 바깥 시스템(소켓)이 사라진 것을 화면 상태에 반영하는 것이 이
    // 효과의 목적이다. 아래 `finish`도 같은 일을 두 겹 아래에서 하고 있어 규칙이 보지
    // 못할 뿐이다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    settleAttempt();
    cancelPendingRef.current = false;
    const current = callRef.current;
    if (!current || current.isLoopback) return;
    finish({ kind: 'ended', reason: 'peer-gone' });
  }, [finish, ready, settleAttempt]);

  /**
   * WebRTC 화면을 벗어나면 **통화를 끝내고 장치를 놓는다.**
   *
   * 통화만 남기고 미디어를 놓을 수는 없다(상대에게 검은 화면과 침묵이 간다). 통화를
   * 남기는 쪽도 안 된다 — 이 앱에는 축소된 통화 UI가 없어서, 다른 화면에서는 통화를
   * 보거나 끝낼 방법이 없는 **유령 상태**가 된다. 그래서 나가는 것이 곧 끊는 것이다.
   *
   * 언마운트가 아니라 **경로**로 판단한다: StrictMode는 개발에서 마운트→정리→마운트를
   * 한 번 더 돌리는데, 언마운트에 걸어 두면 대시보드에서 수락하고 넘어온 통화가 그
   * 리허설 정리에 끊긴다.
   */
  useEffect(() => {
    if (location.pathname === '/webrtc') {
      // 들어왔다 — 이름을 읽을 수 있으면 읽는다(카메라는 켜지 않는다).
      // **들어올 때 한 번만**: 나갔다 들어오면 다시 읽고, 그 사이에는 다시 읽지 않는다.
      if (!probedRef.current) {
        probedRef.current = true;
        void probeDevices();
      }
      return;
    }
    probedRef.current = false;
    // 쥔 것이 없으면 아무것도 하지 않는다 — 화면을 오갈 때마다 상태를 건드리면
    // 놓을 것도 없는 정리가 렌더를 한 번씩 더 만든다.
    if (!callRef.current && !streamRef.current) return;
    if (callRef.current) hangUp();
    releaseMedia();
  }, [hangUp, location.pathname, probeDevices, releaseMedia]);

  // 앱이 통째로 사라질 때의 안전망 — 여기까지 오면 화면은 이미 없다.
  useEffect(
    () => () => {
      pcRef.current?.close();
      for (const pc of loopbackRef.current) pc.close();
      stopStream(streamRef.current);
    },
    [],
  );

  const value = useMemo<CallContextValue>(
    () => ({
      localStream,
      mediaError,
      cameras,
      microphones,
      cameraId,
      microphoneId,
      selectCamera,
      selectMicrophone,
      releaseMedia,
      startPreview,
      micOn,
      cameraOn,
      toggleMic,
      toggleCamera,
      call,
      remoteStream,
      incoming,
      notice,
      stats,
      log: signalLog,
      clearLog: () => setSignalLog([]),
      icePolicy,
      setIcePolicy,
      starting,
      startCall,
      startLoopback,
      acceptIncoming,
      declineIncoming,
      cancelCall,
      retryCall,
      hangUp,
    }),
    [
      acceptIncoming,
      call,
      cameraId,
      cameraOn,
      cameras,
      cancelCall,
      retryCall,
      declineIncoming,
      releaseMedia,
      hangUp,
      icePolicy,
      incoming,
      localStream,
      mediaError,
      micOn,
      microphoneId,
      microphones,
      notice,
      remoteStream,
      selectCamera,
      selectMicrophone,
      setIcePolicy,
      startPreview,
      signalLog,
      starting,
      startCall,
      startLoopback,
      stats,
      toggleCamera,
      toggleMic,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
