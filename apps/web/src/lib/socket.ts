import {
  AUTH_ERROR_CODES,
  CALL_SERVER_MESSAGE_TYPES,
  SOCKET_PATH,
  decodeSocketDownstreamMessage,
  parseJsonValue,
  type CallServerMessage,
  type SocketDownstreamMessage,
  type SocketServerMessage,
  type SocketUpstreamMessage,
} from './contracts.gen';
import { api } from './api';
import { log } from './log';

// 세션 소켓 클라이언트 — 프레임워크에 의존하지 않는다(React는 얇은 껍데기로 감싼다).
//
// **이 소켓은 데이터를 나르지 않는다.** `sessionsChanged`를 받으면 호출부가 기존
// GET /auth/sessions를 다시 부른다 — 스탬핑·공유 회전·확정 거절 처리가 전부 그 HTTP
// 경로에 있고, 소켓이 목록을 직접 주입하면 그것을 통째로 우회하기 때문이다.
//
// ⚠️ **이 파일은 인증 상태를 바꾸지 않는다.** 소켓이 끊기는 이유는 대부분 인증과
// 무관하고(회선·프록시·파드 재시작), 그것으로 로그아웃하면 오프라인이 곧 로그아웃이 된다.
// 서버가 확정 거절(UNAUTHORIZED/INVALID_TOKEN)을 보내와도 여기서 판단하지 않고
// **목록 재조회 한 번**을 시킨다 — 그 요청의 401을 이미 있는 중앙 경로가 처리한다.

const CONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
// 서버 하트비트는 20초 간격이다. 두 번을 놓칠 때까지 기다린 뒤 죽었다고 본다 —
// 한 번의 지연으로 끊으면 느린 회선에서 재연결만 반복한다.
const SILENCE_DEADLINE_MS = 45_000;

// 소켓 URL은 auth API와 **다른 포트**라(로컬 3000 vs 3002) 유도할 수 없다.
// 운영에서는 반드시 wss:// — 세션 쿠키가 __Host- 접두어라 Secure를 요구하고,
// 평문 ws://로는 쿠키가 실리지 않아 전부 인증에 실패한다.
//
// ⚠️ 로컬 기본값의 호스트는 페이지와 **같아야** 한다. 페이지가 localhost인데 소켓이
// 127.0.0.1이면 다른 site로 취급돼 SameSite=lax 쿠키가 실리지 않는다.
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ?? `ws://localhost:3002${SOCKET_PATH}`;

export interface SessionSocketHandlers {
  // 목록을 (다시) 가져와야 한다. ready와 sessionsChanged가 모두 이것을 부른다 —
  // 재연결의 첫 ready가 곧 새로고침이 되어, 포그라운드 복귀에 별도 처리가 필요 없다.
  onSessionsChanged(): void;
  // 소켓이 붙어 있는가. 화면은 이 값이 true일 때만 isConnected를 믿는다.
  onReadyChange(ready: boolean): void;
  // 통화 시그널링. **presence와 같은 소켓이지만 계약이 다르다**(contracts.gen.ts) —
  // 여기로 온 메시지는 `isConnected`를 정하는 데 쓰이지 않는다.
  onCallMessage(message: CallServerMessage): void;
}

export interface SessionSocket {
  close(): void;
  // 클라 → 서버 메시지를 보낸다(통화 시그널링 · 세션 재검증 요청).
  //
  // **보내지 못하면 false**다 — 소켓이 끊긴 사이의 `hangup`을 보낸 셈 치면 화면은 끝난
  // 통화를 그대로 붙들고 있게 된다. 호출부가 알아야 한다.
  send(message: SocketUpstreamMessage): boolean;
}

// 내려온 메시지가 통화 쪽인가. 두 계약은 타입 이름이 겹치지 않아 이 하나로 갈린다.
function isCallMessage(
  message: SocketDownstreamMessage,
): message is CallServerMessage {
  return CALL_SERVER_MESSAGE_TYPES.some((t) => t === message.type);
}

