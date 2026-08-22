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

// 액세스 토큰이 만료되기 전에 미리 세션을 회전(idle 창 연장)하는 지점 — 남은 수명의 이 비율.
// 0.75면 15분 토큰을 ~11분에 갱신해, 네트워크 지연·시계 오차가 있어도 만료 전에 여유가 있다.
const REFRESH_LEAD_RATIO = 0.75;
// 스케줄이 과도하게 촘촘해지지 않게 하는 하한(아주 짧은 TTL·시계 튐 방어).
const MIN_REFRESH_DELAY_MS = 30_000;
// 일시적 실패(오프라인·5xx)로 회전하지 못했을 때 다시 시도하는 간격(네이티브와 같은 값).
// 예약 타이머는 이미 소모됐으므로, 여기서 다시 걸지 않으면 선제 갱신이 영영 멈춘다.
const RETRY_REFRESH_DELAY_MS = 60_000;
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

  // 선제 갱신 타이머, 마지막 회전 시각(wake 보정 기준), 마지막으로 안 액세스 토큰 수명.
  const refreshTimer = useRef<number | null>(null);
  const lastRefreshAt = useRef(0);
  const lastTtlMs = useRef(0);
  // schedule ↔ refresh(재검증)의 상호 참조를 끊기 위한 최신 함수 홀더 — rotateNow가
  // 순환 의존 없이 둘을 부를 수 있게 ref로 우회한다.
  const scheduleRef = useRef<(ttlMs: number) => void>(() => {});
  const scheduleInRef = useRef<(delayMs: number) => void>(() => {});
  const verifyRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));

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
    const mark = sessionMark.current;
    const { ok, ttlMs, rejected } = await api.refreshSession();
    // 그사이 로그아웃/새 로그인이 앞질렀다면 이 회전은 **남의 것**이다 — 끝난 세션의
    // 수명으로 다음 타이머를 심으면 로그아웃한 화면 뒤에서 회전이 계속 돈다.
    if (sessionMark.current !== mark) return;
    if (!ok) {
      // 서버가 **확정 거부**한 경우만 재검증으로 넘긴다 — 다른 탭이 먼저 회전한 경합일
      // 수 있어 곧장 anonymous로 끊지 않고 me로 확인한다.
      if (rejected) {
        void verifyRef.current();
        return;
      }
      // 오프라인·5xx로 회전이 실패한 것뿐이라면 **로그인 화면으로 쫓아내지 않는다**
      // (네이티브와 같은 규칙). 소모된 타이머를 짧게 다시 건다.
      scheduleInRef.current(RETRY_REFRESH_DELAY_MS);
      return;
    }
    lastRefreshAt.current = Date.now();
    scheduleRef.current(ttlMs ?? lastTtlMs.current);
  }, []);

  // 남은 수명의 75% 지점에 회전을 예약한다(직전 예약은 대체).
  // ttlMs는 서버가 준 액세스 토큰 수명 — 첫 예약은 쿠키에 남아 있던 토큰의 잔여 수명과
  // 어긋날 수 있으나(서버가 주는 값은 서명 TTL 전체다), 회전이 한 번 돌면 이후는 정확해지고,
  // 그 전 공백은 반응형 401 경로와 wake 보정이 메운다.
  // 지금부터 delayMs 뒤에 회전을 예약한다(직전 예약은 대체).
  const scheduleIn = useCallback(
    (delayMs: number) => {
      clearRefreshTimer();
      refreshTimer.current = window.setTimeout(() => {
        void rotateNow();
      }, delayMs);
    },
    [clearRefreshTimer, rotateNow],
  );

  const schedule = useCallback(
    (ttlMs: number) => {
      lastTtlMs.current = ttlMs;
      scheduleIn(Math.max(ttlMs * REFRESH_LEAD_RATIO, MIN_REFRESH_DELAY_MS));
    },
    [scheduleIn],
  );

  // me로 세션을 확인해 상태를 확정하고, 인증되면 선제 갱신을 (재)예약한다.
  const refresh = useCallback(async (): Promise<boolean> => {
    const gen = ++generation.current;
    try {
      const { user, accessTokenTtlMs } = await api.me();
      if (generation.current !== gen) {
        log.auth('session_restore', { outcome: 'superseded' });
        return false; // 더 새로운 전이가 있었음 — 폐기
      }
      setEndedUnexpectedly(false);
      signedIn.current = true;
      setState({ status: 'authenticated', user });
      lastRefreshAt.current = Date.now();
      schedule(accessTokenTtlMs);
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
      clearRefreshTimer();
      log.auth('session_restore', { outcome: 'anonymous' });
      return false;
    }
  }, [schedule, clearRefreshTimer, endSignedInSession]);

  // schedule/refresh를 ref에 최신으로 실어, rotateNow가 순환 의존 없이 부를 수 있게 한다.
  useEffect(() => {
    scheduleRef.current = schedule;
    scheduleInRef.current = scheduleIn;
    verifyRef.current = refresh;
  }, [schedule, scheduleIn, refresh]);

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
        clearRefreshTimer();
        log.auth('session_rejected', { outcome: 'signed_out' });
      },
    });
    return () => setSessionAuthority(null);
  }, [clearRefreshTimer, endSignedInSession]);

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
      sessionMark.current++; // 여기부터는 **다른 세션**이다
      signedIn.current = true;
      // 앞 세션이 어떻게 끝났든 이 세션과는 상관없다 — 남겨두면 이번에 **스스로**
      // 로그아웃했을 때도 로그인 화면이 "세션이 종료되었습니다"를 띄운다.
      setEndedUnexpectedly(false);
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
        clearRefreshTimer();
      }
      log.auth('logout', { outcome: 'success' });
      return true;
    } finally {
      signOutRequests.current -= 1;
    }
  }, [clearRefreshTimer]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, endedUnexpectedly, signIn, refresh, signOut }),
    [state, endedUnexpectedly, signIn, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
