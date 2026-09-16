import { createContext, useContext } from 'react';
import type { PushPermission } from './registration';

/**
 * 이 기기의 알림 등록 — 화면이 읽는 상태와 시킬 수 있는 일 두 가지.
 *
 * 등록의 **수명은 여기 있고 화면에는 없다.** 권한·토큰·서버 등록·목록 갱신·다른 기기
 * 알림이 한 흐름인데, 그것이 전역 복원(로그인 직후)과 푸시 화면에 각각 한 벌씩 있으면
 * 같은 버그를 두 자리에서 고치게 되고, 둘이 겹쳐 돌면 늦게 끝난 쪽이 먼저 끝난 쪽을
 * 조용히 덮는다(`PushRegistrationProvider`).
 */
export interface PushRegistrationValue {
  // 이 브라우저의 권한. FCM이 지원하지 않는 브라우저는 권한이 무엇이든 `unsupported`다 —
  // 그러지 않으면 켜기 버튼이 서고 눌러도 아무 일이 없다(plan/push.md §5-19).
  permission: PushPermission;
  // 권한을 묻고 지금 세션에 등록한다(푸시 화면의 `알림 켜기`). **명시적 제스처 뒤에만**
  // 부른다 — 진입만으로 권한 창을 띄우는 것은 브라우저가 벌주는 패턴이다.
  enable(): Promise<void>;
  // 이 세션을 대상에서 뺀다(`알림 끄기`). 권한은 그대로다(§5-15).
  disable(): Promise<void>;
}

// Provider 밖(테스트·스토리)에서는 아무것도 하지 않는다 — 조용히 성공한 척하지 않는다.
export const PushRegistrationContext = createContext<PushRegistrationValue>({
  permission: 'unsupported',
  enable: async () => {},
  disable: async () => {},
});

export function usePushRegistration(): PushRegistrationValue {
  return useContext(PushRegistrationContext);
}
