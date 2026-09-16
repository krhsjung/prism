import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import { useAuth } from './auth-context';
import { useSessionSocket } from './session-socket-context';
import { SessionsContext, type SessionsValue } from './sessions-context';
import type { SessionListItem } from './contracts.gen';

/** 받아 둔 목록과 **그것이 누구의 것인지**. */
interface Loaded {
  // 이 목록을 받은 사용자.
  //
  // 목록만 들고 있으면 로그아웃 뒤 다시 로그인했을 때 앞 세션의 목록이 새 세션의 화면에
  // 한 프레임 그려진다 — 효과에서 지우는 것으로는 그 프레임을 막지 못한다. 주인을 함께
  // 적어 두고 **읽을 때 대조**하면 그 순간이 아예 없다.
  user: string;
  /** `null`이면 아직 못 받아 봤다(또는 재시도로 비웠다). */
  items: SessionListItem[] | null;
  failed: boolean;
}

/**
 * 내 활성 세션 목록을 **앱에 하나만** 둔다.
 *
 * 이 목록은 대시보드의 것이 아니다 — 대시보드가 관리하고, 통화가 상대를 고르고, 푸시가
 * 대상을 고른다. 세 화면이 각자 조회하고 각자 소켓 신호를 듣던 때는 **화면마다 신선도가
 * 달랐다**: 웹은 셋 다 같은 규칙을 옮겨 적어 동작이 같았지만, 같은 규칙을 iOS·Android의
 * 푸시 화면에서는 옮겨 적지 않아 그 화면만 영영 낡은 채로 있었다. 화면을 하나 더 만들
 * 때마다 규칙을 다시 옮겨 적어야 하는 구조 자체가 그 버그의 원인이다.
 *
 * **소켓 곁에 둔다.** 목록의 신선도를 정하는 것은 소켓 신호이고, 소켓은 이미 인증 수명에
 * 매달려 있다(`SessionSocketProvider`). 화면 수명에 매달면 보고 있지 않은 화면의 목록이
 * 낡는다.
 *
 * ⚠️ **소켓이 목록을 나르지는 않는다.** 신호를 받으면 여기서 기존 `GET /auth/sessions`를
 * 다시 부른다 — 스탬핑·공유 회전·401 처리가 전부 그 HTTP 경로에 있고, 소켓이 목록을
 * 직접 주입하면 그것을 통째로 우회한다(plan/auth.md §6.3).
 */
