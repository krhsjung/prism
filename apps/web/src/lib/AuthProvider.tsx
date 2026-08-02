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
export function AuthProvider({ children }: { children: ReactNode }) {
  const generation = useRef(0);
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async (): Promise<boolean> => {
    const gen = ++generation.current;
    try {
      const user = await api.me();
      if (generation.current !== gen) return false; // 더 새로운 전이가 있었음 — 폐기
      setState({ status: 'authenticated', user });
      return true;
    } catch {
      if (generation.current !== gen) return false;
      setState({ status: 'anonymous' });
      return false;
    }
  }, []);

  // 초기 진입: "아무 전이도 시작되지 않았을 때(세대 0)"만 세션을 확인한다.
  // mount effect는 자식→부모 순서라, 자식(콜백 페이지의 refresh 등)이 이미 전이를
  // 시작했다면 그쪽이 최신이므로 초기 확인을 생략해야 중복 요청과 역전이 없다.
  useEffect(() => {
    if (generation.current !== 0) return;
    void refresh();
  }, [refresh]);

  // 전이 함수들은 참조가 안정적이어야 한다(useCallback) — 콜백 페이지의 effect가
  // 상태 전이 때마다 재실행되는 것을 막는다.
  const signIn = useCallback((user: User) => {
    generation.current++; // 진행 중인 이전 확인 무효화
    setState({ status: 'authenticated', user });
  }, []);

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
    if (generation.current === gen) setState({ status: 'anonymous' });
    return true;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, refresh, signOut }),
    [state, signIn, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