// 지터를 섞는 이유: 서버가 재시작하면 모든 클라이언트가 같은 순간에 끊긴다.
// 정확히 같은 간격으로 재시도하면 그 무리가 그대로 유지돼 복구 직후를 다시 두드린다.
function delayFor(attempt: number): number {
  const base =
    CONNECT_DELAYS_MS[Math.min(attempt, CONNECT_DELAYS_MS.length - 1)] ??
    CONNECT_DELAYS_MS[CONNECT_DELAYS_MS.length - 1] ??
    15_000;
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export function connectSessionSocket(
  handlers: SessionSocketHandlers,
): SessionSocket {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  // 한 번이라도 붙은 적이 있는가 — 다음 `ready`가 "첫 연결"인지 "재연결"인지 가른다.
  let everReady = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (silenceTimer) clearTimeout(silenceTimer);
    reconnectTimer = null;
    silenceTimer = null;
  };

  const setReady = (ready: boolean) => {
    handlers.onReadyChange(ready);
  };

  // 서버가 20초마다 보내는 하트비트가 끊기면 회선이 죽은 것이다.
  // 브라우저 JS는 프로토콜 ping/pong을 관찰할 수 없어 이 방법뿐이다 — 이것이 없으면
  // 죽은 소켓을 몇 시간이고 붙들고 앉아 목록이 영영 갱신되지 않는다.
  const armSilenceTimer = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      log.net('socket_silent');
      // close 핸들러가 재연결을 예약한다.
      ws?.close();
    }, SILENCE_DEADLINE_MS);
  };

  // 재연결을 **완전히** 멈춘다. 타이머를 남기면 침묵 타이머가 소켓을 닫아
  // onclose를 부르고, 그것이 다시 재연결을 예약해 멈춘 적이 없는 것처럼 된다.
  const stop = () => {
    stopped = true;
    clearTimers();
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = delayFor(attempt++);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  };

  const handle = (message: SocketServerMessage) => {
    switch (message.type) {
      case 'ready':
        // 붙었다 = 소켓 서비스가 살아 있다 = presence를 믿어도 된다.
        attempt = 0;
        setReady(true);
        // **첫 연결에서는 가져오지 않는다.** 화면이 마운트에서 이미 가져왔고 그 데이터는
        // 정확하다 — 다른 기기의 presence는 각자의 소켓이 쓴 값이라 우리가 붙는 것과
        // 무관하고, 우리 자신의 행은 `isCurrent`로 그려져 isConnected를 읽지도 않는다.
        // 여기서 바뀌는 것은 배지를 두 갈래로 그리다가 세 갈래로 그리게 되는 것뿐이다.
        //
        // **재연결이라면 가져온다.** 끊겨 있던 동안에는 sessionsChanged가 우리에게 닿지
        // 못해, 다른 기기의 변화를 통째로 놓쳤을 수 있다.
        if (everReady) handlers.onSessionsChanged();
        everReady = true;
        return;
      case 'sessionsChanged':
        handlers.onSessionsChanged();
        return;
      case 'heartbeat':
        return; // armSilenceTimer가 이미 처리했다
      case 'error':
        handleError(message.code);
        return;
    }
  };

  const handleError = (code: string) => {
    log.net('socket_error', { code });
    if (code === AUTH_ERROR_CODES.SESSION_EXPIRED) {
      // **직접 회전하지 않는다.** api.refreshSession()은 HTTP 401 경로와 같은
      // single-flight 프로미스라, 여러 곳이 동시에 만료를 만나도 회전은 한 번만 나간다.
      // 리프레시 자격증명은 1회용이고 서버가 응답 전에 회전시키므로, 두 번째 회전은
      // 재사용 탐지에 걸려 멀쩡한 세션을 죽인다.
      void api.refreshSession().then((result) => {
        if (stopped) return;
        // 일시적 실패(오프라인·5xx)는 **판정 불가**다 — 세션을 버리지 않고 다시 시도한다.
        if (!result.rejected) {
          if (result.ok) attempt = 0;
          scheduleReconnect();
          return;
        }
        // 확정 거절이면 다시 붙어 봐야 같은 답이다. 재연결을 완전히 멈춘 뒤
        // (침묵 타이머가 소켓을 되살리지 못하게 stop이 먼저다) 재조회에 판단을 넘긴다.
        stop();
        handlers.onSessionsChanged();
      });
      return;
    }
    // 확정 거절(UNAUTHORIZED·INVALID_TOKEN) — **여기서 로그아웃하지 않는다.**
    // 목록을 다시 부르게 하고, 그 요청의 401을 중앙 경로가 스탬프와 대조해 처리한다.
    // 소켓이 직접 세션을 끝내면 공지가 중복되거나, 이미 끝난 세션의 오류로 새 세션을 끊는다.
    stop();
    handlers.onSessionsChanged();
  };

  const open = () => {
    if (stopped) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(SOCKET_URL);
    } catch {
      // URL이 잘못된 경우 등 — 조용히 물러난다(인증과 무관하다).
      log.net('socket_open_failed');
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      log.net('socket_open');
      armSilenceTimer();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      armSilenceTimer();
      try {
        const message = decodeSocketDownstreamMessage(parseJsonValue(event.data));
        if (isCallMessage(message)) handlers.onCallMessage(message);
        else handle(message);
      } catch {
        // 계약에 없는 메시지는 무시한다 — 형식이 어긋났다고 연결을 끊을 이유는 없다.
        log.net('socket_undecodable');
      }
    };

    socket.onclose = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = null;
      ws = null;
      // 붙어 있지 않으면 presence를 믿을 수 없다 — 화면은 2상태로 후퇴한다.
      setReady(false);
      log.net('socket_close');
      scheduleReconnect();
    };

    // onerror 뒤에는 항상 onclose가 온다 — 재연결은 그쪽에서 한 번만 예약한다.
    socket.onerror = () => {
      log.net('socket_transport_error');
    };
  };

  // 탭이 잠들어 있는 동안 끊긴 소켓은 깨어나자마자 다시 붙어야 한다 —
  // 백오프를 기다리면 사용자가 화면을 보고 있는데도 몇 초씩 낡은 목록을 본다.
  const wake = () => {
    if (stopped || document.visibilityState === 'hidden') return;
    if (ws) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    attempt = 0;
    open();
  };

  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  open();

  return {
    // 열려 있을 때만 나간다. 큐에 쌓아 두지 않는 것은 의도다 — 시그널링 메시지는
    // 수명이 짧아(offer·ice는 그 통화에서만 뜻이 있다) 재연결 뒤에 밀어 넣으면
    // 이미 끝난 통화에 대고 말하게 된다. 다시 걸어야 할 일이면 화면이 판단한다.
    send(message: SocketUpstreamMessage): boolean {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(message));
      return true;
    },
    close() {
      stop();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      setReady(false);
      // 정상 종료를 알려 두면 서버가 TTL을 기다리지 않고 presence를 지운다.
      ws?.close();
      ws = null;
    },
  };
}
