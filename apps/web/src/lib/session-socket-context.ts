import { createContext, useContext } from 'react';

export interface SessionSocketValue {
  // 내 소켓이 붙어 있는가.
  //
  // 화면은 이 값이 true일 때만 `SessionListItem.isConnected`를 믿는다. 붙어 있지 않으면
  // 서버가 내려준 presence가 "아무도 안 붙었다"인지 "소켓 서비스가 죽었다"인지 구별할
  // 방법이 없고, 후자를 전자로 읽으면 멀쩡한 기기들을 전부 "비활성"이라고 **지어내게**
  // 된다. 모를 때는 이 기능이 생기기 전의 두 갈래(Current/Active)로 물러난다.
  ready: boolean;
  // 목록이 바뀌었다는 신호가 온 횟수. 화면은 이 값이 늘면 다시 가져온다 —
  // 소켓이 목록 자체를 나르지 않기 때문이다(그래야 재조회가 기존 HTTP 경로를 탄다).
  changed: number;
}

export const SessionSocketContext = createContext<SessionSocketValue>({
  ready: false,
  changed: 0,
});

export function useSessionSocket(): SessionSocketValue {
  return useContext(SessionSocketContext);
}
