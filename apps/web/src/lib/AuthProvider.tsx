import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
} from './auth-context';
import type { User } from './contracts.gen';

// 액세스 토큰이 만료되기 전에 미리 세션을 회전(idle 창 연장)하는 지점 — 남은 수명의 이 비율.
// 0.75면 15분 토큰을 ~11분에 갱신해, 네트워크 지연·시계 오차가 있어도 만료 전에 여유가 있다.
const REFRESH_LEAD_RATIO = 0.75;
// 스케줄이 과도하게 촘촘해지지 않게 하는 하한(아주 짧은 TTL·시계 튐 방어).
const MIN_REFRESH_DELAY_MS = 30_000;
// 탭 복귀·창 포커스·온라인 복귀 시 "직전 회전이 이보다 오래됐을 때만" 즉시 한 번 회전한다.
// 백그라운드에서 setTimeout이 억제/동결돼 예약 회전이 밀렸을 때를 보정한다. 매 포커스마다
// 회전하면 낭비라 창을 둔다.
const WAKE_REFRESH_MIN_INTERVAL_MS = 60_000;

// 인증 상태의 단일 원천 — 세션 확인·폐기가 전부 여기를 거친다.
// 페이지들은 useAuth()로 상태를 읽고 전이 함수(signIn/refresh/signOut)만 호출한다.
//
// 세션은 HttpOnly 쿠키다. 클라이언트에는 토큰이 없고 쿠키를 읽을 수도 없으므로
// "로그인 상태인가"는 서버(/auth/me)에 묻는 것으로만 알 수 있다 — 초기 상태가 항상
// loading인 이유다(localStorage 토큰을 쓰던 시절엔 유무로 미리 판단할 수 있었다).
//
// 경합 방어: 모든 전이는 세대(generation)를 올리고, 비동기 확인은 시작 시점의 세대를
// 기억했다가 "여전히 최신일 때만" 결과를 commit한다 — 늦게 도착한 이전 확인 응답이
// 로그인/로그아웃 결과를 덮어쓰지 못한다.
//
// 선제 갱신: 액세스 토큰은 HttpOnly라 exp를 읽을 수 없으므로, 서버가 응답에 담아주는
// accessTokenTtlMs로 만료 전(75% 지점)에 세션을 회전시킨다. 이렇게 해야 요청이 없는
// 방치 탭도 idle 창에서 죽지 않고 absolute 상한(7일)까지 세션이 밀린다(plan/auth.md §6).
export function AuthProvider({ children }: { children: ReactNode }) {
  const generation = useRef(0);
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  // 선제 갱신 타이머, 마지막 회전 시각(wake 보정 기준), 마지막으로 안 액세스 토큰 수명.
  const refreshTimer = useRef<number | null>(null);
  const lastRefreshAt = useRef(0);
  const lastTtlMs = useRef(0);
  // schedule ↔ refresh(재검증)의 상호 참조를 끊기 위한 최신 함수 홀더 — rotateNow가
  // 순환 의존 없이 둘을 부를 수 있게 ref로 우회한다.
  const scheduleRef = useRef<(ttlMs: number) => void>(() => {});
  const verifyRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimer.current !== null) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  // 지금 즉시 세션을 회전한다(예약 타이머 만료·탭 복귀 시). 성공하면 새 수명으로 다음
  // 회전을 예약하고, 실패하면 재검증(me)에 상태 정리를 맡긴다 — 다른 탭이 먼저 회전한
  // 경합일 수 있어 곧장 anonymous로 끊지 않는다. 반응형 401 경로와 single-flight를
  // 공유하므로(api.refreshSession) 겹쳐 불려도 실제 요청은 한 번만 나간다.
  const rotateNow = useCallback(async () => {
    const { ok, ttlMs } = await api.refreshSession();
    if (!ok) {
      void verifyRef.current();
      return;
    }
    lastRefreshAt.current = Date.now();
    scheduleRef.current(ttlMs ?? lastTtlMs.current);
  }, []);

  // 남은 수명의 75% 지점에 회전을 예약한다(직전 예약은 대체).
  // ttlMs는 서버가 준 액세스 토큰 수명 — 첫 예약은 쿠키에 남아 있던 토큰의 잔여 수명과
  // 어긋날 수 있으나(서버가 주는 값은 서명 TTL 전체다), 회전이 한 번 돌면 이후는 정확해지고,
  // 그 전 공백은 반응형 401 경로와 wake 보정이 메운다.
  const schedule = useCallback(
    (ttlMs: number) => {
      clearRefreshTimer();
      lastTtlMs.current = ttlMs;
      const delay = Math.max(ttlMs * REFRESH_LEAD_RATIO, MIN_REFRESH_DELAY_MS);
      refreshTimer.current = window.setTimeout(() => {
        void rotateNow();
      }, delay);
    },
    [clearRefreshTimer, rotateNow],
  );

  // me로 세션을 확인해 상태를 확정하고, 인증되면 선제 갱신을 (재)예약한다.
  const refresh = useCallback(async (): Promise<boolean> => {
    const gen = ++generation.current;
    try {
      const { user, accessTokenTtlMs } = await api.me();
      if (generation.current !== gen) return false; // 더 새로운 전이가 있었음 — 폐기
      setState({ status: 'authenticated', user });
      lastRefreshAt.current = Date.now();
      schedule(accessTokenTtlMs);
      return true;
    } catch {
      if (generation.current !== gen) return false;
      setState({ status: 'anonymous' });
      clearRefreshTimer();
      return false;
    }
  }, [schedule, clearRefreshTimer]);

  // schedule/refresh를 ref에 최신으로 실어, rotateNow가 순환 의존 없이 부를 수 있게 한다.
  useEffect(() => {
    scheduleRef.current = schedule;
    verifyRef.current = refresh;
  }, [schedule, refresh]);

  // 초기 진입: "아무 전이도 시작되지 않았을 때(세대 0)"만 세션을 확인한다.
  // mount effect는 자식→부모 순서라, 자식(콜백 페이지의 refresh 등)이 이미 전이를
  // 시작했다면 그쪽이 최신이므로 초기 확인을 생략해야 중복 요청과 역전이 없다.
  useEffect(() => {
    if (generation.current !== 0) return;
    void refresh();
  }, [refresh]);

  // 언마운트 시 예약 타이머를 정리한다(누수 방지).
  useEffect(() => clearRefreshTimer, [clearRefreshTimer]);

  // 탭 복귀·창 포커스·온라인 복귀 시, 직전 회전이 충분히 오래됐으면 즉시 회전한다 —
  // 백그라운드에서 setTimeout이 억제/동결돼 예약 회전이 밀렸을 때 세션을 이어준다.
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const onWake = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastRefreshAt.current < WAKE_REFRESH_MIN_INTERVAL_MS) {
        return;
      }
      void rotateNow();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [state.status, rotateNow]);

  // 전이 함수들은 참조가 안정적이어야 한다(useCallback) — 콜백 페이지의 effect가
  // 상태 전이 때마다 재실행되는 것을 막는다.
  const signIn = useCallback(
    (user: User, accessTokenTtlMs: number) => {
      generation.current++; // 진행 중인 이전 확인 무효화
      setState({ status: 'authenticated', user });
      lastRefreshAt.current = Date.now();
      schedule(accessTokenTtlMs);
    },
    [schedule],
  );

  // 쿠키 세션은 서버만 지울 수 있다(JS가 HttpOnly 쿠키를 못 지운다). 따라서 응답을
  // 확인하기 전에 상태를 비우면 "로그아웃했다고 말했는데 실제로는 세션이 살아 있는" 상태가
  // 된다 — 새로고침 한 번에 되살아난다. 서버가 지웠다고 확인해준 뒤에만 상태를 비운다.
  const signOut = useCallback(async (): Promise<boolean> => {
    // 진행 중인 확인을 먼저 무효화한다 — 늦은 응답이 로그아웃 결과를 흔들지 못하게.
    const gen = ++generation.current;
    try {
      await api.logout();
    } catch {
      return false; // 쿠키가 그대로다 — 여전히 로그인 상태
    }
    if (generation.current === gen) {
      setState({ status: 'anonymous' });
      clearRefreshTimer();
    }
    return true;
  }, [clearRefreshTimer]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, refresh, signOut }),
    [state, signIn, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
