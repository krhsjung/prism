import { createContext, useContext } from 'react';
import type {
  CallServerMessage,
  SocketUpstreamMessage,
} from './contracts.gen';

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
  // 클라 → 서버 메시지를 보낸다(통화 시그널링 · 세션 재검증 요청). 소켓이 붙어 있지
  // 않으면 **false**이고, 그때 화면은 통화를 성립한 것처럼 그리지 않는다.
  send(message: SocketUpstreamMessage): boolean;
  // 통화 메시지를 듣는다. 정리 함수를 돌려준다.
  //
  // 소켓이 앱 전역에 하나뿐이라 구독도 여기 산다 — 걸려 온 통화는 WebRTC 화면이
  // 아니라 **앱 위에** 떠야 하고(plan/webrtc.md §4), 대시보드를 보고 있어도 울려야 한다.
  subscribeCall(handler: (message: CallServerMessage) => void): () => void;
}

export const SessionSocketContext = createContext<SessionSocketValue>({
  ready: false,
  changed: 0,
  // Provider 밖(테스트·스토리)에서는 아무것도 나가지 않는다. 조용히 성공한 척하면
  // 화면이 "걸었다"고 믿고 영영 기다린다.
  send: () => false,
  subscribeCall: () => () => {},
});

export function useSessionSocket(): SessionSocketValue {
  return useContext(SessionSocketContext);
}
