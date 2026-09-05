import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './auth-context';
import { connectSessionSocket, type SessionSocket } from './socket';
import {
  SessionSocketContext,
  type SessionSocketValue,
} from './session-socket-context';
import type {
  CallServerMessage,
  SocketUpstreamMessage,
} from './contracts.gen';

// 로그인해 있는 동안 세션 소켓을 붙들고, 화면에는 **신호만** 전달한다.
//
// 대시보드가 아니라 인증 상태에 매다는 이유: 소켓이 화면 수명에 묶이면 다른 페이지를
// 보는 동안 내 기기가 스스로를 "비활성"으로 보고하게 된다.
export function SessionSocketProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const [ready, setReady] = useState(false);
  const [changed, setChanged] = useState(0);
  // 소켓이 닫힌 뒤 도착한 콜백이 다음 세션의 상태를 건드리지 않게 한다.
  // (정리만으로는 이미 출발한 콜백을 막지 못한다 — DashboardPage가 쓰는 규칙과 같다)
  const alive = useRef(true);
  // 지금 열려 있는 소켓. `send`가 이것을 보므로 재연결·재로그인 뒤에도 최신을 쓴다.
  const socketRef = useRef<SessionSocket | null>(null);
  // 통화 메시지를 듣는 쪽들. Set인 이유는 **둘 이상이 동시에 듣기 때문이다** —
  // 걸려 온 통화 모달(앱 전역)과 통화 화면이 같은 스트림을 본다.
  const callListeners = useRef(new Set<(m: CallServerMessage) => void>());

  const userId = state.status === 'authenticated' ? state.user.id : null;

  const send = useCallback(
    (message: SocketUpstreamMessage) => socketRef.current?.send(message) ?? false,
    [],
  );

  const subscribeCall = useCallback(
    (handler: (message: CallServerMessage) => void) => {
      const listeners = callListeners.current;
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    [],
  );

  useEffect(() => {
    if (!userId) return;
    alive.current = true;
    const socket = connectSessionSocket({
      onReadyChange: (next) => {
        if (alive.current) setReady(next);
      },
      onSessionsChanged: () => {
        if (alive.current) setChanged((n) => n + 1);
      },
      // 통화 메시지는 **상태로 쌓지 않는다.** 시그널링은 순서가 있는 사건의 흐름이라
      // 마지막 하나만 남기면 offer와 ice가 서로를 덮어쓰고, 배열로 쌓으면 이미 처리한
      // 것을 다시 렌더에서 만나게 된다. 듣는 쪽에 그대로 넘기고 잊는다.
      onCallMessage: (message) => {
        if (!alive.current) return;
        for (const listener of callListeners.current) listener(message);
      },
    });
    socketRef.current = socket;
    return () => {
      alive.current = false;
      socketRef.current = null;
      socket.close();
      // 다음 세션이 낡은 "붙어 있음"을 물려받지 않게 한다.
      setReady(false);
    };
    // userId가 바뀌면(= 다른 사용자로 로그인) 소켓을 새로 연다.
  }, [userId]);

  const value = useMemo<SessionSocketValue>(
    () => ({ ready, changed, send, subscribeCall }),
    [ready, changed, send, subscribeCall],
  );

  return (
    <SessionSocketContext.Provider value={value}>
      {children}
    </SessionSocketContext.Provider>
  );
}
