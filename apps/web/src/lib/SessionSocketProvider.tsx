import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { connectSessionSocket } from './socket';
import {
  SessionSocketContext,
  type SessionSocketValue,
} from './session-socket-context';

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

  const userId = state.status === 'authenticated' ? state.user.id : null;

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
    });
    return () => {
      alive.current = false;
      socket.close();
      // 다음 세션이 낡은 "붙어 있음"을 물려받지 않게 한다.
      setReady(false);
    };
    // userId가 바뀌면(= 다른 사용자로 로그인) 소켓을 새로 연다.
  }, [userId]);

  const value = useMemo<SessionSocketValue>(
    () => ({ ready, changed }),
    [ready, changed],
  );

  return (
    <SessionSocketContext.Provider value={value}>
      {children}
    </SessionSocketContext.Provider>
  );
}
