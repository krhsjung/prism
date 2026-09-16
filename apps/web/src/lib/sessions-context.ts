import { createContext, useContext } from 'react';
import type { SessionListItem } from './contracts.gen';

export interface SessionsValue {
  // 내 활성 세션 목록. **`null`은 "아직 못 받아 봤다"**이고 "비어 있음"이 아니다 —
  // 현재 세션은 항상 하나 존재하므로 진짜 빈 목록은 없다(plan/dashboard.md §3.2).
  sessions: SessionListItem[] | null;
  // 마지막 조회가 실패했는가. 목록은 지우지 않는다 — 있던 것을 지우면 재시도할 대상이
  // 화면에서 사라진다.
  loadFailed: boolean;
  // 내 소켓이 붙어 있는가.
  //
  // 화면은 이 값이 true일 때만 `SessionListItem.isConnected`를 믿는다. 붙어 있지 않으면
  // 서버가 내려준 presence가 "아무도 안 붙었다"인지 "소켓 서비스가 죽었다"인지 구별할
  // 방법이 없고, 후자를 전자로 읽으면 멀쩡한 기기들을 전부 "비활성"이라고 지어내게 된다.
  socketReady: boolean;
  // 목록을 다시 가져온다. 화면에 있는 목록은 **지우지 않는다** — 카드가 "불러오는 중"
  // 으로 접혔다 펴지면 목록 전체가 깜빡인다(plan/dashboard.md §4).
  //
  // `background`는 **다른 일에 딸린 재조회**라는 뜻이다 — 그 경우 세션의 유휴 창을 밀지
  // 않는다(plan/auth.md §6). 사용자가 스스로 시킨 새로고침은 기본값(= 활동)이다.
  refresh(background?: boolean): Promise<void>;
  // 재시도 — 목록을 비우고 처음부터 다시 불러온다. 있던 것이 틀렸다고 판명된 자리다.
  reload(): Promise<void>;
  // **다른 기기에도 알린다** — 방금 HTTP로 내 세션 레코드를 고쳤다(해제 · 전체 해제 ·
  // 알림 등록/해제). 서버는 이 말을 믿지 않고 세션 저장소를 다시 읽은 뒤, 남은 기기에
  // `sessionsChanged`를 보낸다.
  //
  // 목록을 쥔 쪽이 이 일도 맡는다 — 바꾼 화면마다 소켓을 따로 들고 있으면 어느 화면은
  // 알리고 어느 화면은 잊는다(알림 끄기가 실제로 그랬다).
  //
  // ⚠️ **스윕이 이것을 대신하지 못한다.** 서버의 스윕은 세션 id 목록만 대조하므로
  // 폐기처럼 구성원이 바뀌는 변화만 잡는다 — 알림 등록/해제는 구성원이 그대로라
  // 브로드캐스트가 나가지 않고, 남은 기기는 자기가 재연결할 때까지 낡은 값을 본다.
  notifyChanged(): void;
}

// Provider 밖(테스트·스토리)에서는 **빈 채로 아무것도 하지 않는다.** 조용히 성공한 척하면
// 화면이 "받았는데 비어 있다"고 믿는다.
export const SessionsContext = createContext<SessionsValue>({
  sessions: null,
  loadFailed: false,
  socketReady: false,
  refresh: async () => {},
  reload: async () => {},
  notifyChanged: () => {},
});

export function useSessions(): SessionsValue {
  return useContext(SessionsContext);
}
