import { vi } from 'vitest';
import type { api as realApi } from './api';

/**
 * 테스트용 `api` 한 벌 — **완전한 가짜다.**
 *
 * `test-theme.ts`·`test-i18n.ts`와 같은 자리이고 같은 이유다: 화면이 쓰는 값을 테스트가
 * 손으로 다시 짓지 않게 한 곳에 둔다.
 *
 * ⚠️ **`satisfies`가 이 파일의 전부다.** 테스트가 `vi.mock('./api', () => ({ api: { … } }))`로
 * 일부만 채우면, 화면이 나중에 쓰기 시작한 메서드가 **조용히 `undefined`가 된다** — 그
 * 호출은 대부분 `try` 안에서 일어나므로(예: `SessionsProvider`의 조회, `AuthProvider`의
 * 로그아웃) TypeError가 catch로 들어가 "네트워크 실패"와 구별되지 않는다. 실제로 그렇게
 * 한 번 지나갔다(`rememberPushWanted`). 여기서 한 번 완전하게 만들어 두면 메서드가 늘 때
 * **이 파일 하나가 컴파일에서 깨진다.**
 *
 * 진짜를 펼치는 방법(`importActual`)도 있지만 그쪽은 스텁하지 않은 메서드가 **진짜
 * `fetch`로 나간다.** 테스트가 네트워크에 닿을 이유가 없으므로 전부 `vi.fn()`으로 둔다.
 */
type Api = typeof realApi;

// 반환 타입을 `Api`로 **적지 않는다.** 적으면 호출부에서 `mockResolvedValue` 같은
// vitest의 손잡이가 보이지 않는다 — `satisfies`는 검사만 하고 추론된 타입을 넓히지 않는다.
export function fakeApi() {
  return {
    demoLogin: vi.fn<Api['demoLogin']>(),
    socialLoginUrl: vi.fn<Api['socialLoginUrl']>(
      () => 'https://example.test/auth/google',
    ),
    me: vi.fn<Api['me']>(),
    logout: vi.fn<Api['logout']>(),
    refreshSession: vi.fn<Api['refreshSession']>(),
    sessions: vi.fn<Api['sessions']>(),
    revokeSession: vi.fn<Api['revokeSession']>(),
    revokeAllSessions: vi.fn<Api['revokeAllSessions']>(),
    unregisterPush: vi.fn<Api['unregisterPush']>(),
    registerPush: vi.fn<Api['registerPush']>(),
    sendPush: vi.fn<Api['sendPush']>(),
  } satisfies Api;
}
