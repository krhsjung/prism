import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, setSessionAuthority } from './api';
import { log } from './log';
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
//
// 세션 회전은 여기서 **예약하지 않는다.** 타이머로 미리 돌리면 요청이 없는 동안에도
// 세션이 밀려 idle 타임아웃이 무의미해진다 — 탭만 열어두면 absolute 상한까지 살아 있게
// 된다. 회전은 요청이 있을 때만, 만료가 임박했을 때 api 계층이 보내기 직전에 한다
// (api.ts의 isNearExpiry). 유휴 탭은 idle 창이 지나면 정직하게 만료된다(plan/auth.md §6).
export function AuthProvider({ children }: { children: ReactNode }) {
  const generation = useRef(0);
  // 세션의 **정체**를 가리키는 표식. 로그인·로그아웃·원격 종료처럼 세션이 갈릴 때만
  // 오른다 — 복원·회전은 같은 세션을 잇는 것이라 값을 바꾸지 않는다. generation은 진행
  // 중인 확인을 무효화하는 용도라 확인마다 오르므로 이 자리에 쓸 수 없다.
  const sessionMark = useRef(0);
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // 스스로 로그아웃한 것이 **아닌데** 로그인 화면으로 온 경우 — 로그인 화면이 한 줄
  // 알려 주는 데 쓴다.
  //
  // **원인은 단정하지 않는다.** 서버는 폐기·만료·로그아웃을 모두 `UNAUTHORIZED` 하나로
  // 알려주므로, "다른 기기에서 해제됐다"고 말하면 단순 만료에도 없는 사실을 지어낸다.
  // 반대로 **첫 진입의 실패는 알리지 않는다**: 쿠키를 읽을 수 없어 "세션이 있었는데 끊긴
  // 것"과 "처음 온 것"이 구분되지 않는다(그래서 `/auth/me`가 SESSION_OWNED_PATHS다).
  const [endedUnexpectedly, setEndedUnexpectedly] = useState(false);
  // 지금 **로그인된 화면을 보고 있는가.** 콜백 안에서 읽어야 해서 ref로도 들고 있는다
  // (useCallback이 붙잡은 state는 낡는다).
  const signedIn = useRef(false);
  // 지금 진행 중인 로그아웃 **개수**.
  //
  // 서버 응답을 기다리는 동안 만료가 먼저 발견될 수 있다. 그때 안내를 띄우면 **자기가
  // 누른 버튼의 결과를 사고처럼 알리는 셈**이다. 그래서 의도를 기다리기 **전에** 세운다.
  //
  // boolean이 아니라 세는 이유: 겹쳐 눌릴 수 있는데, 그때 한쪽의 실패가 아직 진행 중인
  // 다른 로그아웃의 의도까지 내려 버린다.
  const signOutRequests = useRef(0);

  // 세션이 **확정적으로** 끝났다 — 로그인 화면으로 보내고, 필요하면 이유를 남긴다.
  //
  // 알릴지는 **어느 경로가 발견했는지가 아니라 무엇을 보고 있었는지**로 정한다. 같은
  // 만료를 복원·예약 타이머·화면 요청이 동시에 발견할 수 있어, 경로로 정하면 누가 먼저
  // 처리하느냐에 따라 같은 상황이 조용했다 시끄러웠다 한다. 로그인된 화면을 보고 있었을
  // 때만 설명이 필요하다 — 처음 열었을 때의 실패는 알릴 일이 아니다.
  //
  // 확인이 안 된 것(오프라인·5xx)에는 알리지 않는다. 세션이 끝났다고 말할 수 없다.
  //
  // @param definitive 서버가 세션을 **끝났다고 확정**했는가(401). 부르는 쪽이 이미 좁혀
  //   놓은 사실을 받는다 — 여기서 다시 오류 정체를 캐지 않는다.
  const endSignedInSession = useCallback((definitive: boolean) => {
    if (signedIn.current && definitive && signOutRequests.current === 0) {
      setEndedUnexpectedly(true);
    }
    signedIn.current = false;
    setState({ status: 'anonymous' });
  }, []);


  // me로 세션을 확인해 상태를 확정하고, 인증되면 선제 갱신을 (재)예약한다.
  const refresh = useCallback(async (): Promise<boolean> => {
    const gen = ++generation.current;
    try {
      const { user } = await api.me();
      if (generation.current !== gen) {
        log.auth('session_restore', { outcome: 'superseded' });
        return false; // 더 새로운 전이가 있었음 — 폐기
      }
      setEndedUnexpectedly(false);
      signedIn.current = true;
      setState({ status: 'authenticated', user });
      log.auth('session_restore', { outcome: 'restored' });
      return true;
    } catch (e) {
      if (generation.current !== gen) {
        log.auth('session_restore', { outcome: 'superseded' });
        return false;
      }
      // 세션이 없는 것으로 확정됐다 — 표식을 넘겨, 아직 떠 있는 옛 요청의 401이
      // 뒤늦게 갱신을 부르거나 다음 세션을 끊지 못하게 한다.
      sessionMark.current += 1;
      endSignedInSession(e instanceof ApiError && e.status === 401);
      log.auth('session_restore', { outcome: 'anonymous' });
      return false;
    }
  }, [endSignedInSession]);

  // 갱신으로 살아나지 않는 401을 만나면 api가 여기로 알린다 — 화면마다 처리하면
  // 빠뜨리는 곳이 생긴다(대시보드가 실제로 그래서 죽은 세션의 목록을 계속 보여 줬다).
  //
  // **초기 확인보다 먼저** 꽂는다(effect는 선언 순서대로 돈다) — 첫 `/auth/me`가 나가는
  // 시점에 주인이 없으면 그 요청은 표식 없이 떠난다.
  useEffect(() => {
    setSessionAuthority({
      mark: () => sessionMark.current,
      reject: (mark) => {
        // 그사이 세션이 갈렸다면 낡은 응답이 새 세션을 끊어서는 안 된다.
        if (mark !== sessionMark.current) return;
        generation.current += 1;
        sessionMark.current += 1;
        // api가 확정 401만 여기로 올린다 — 이유를 다시 확인할 필요가 없다.
        endSignedInSession(true);
          log.auth('session_rejected', { outcome: 'signed_out' });
      },
    });
    return () => setSessionAuthority(null);
  }, [endSignedInSession]);

  // 초기 진입: "아무 전이도 시작되지 않았을 때(세대 0)"만 세션을 확인한다.
  // mount effect는 자식→부모 순서라, 자식(콜백 페이지의 refresh 등)이 이미 전이를
  // 시작했다면 그쪽이 최신이므로 초기 확인을 생략해야 중복 요청과 역전이 없다.
  useEffect(() => {
    if (generation.current !== 0) return;
    void refresh();
  }, [refresh]);

  // 탭 복귀에 회전을 걸지 않는다. 그 보정은 **예약 타이머가 백그라운드에서 억제되는
  // 것**을 메우려던 것인데, 이제 예약 자체가 없다. 복귀 후 첫 요청이 만료를 만나면
  // api 계층이 보내기 직전에 회전하고(api.ts), 세션이 정말 끝났다면 세션 소켓이
  // 재연결에 실패하며 그 사실을 끌고 온다.

  // 전이 함수들은 참조가 안정적이어야 한다(useCallback) — 콜백 페이지의 effect가
  // 상태 전이 때마다 재실행되는 것을 막는다.
  const signIn = useCallback(
    (user: User) => {
      generation.current++; // 진행 중인 이전 확인 무효화
      sessionMark.current++; // 여기부터는 **다른 세션**이다
      signedIn.current = true;
      // 앞 세션이 어떻게 끝났든 이 세션과는 상관없다 — 남겨두면 이번에 **스스로**
      // 로그아웃했을 때도 로그인 화면이 "세션이 종료되었습니다"를 띄운다.
      setEndedUnexpectedly(false);
      setState({ status: 'authenticated', user });
    },
    [],
  );

  // 쿠키 세션은 서버만 지울 수 있다(JS가 HttpOnly 쿠키를 못 지운다). 따라서 응답을
  // 확인하기 전에 상태를 비우면 "로그아웃했다고 말했는데 실제로는 세션이 살아 있는" 상태가
  // 된다 — 새로고침 한 번에 되살아난다. 서버가 지웠다고 확인해준 뒤에만 상태를 비운다.
  const signOut = useCallback(async (): Promise<boolean> => {
    // 진행 중인 확인을 먼저 무효화한다 — 늦은 응답이 로그아웃 결과를 흔들지 못하게.
    const gen = ++generation.current;
    // 응답을 **기다리기 전에** 의도를 세운다(위 signOutRequests 설명).
    signOutRequests.current += 1;
    try {
      try {
        await api.logout();
      } catch {
        log.auth('logout', { outcome: 'failed' });
        return false; // 쿠키가 그대로다 — 여전히 로그인 상태
      }
      sessionMark.current++; // 이 세션은 끝났다
      // 스스로 누른 로그아웃이다 — 그 사이 다른 경로가 먼저 올려 둔 안내도 내린다.
      // **세대 가드 밖이다**: 그 경로가 상태를 이미 정리했더라도 안내는 남아 있다.
      setEndedUnexpectedly(false);
      if (generation.current === gen) {
        signedIn.current = false;
        setState({ status: 'anonymous' });
        }
      log.auth('logout', { outcome: 'success' });
      return true;
    } finally {
      signOutRequests.current -= 1;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, endedUnexpectedly, signIn, refresh, signOut }),
    [state, endedUnexpectedly, signIn, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