export function SessionsProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const { ready: socketReady, changed, send } = useSessionSocket();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const userId = state.status === 'authenticated' ? state.user.id : null;

  // 언마운트 뒤 도착한 응답이 상태를 건드리지 않게 한다(경합·누수 방지).
  const alive = useRef(true);
  // 지금 로그인해 있는 사람. 정리(alive)만으로는 부족하다 — 사용자가 바뀌면 효과가 다시
  // 돌며 alive를 곧바로 되살리므로, **앞 세션의 응답이 살아난 뒤에** 도착할 수 있다.
  const currentUser = useRef(userId);
  // 목록을 이미 받아 둔 사용자. StrictMode의 이중 마운트에서 두 번 나가지 않게 하고,
  // 다시 로그인하면 다시 받게 한다.
  const loadedFor = useRef<string | null>(null);
  // 이미 반영한 신호 번호. 소켓은 **재로그인을 건너 살아 있어** 카운터가 이미 올라가
  // 있을 수 있다 — 0에서 시작하면 이미 지나간 신호를 새 신호로 읽어 로그인 직후의 첫
  // 조회와 겹친다(plan/auth.md §6의 single-flight를 두고 경합한다).
  const handled = useRef(changed);
  // 마지막으로 **출발한** 조회의 번호. 조회는 겹칠 수 있고 응답은 순서대로 오지 않는다 —
  // 로그인 직후의 첫 조회가 등록 뒤의 재조회보다 **늦게** 돌아오면 `pushRegistered: true`를
  // false로 덮는다(실제로 그 순서가 났다). 자기보다 새 조회가 출발한 뒤 돌아온 응답은 버린다.
  const latestRequest = useRef(0);

  // `background`는 **내가 시킨 일이 아닌 재조회**라는 뜻이다 — 그 경우 세션의 유휴 창을
  // 밀지 않는다. 사용자가 한 일이 아닌 트래픽까지 창을 밀면 기기가 둘일 때 서로가 서로의
  // 세션을 영원히 살려낸다(plan/auth.md §6).
  // ⚠️ **의존성이 없다(신원은 ref로 읽는다).** 이 함수는 아래 두 효과의 의존성이고
  // 화면들에도 그대로 나가므로, 로그인할 때마다 새로 만들어지면 그 효과들이 함께 다시
  // 돈다 — 소켓 신호를 듣는 효과가 다시 도는 것은 곧 재조회 한 번이다.
  const fetchSessions = useCallback(
    async (background = false) => {
      const user = currentUser.current;
      if (!user) return;
      const request = ++latestRequest.current;
      // 이 응답이 아직 최신인가 — 그사이 더 새 조회가 출발했으면 그쪽이 사실을 안다.
      const fresh = () =>
        alive.current &&
        currentUser.current === user &&
        latestRequest.current === request;
      try {
        const list = await api.sessions(background);
        if (fresh()) {
          setLoaded({ user, items: list, failed: false });
        }
      } catch {
        // 목록을 못 가져오는 것이 곧 로그아웃은 아니다 — 세션이 끝났으면 api 계층이
        // 이미 로그인으로 돌려보내고 있다. 여기서는 사실만 적고 **있던 목록은 둔다**:
        // 지우면 재시도할 대상이 화면에서 사라진다.
        if (fresh()) {
          setLoaded((prev) => ({
            user,
            items: prev?.user === user ? prev.items : null,
            failed: true,
          }));
        }
      }
    },
    [],
  );

  // 소켓이 붙어 있지 않으면 **보내지 않는다**(큐에 쌓지도 않는다) — 다시 붙을 때 서버가
  // 업그레이드에서 세션을 검증한다.
  //
  // ⚠️ 그동안 남은 기기가 낡은 `pushRegistered`를 볼 수 있다. **스윕은 못 메운다** —
  // 세션 id 목록만 대조하므로 구성원이 그대로인 변화는 보이지 않는다. 그 기기가 스스로
  // 재연결하면(첫 ready가 신호를 올린다) 그때 맞는다.
  const notifyChanged = useCallback(() => {
    send({ type: 'sessionsStale' });
  }, [send]);

  const reload = useCallback(async () => {
    const user = currentUser.current;
    if (user) setLoaded({ user, items: null, failed: false });
    await fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    // **다시 살아났음을 먼저 표시한다.** StrictMode는 개발에서 마운트→정리→마운트를
    // 한 번 더 돌리는데, 정리가 alive를 끈 뒤 두 번째 마운트가 loadedFor에 막히면
    // 첫 요청의 응답이 영영 버려져 화면이 로딩에 멈춘다(운영 빌드에서는 이중 마운트가
    // 없어 드러나지 않는다).
    alive.current = true;
    currentUser.current = userId;
    if (!userId) {
      // 로그아웃 — 다음 로그인이 목록을 **다시 받게** 한다. 들고 있는 목록을 여기서
      // 지우지는 않는다(주인을 대조해 읽으므로 새어 나가지 않는다).
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current !== userId) {
      loadedFor.current = userId;
      void fetchSessions();
    }
    return () => {
      alive.current = false;
    };
  }, [userId, fetchSessions]);

  // 소켓이 "바뀌었다"고 하면 다시 가져온다.
  //
  // **비우지 않는다** — 다른 기기가 하나 붙었다고 목록이 "불러오는 중"으로 접혔다 펴지면
  // 통째로 깜빡인다(plan/dashboard.md §4). 재연결의 첫 ready도 이 신호를 올리므로,
  // 끊겨 있던 동안 놓친 변화가 복귀와 함께 따라온다 — 모바일이 백그라운드를 다녀오는
  // 경로가 그것 하나로 덮인다.
  useEffect(() => {
    if (changed === handled.current) return;
    handled.current = changed;
    // 로그아웃 상태에서 온 신호는 **소비만 하고 버린다** — 남겨 두면 다음 로그인의 첫
    // 조회 직후에 얻을 것 없는 재조회가 한 번 더 나간다.
    if (!userId) return;
    void fetchSessions(true);
  }, [userId, changed, fetchSessions]);

  // **읽을 때 주인을 대조한다** — 앞 세션의 목록은 다음 세션에서 보이지 않는다.
  const mine = loaded?.user === userId ? loaded : null;

  const value = useMemo<SessionsValue>(
    () => ({
      sessions: mine?.items ?? null,
      loadFailed: mine?.failed ?? false,
      socketReady,
      refresh: fetchSessions,
      reload,
      notifyChanged,
    }),
    [mine, socketReady, fetchSessions, reload, notifyChanged],
  );

  return (
    <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>
  );
}
