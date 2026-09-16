import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushRegistrationProvider } from './PushRegistrationProvider';
import {
  usePushRegistration,
  type PushRegistrationValue,
} from './push-registration-context';
import { AuthContext, type AuthContextValue } from '../auth-context';
import { SessionsContext, type SessionsValue } from '../sessions-context';
import type {
  SessionListItem,
  SocketUpstreamMessage,
  User,
} from '../contracts.gen';

// api는 **완전한 가짜 한 벌** 위에 이 테스트가 쓰는 것만 덮는다(lib/test-api.ts).
vi.mock('../api', async () => {
  const api = (await import('../test-api')).fakeApi();
  api.registerPush.mockResolvedValue({ registered: true });
  api.unregisterPush.mockResolvedValue({ registered: false });
  return { api };
});
import { api } from '../api';

// 이 기기의 선택과 브라우저 권한 — 되살리기가 이 둘을 본다(§5-16).
// ⚠️ **원본을 펼친 위에 덮어쓴다.** 팩토리로 모듈을 통째로 대체하면, 대상이 나중에
// 새 export를 쓰기 시작했을 때 그 값이 조용히 `undefined`가 된다.
vi.mock('./registration', async () => {
  const actual =
    await vi.importActual<typeof import('./registration')>('./registration');
  return {
    ...actual,
    currentPermission: vi.fn<typeof actual.currentPermission>(() => 'granted'),
    pushSupported: vi.fn(async () => true),
    pushWanted: vi.fn(() => true),
    rememberPushWanted: vi.fn(),
    requestPermissionAndToken: vi.fn(async () => 'fcm-tok-1'),
    ensureOwner: vi.fn(async () => true),
  } satisfies typeof actual;
});
import {
  currentPermission,
  ensureOwner,
  pushSupported,
  pushWanted,
  rememberPushWanted,
  requestPermissionAndToken,
} from './registration';

const user: User = {
  id: 'u-1',
  provider: 'demo',
  displayName: 'Demo',
  createdAt: '2026-09-15T00:00:00.000Z',
};

const current: SessionListItem = {
  id: 'sess-1',
  startedAt: '2026-09-15T09:00:00.000Z',
  expiresAt: '2026-09-15T17:00:00.000Z',
  isCurrent: true,
  isConnected: true,
  pushRegistered: false,
  device: 'mac',
};

// 화면이 쓰는 손잡이를 바깥으로 꺼내 둔다 — 켜기·끄기를 테스트가 직접 누른다.
// 렌더 중에 바깥 변수를 쓰지 않고 효과에서 넘긴다(react-hooks 규칙).
let handle: PushRegistrationValue | null = null;
function Probe({ onValue }: { onValue: (value: PushRegistrationValue) => void }) {
  const value = usePushRegistration();
  useEffect(() => {
    onValue(value);
  }, [value, onValue]);
  return null;
}

function renderProvider(
  options: {
    authenticated?: boolean;
    sessions?: SessionListItem[] | null;
  } = {},
) {
  const { authenticated = true, sessions = [current] } = options;
  const sent: SocketUpstreamMessage[] = [];
  const refreshed: boolean[] = [];

  const authFor = (who: User | null): AuthContextValue => ({
    state: who ? { status: 'authenticated', user: who } : { status: 'anonymous' },
    endedUnexpectedly: false,
    signIn: vi.fn(),
    refresh: vi.fn(async () => true),
    signOut: vi.fn(async () => true),
  });
  let who: User | null = authenticated ? user : null;
  const value = (list: SessionListItem[] | null): SessionsValue => ({
    sessions: list,
    loadFailed: false,
    socketReady: true,
    refresh: async (background = false) => {
      refreshed.push(background);
    },
    reload: async () => {},
    notifyChanged: () => sent.push({ type: 'sessionsStale' }),
  });
  const tree = (list: SessionListItem[] | null) => (
    <AuthContext.Provider value={authFor(who)}>
      <SessionsContext.Provider value={value(list)}>
        <PushRegistrationProvider>
          <Probe
            onValue={(value) => {
              handle = value;
            }}
          />
        </PushRegistrationProvider>
      </SessionsContext.Provider>
    </AuthContext.Provider>
  );
  const { rerender } = render(tree(sessions));
  let list = sessions;
  return {
    sent,
    refreshed,
    // 목록이 바뀌었다(재조회 결과·소켓 신호).
    setSessions: (next: SessionListItem[] | null) => {
      list = next;
      rerender(tree(list));
    },
    // 사용자가 바뀌었다(로그아웃 뒤 다른 사람의 로그인).
    setUser: (next: User | null) => {
      who = next;
      rerender(tree(list));
    },
  };
}

// 탭으로 돌아왔다 — 권한을 다시 읽고 맞추는 계기다.
const returnToTab = () =>
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });

describe('PushRegistrationProvider', () => {
  beforeEach(() => {
    handle = null;
    vi.mocked(pushWanted).mockReturnValue(true);
    vi.mocked(currentPermission).mockReturnValue('granted');
    vi.mocked(requestPermissionAndToken).mockResolvedValue('fcm-tok-1');
    // `clearAllMocks`는 호출 기록만 지운다 — 앞 테스트가 심어 둔 구현은 여기서 되돌린다.
    vi.mocked(ensureOwner).mockResolvedValue(true);
    vi.mocked(pushSupported).mockResolvedValue(true);
    vi.mocked(api.registerPush).mockResolvedValue({ registered: true });
    vi.mocked(api.unregisterPush).mockResolvedValue({ registered: false });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // 표식(끄다 만 것 · 뜻)은 저장소에 남는다 — 앞 테스트의 것이 다음 테스트의 마운트를 움직이지 않게.
    localStorage.clear();
  });

  describe('되살리기', () => {
    it('받기로 해 뒀으면 조용히 다시 붙인다', async () => {
      renderProvider();

      await waitFor(() =>
        expect(api.registerPush).toHaveBeenCalledWith('fcm-tok-1'),
      );
    });

    // SDK의 지원 확인은 IndexedDB를 열어 보는 것이라 잠깐 실패할 수 있다 — 한 번 본 값으로
    // 굳히면 이 탭은 새로고침까지 `unsupported`로 남아 등록을 떼고 켜기 버튼을 감춘다.
    it('지원 확인이 잠깐 실패했어도 탭으로 돌아오면 다시 본다', async () => {
      vi.mocked(pushSupported).mockResolvedValueOnce(false);
      // 실제 토큰 발급도 같은 지원 확인을 지나므로 그동안은 토큰이 없다.
      vi.mocked(requestPermissionAndToken).mockResolvedValueOnce(null);
      renderProvider();
      await waitFor(() => expect(handle?.permission).toBe('unsupported'));
      expect(api.registerPush).not.toHaveBeenCalled();

      returnToTab();

      await waitFor(() =>
        expect(api.registerPush).toHaveBeenCalledWith('fcm-tok-1'),
      );
      expect(handle?.permission).toBe('granted');
    });

    // 다른 탭이 같은 사람으로 다시 로그인해 쿠키를 갈아 끼웠다 — 이 탭의 "내 줄"이 다른
    // id가 된다. 붙인 토큰의 기억이 앞 세션의 것으로 남으면 같은 토큰을 새 세션에 붙이지
    // 않는다(다른 탭의 첫 등록이 실패했으면 그 세션은 영영 `Notifications off`다).
    it('같은 사람의 다른 세션으로 바뀌면 다시 붙인다', async () => {
      const { setSessions } = renderProvider();
      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));

      setSessions([{ ...current, id: 'sess-2', pushRegistered: false }]);

      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(2));
    });

    // 목록이 잠깐 빈 뒤(재조회 실패 → 다시 시도) 다른 세션이 오면 그것도 바뀐 것이다 — 빈
    // 순간을 "처음"으로 읽으면 앞 세션의 기억이 남아 새 세션에 붙이지 않는다.
    it('목록이 잠깐 비었다가 다른 세션으로 오면 다시 붙인다', async () => {
      const { setSessions } = renderProvider();
      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));

      setSessions(null);
      setSessions([{ ...current, id: 'sess-2', pushRegistered: false }]);

      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(2));
    });

    // 끄기는 선택을 먼저 지우고 뗀다 — 떼는 도중 창이 닫히면 "선택은 꺼짐 · 서버는 등록됨"이
    // 남는데, 이 탭이 붙인 기억이 없다고 건드리지 않으면 영영 남는다. 끄다 만 표식이 답한다.
    it('끄다 만 등록은 다음에 이어서 뗀다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      localStorage.setItem('prism.push.disable_pending', '1');
      // 끄기를 시작한 다른 탭(A)의 뜻이 마지막이다 — 이어서 뗀 것이 그 뜻을 매듭지어야 A의
      // 요청이 나중에 실패해도 선택을 켜 놓지 않는다.
      localStorage.setItem('prism.push.intent', 'off:a-tab');
      renderProvider({ sessions: [{ ...current, pushRegistered: true }] });

      await waitFor(() => expect(api.unregisterPush).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(localStorage.getItem('prism.push.disable_pending')).toBeNull(),
      );
      expect(localStorage.getItem('prism.push.intent')).not.toBe('off:a-tab');
    });

    // 떼지 못한 끄기는 선택을 켜진 채로 되돌린다 — 그래도 표식이 남아, 다음 맞추기가 선택과
    // 무관하게 이어서 떼고 그때 선택을 끈다.
    it('떼지 못한 끄기는 선택이 켜진 채여도 다음에 이어서 뗀다', async () => {
      vi.mocked(pushWanted).mockReturnValue(true);
      localStorage.setItem('prism.push.disable_pending', '1');
      renderProvider({ sessions: [{ ...current, pushRegistered: true }] });

      await waitFor(() => expect(api.unregisterPush).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(localStorage.getItem('prism.push.disable_pending')).toBeNull(),
      );
      expect(rememberPushWanted).toHaveBeenCalledWith(false);
      expect(api.registerPush).not.toHaveBeenCalled();
    });

    // 이어서 떼는 사이 다른 탭이 켜기에 성공해 표식을 지웠다 — 이 끄기는 뒤집힌 것이라 선택을
    // 덮지 않는다(덮으면 그 탭의 다음 맞추기가 방금 붙인 것을 뗀다).
    it('떼는 사이 다른 탭이 켜기에 성공했으면 선택을 덮지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(true);
      localStorage.setItem('prism.push.disable_pending', '1');
      let release: () => void = () => {};
      vi.mocked(api.unregisterPush).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ registered: false });
          }),
      );
      const { sent } = renderProvider({
        sessions: [{ ...current, pushRegistered: true }],
      });
      await waitFor(() => expect(api.unregisterPush).toHaveBeenCalledTimes(1));

      // 다른 탭의 켜기 성공 — 저장소의 표식이 사라진다.
      localStorage.removeItem('prism.push.disable_pending');
      await act(async () => {
        release();
        await Promise.resolve();
      });

      await waitFor(() => expect(sent.length).toBeGreaterThan(0));
      expect(rememberPushWanted).not.toHaveBeenCalledWith(false);
    });

    // 둘 다 켜는데 한쪽이 실패해 선택을 꺼 놓으면 다른 탭이 방금 붙인 것을 뗀다 — 실패한 켜기는
    // 그사이 다른 탭이 새 뜻을 세웠으면 되돌리지 않는다.
    it('켜기가 실패해도 그사이 다른 탭이 뜻을 세웠으면 선택을 되돌리지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      let fail: () => void = () => {};
      vi.mocked(api.registerPush).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = () => reject(new Error('offline'));
          }),
      );
      renderProvider();
      let enabling: Promise<void> | undefined;
      act(() => {
        enabling = handle?.enable();
      });
      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));

      // 다른 탭의 켜기 — 마지막 뜻이 바뀐다.
      localStorage.setItem('prism.push.intent', 'other-tab');
      await act(async () => {
        fail();
        await enabling;
      });

      expect(vi.mocked(rememberPushWanted).mock.calls.map((c) => c[0])).toEqual([true]);
    });

    it('끄기가 실패해도 그사이 다른 탭이 뜻을 세웠으면 선택을 되돌리지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(true);
      let fail: () => void = () => {};
      vi.mocked(api.unregisterPush).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = () => reject(new Error('offline'));
          }),
      );
      renderProvider({ sessions: [{ ...current, pushRegistered: true }] });
      await waitFor(() => expect(api.registerPush).toHaveBeenCalled());
      vi.mocked(rememberPushWanted).mockClear();
      let disabling: Promise<void> | undefined;
      act(() => {
        disabling = handle?.disable();
      });
      await waitFor(() => expect(api.unregisterPush).toHaveBeenCalledTimes(1));

      localStorage.setItem('prism.push.intent', 'other-tab');
      await act(async () => {
        fail();
        await disabling;
      });

      expect(vi.mocked(rememberPushWanted).mock.calls.map((c) => c[0])).toEqual([false]);
    });

    // 이보다 늦게 시작한 다른 탭의 같은 뜻이 실패하면 그쪽 표식이 마지막이라 되돌린다 — 그 실패가
    // 이 성공보다 **앞서면** 성공이 선택을 다시 남겨 바로잡고, **뒤서면** 성공이 뜻을 매듭지어
    // (새 표식) 되돌리기를 막는다. 요청이 나가 있는 동안 다른 탭이 시작하게 해 둘 다 본다.
    it('켜기·끄기가 성공하면 선택을 다시 남기고 뜻을 매듭짓는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      let release: () => void = () => {};
      vi.mocked(api.registerPush).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ registered: true });
          }),
      );
      renderProvider();
      let enabling: Promise<void> | undefined;
      act(() => {
        enabling = handle?.enable();
      });
      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));
      // 다른 탭(B)이 뒤에 켜기를 시작해 마지막 뜻을 쥐고, 먼저 실패해 선택을 되돌렸다.
      localStorage.setItem('prism.push.intent', 'on:b-tab');
      vi.mocked(rememberPushWanted).mockClear();
      await act(async () => {
        release();
        await enabling;
      });
      expect(vi.mocked(rememberPushWanted).mock.calls.map((c) => c[0])).toEqual([true]);
      expect(localStorage.getItem('prism.push.intent')).not.toBe('on:b-tab');

      vi.mocked(pushWanted).mockReturnValue(true);
      vi.mocked(api.unregisterPush).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ registered: false });
          }),
      );
      let disabling: Promise<void> | undefined;
      act(() => {
        disabling = handle?.disable();
      });
      await waitFor(() => expect(api.unregisterPush).toHaveBeenCalledTimes(1));
      localStorage.setItem('prism.push.intent', 'off:b-tab');
      vi.mocked(rememberPushWanted).mockClear();
      await act(async () => {
        release();
        await disabling;
      });
      expect(vi.mocked(rememberPushWanted).mock.calls.map((c) => c[0])).toEqual([false]);
      expect(localStorage.getItem('prism.push.intent')).not.toBe('off:b-tab');
    });

    // 붙는 데 성공한 켜기는 끄다 만 것을 덮는다 — 남기면 다음 맞추기가 방금 붙인 것을 뗀다.
    it('켜기가 성공하면 끄다 만 표식을 지운다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      renderProvider();
      localStorage.setItem('prism.push.disable_pending', '1');

      await act(async () => {
        await handle?.enable();
      });

      expect(api.registerPush).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('prism.push.disable_pending')).toBeNull();
    });

    // 남의 등록(다른 탭이 붙인 것)은 끈 적이 없으면 건드리지 않는다.
    it('끈 적이 없는 남의 등록은 건드리지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      localStorage.removeItem('prism.push.disable_pending');
      renderProvider({ sessions: [{ ...current, pushRegistered: true }] });
      returnToTab();

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(api.unregisterPush).not.toHaveBeenCalled();
    });

    // 다른 탭의 켜기가 "켜짐"을 남겨 이 되살리기가 붙였는데 그쪽 요청이 실패하면, 그 탭이 선택을
    // 되돌리고 이 탭이 방금 붙인 것을 뗀다 — 되살리기의 성공도 뜻을 매듭짓고 선택을 다시 남긴다.
    it('되살리기가 붙이면 뜻을 매듭짓고 선택을 다시 남긴다', async () => {
      // 다른 탭(A)의 켜기가 "켜짐"을 남겨 이 되살리기를 불렀다 — A의 뜻이 마지막이다.
      localStorage.setItem('prism.push.intent', 'on:a-tab');
      renderProvider();

      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(localStorage.getItem('prism.push.intent')).not.toBe('on:a-tab'),
      );
      expect(rememberPushWanted).toHaveBeenCalledWith(true);
    });

    // 붙이는 사이 **같은 방향**(켜기)의 새 뜻이 섰다 — 그 켜기가 먼저 실패해 선택을 되돌렸을
    // 수 있다. 둘 다 켜자는 뜻이므로 다시 남긴다.
    it('붙이는 사이 새 켜기가 섰어도 선택을 다시 남긴다', async () => {
      localStorage.setItem('prism.push.intent', 'on:a-tab');
      let release: () => void = () => {};
      vi.mocked(api.registerPush).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ registered: true });
          }),
      );
      renderProvider();
      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));

      // 다른 탭의 켜기가 뒤에 서고 먼저 실패해 선택을 되돌렸다(모의 선택이라 표식만 남는다).
      localStorage.setItem('prism.push.intent', 'on:newer');
      await act(async () => {
        release();
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(localStorage.getItem('prism.push.intent')).not.toBe('on:newer'),
      );
      expect(rememberPushWanted).toHaveBeenCalledWith(true);
    });

    // 붙이는 사이 **반대 방향**(끄기)의 새 뜻이 섰으면 그쪽이 더 최근이다 — 매듭은 짓되 선택을
    // 다시 남기지는 않는다.
    it('붙이는 사이 새 끄기가 섰으면 선택을 다시 남기지 않는다', async () => {
      localStorage.setItem('prism.push.intent', 'on:a-tab');
      let release: () => void = () => {};
      vi.mocked(api.registerPush).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ registered: true });
          }),
      );
      renderProvider();
      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));

      localStorage.setItem('prism.push.intent', 'off:newer');
      await act(async () => {
        release();
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(localStorage.getItem('prism.push.intent')).not.toBe('off:newer'),
      );
      expect(rememberPushWanted).not.toHaveBeenCalled();
    });

    // 로그인 직후가 붙일 순간이다 — 목록을 기다리면 그만큼 늦게 붙는다.
    it('목록이 아직 없어도 붙인다', async () => {
      renderProvider({ sessions: null });

      await waitFor(() =>
        expect(api.registerPush).toHaveBeenCalledWith('fcm-tok-1'),
      );
    });

    it('꺼 뒀으면 아무것도 하지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);

      renderProvider();

      await waitFor(() =>
        expect(requestPermissionAndToken).not.toHaveBeenCalled(),
      );
      expect(api.registerPush).not.toHaveBeenCalled();
    });

    // 권한이 없으면 부르지 않는다 — 부르면 진입만으로 권한 창이 뜬다.
    it('권한이 없으면 묻지 않는다', async () => {
      vi.mocked(currentPermission).mockReturnValue('default');

      renderProvider();

      await waitFor(() =>
        expect(requestPermissionAndToken).not.toHaveBeenCalled(),
      );
    });

    it('로그인해 있지 않으면 붙이지 않는다', async () => {
      renderProvider({ authenticated: false });

      await waitFor(() =>
        expect(requestPermissionAndToken).not.toHaveBeenCalled(),
      );
    });

    // 이 등록은 목록 조회와 나란히 출발해 거의 항상 늦게 끝난다. 다시 받지 않으면 화면이
    // 쥔 목록에 `pushRegistered: false`가 남아, 켜 둔 기기가 자기 화면에서도 남의 목록에서도
    // **꺼진 것처럼** 보인다 — 실제로 iOS에서 그렇게 보였다.
    it('붙인 뒤 목록을 다시 받고 다른 기기에도 알린다', async () => {
      const { sent, refreshed } = renderProvider();

      await waitFor(() => expect(refreshed).toEqual([true]));
      expect(sent).toContainEqual({ type: 'sessionsStale' });
    });

    // 서버는 그사이 세션이 사라졌으면 **던지지 않고** `registered: false`를 돌려준다.
    // 던지지 않았다고 붙은 것이 아니다 — 거기서 알리면 안 일어난 일을 알리는 셈이다.
    it('서버가 붙이지 못했다고 답하면 알리지 않는다', async () => {
      vi.mocked(api.registerPush).mockResolvedValue({ registered: false });

      const { sent, refreshed } = renderProvider();

      await waitFor(() => expect(api.registerPush).toHaveBeenCalled());
      expect(refreshed).toEqual([]);
      expect(sent).toEqual([]);
    });

    it('등록에 실패하면 알리지 않는다', async () => {
      vi.mocked(api.registerPush).mockRejectedValue(new Error('offline'));

      const { sent, refreshed } = renderProvider();

      await waitFor(() => expect(api.registerPush).toHaveBeenCalled());
      expect(refreshed).toEqual([]);
      expect(sent).toEqual([]);
    });

    // 같은 토큰을 매번 다시 붙이면 탭을 오갈 때마다 왕복이 하나씩 붙는다 — 붙인 토큰을
    // 기억해 두고 값이 같으면 아무것도 하지 않는다.
    it('탭으로 돌아와도 토큰이 같으면 다시 붙이지 않는다', async () => {
      const { setSessions } = renderProvider();
      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));
      setSessions([{ ...current, pushRegistered: true }]);
      const asked = vi.mocked(requestPermissionAndToken).mock.calls.length;

      returnToTab();

      // 토큰은 다시 물었지만(FCM이 돌렸을 수 있다) 값이 같아 서버에는 가지 않는다.
      await waitFor(() =>
        expect(vi.mocked(requestPermissionAndToken).mock.calls.length).toBeGreaterThan(
          asked,
        ),
      );
      expect(api.registerPush).toHaveBeenCalledTimes(1);
    });

    // FCM은 토큰을 돌린다(재설치·주기적 갱신). 세션에 남은 옛 값으로는 알림이 오지
    // 않는데, 목록은 여전히 `Will notify`를 그린다 — 돌아온 값을 다시 붙여야 한다.
    it('토큰이 바뀌었으면 새 값을 다시 붙인다', async () => {
      const { setSessions } = renderProvider();
      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));
      setSessions([{ ...current, pushRegistered: true }]);
      vi.mocked(requestPermissionAndToken).mockResolvedValue('fcm-tok-2');

      returnToTab();

      await waitFor(() =>
        expect(api.registerPush).toHaveBeenCalledWith('fcm-tok-2'),
      );
    });

    // 워커가 구독 변경을 알려 오면 FCM에서 지금 값을 받아 붙인다.
    it('워커의 구독 변경 신호에 다시 붙인다', async () => {
      const listeners: Array<(event: MessageEvent) => void> = [];
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          addEventListener: (_type: string, fn: (event: MessageEvent) => void) =>
            listeners.push(fn),
          removeEventListener: () => {},
        },
      });
      try {
        const { setSessions } = renderProvider();
        await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));
        setSessions([{ ...current, pushRegistered: true }]);
        vi.mocked(requestPermissionAndToken).mockResolvedValue('fcm-tok-3');

        act(() => {
          for (const fn of listeners) {
            fn(
              new MessageEvent('message', {
                data: { type: 'prism.push.subscriptionchange' },
              }),
            );
          }
        });

        await waitFor(() =>
          expect(api.registerPush).toHaveBeenCalledWith('fcm-tok-3'),
        );
      } finally {
        Object.defineProperty(navigator, 'serviceWorker', {
          configurable: true,
          value: undefined,
        });
      }
    });
  });

  // 선택은 브라우저에 하나이고 탭은 여럿이다 — 각 탭의 줄은 따로 선다.
  describe('다른 탭과 함께', () => {
    it('토큰을 받는 사이 다른 탭이 껐으면 붙이지 않는다', async () => {
      vi.mocked(requestPermissionAndToken).mockImplementation(async () => {
        // 토큰을 받는 동안 다른 탭이 끈다.
        vi.mocked(pushWanted).mockReturnValue(false);
        return 'fcm-tok-1';
      });

      renderProvider();

      await waitFor(() => expect(requestPermissionAndToken).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(api.registerPush).not.toHaveBeenCalled();
    });

    // 이 탭이 붙인 뒤 다른 탭이 껐다 — 그 탭의 떼기와 이 탭의 붙이기가 엇갈렸을 수 있다.
    // 끈 사실을 듣고 이 탭이 붙인 등록을 뗀다.
    it('다른 탭이 끄면 이 탭이 붙인 등록을 뗀다', async () => {
      const { setSessions } = renderProvider();
      await waitFor(() => expect(api.registerPush).toHaveBeenCalledTimes(1));
      setSessions([{ ...current, pushRegistered: true }]);
      // 되살리기의 성공이 선택을 다시 남긴 것(켜짐)은 여기의 관심사가 아니다 — 지운 뒤 본다.
      vi.mocked(rememberPushWanted).mockClear();
      vi.mocked(pushWanted).mockReturnValue(false);

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'prism.push.enabled', newValue: '0' }),
        );
      });

      await waitFor(() => expect(api.unregisterPush).toHaveBeenCalled());
      // 선택은 다른 탭이 이미 바꿨다 — 여기서 다시 쓰지 않는다.
      expect(rememberPushWanted).not.toHaveBeenCalled();
    });

    // 이 탭이 붙이지 않은 등록은 이 탭의 것이 아니다 — 건드리지 않는다.
    it('이 탭이 붙이지 않은 등록은 다른 탭이 꺼도 떼지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      renderProvider({ sessions: [{ ...current, pushRegistered: true }] });

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'prism.push.enabled', newValue: '0' }),
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(api.unregisterPush).not.toHaveBeenCalled();
    });
  });

  // 앞 사람의 세션이 확인되지 않은 채 로그인 화면이 떴고 거기서 다른 계정으로 들어왔다 —
  // 앞 세션은 서버에 살아 있고 그 토큰은 이 브라우저를 가리킨다. 토큰을 돌려 죽은 값으로
  // 만들고, 새 값을 붙인다.
  describe('사용자가 바뀌었을 때', () => {
    it('주인을 먼저 맞춘 뒤 붙인다', async () => {
      const order: string[] = [];
      vi.mocked(ensureOwner).mockImplementation(async () => {
        order.push('owner');
        return true;
      });
      vi.mocked(api.registerPush).mockImplementation(async () => {
        order.push('register');
        return { registered: true };
      });

      renderProvider();

      await waitFor(() => expect(api.registerPush).toHaveBeenCalled());
      expect(order).toEqual(['owner', 'register']);
      expect(ensureOwner).toHaveBeenCalledWith('u-1');
    });
  });

  describe('권한이 사라졌을 때', () => {
    // 권한을 꺼도 세션 레코드의 토큰은 남아 `pushRegistered`가 true다 — 남의 로비는
    // 울리지 않을 기기를 `Will notify`로 그린다. 받을 수 없다는 것을 아는 쪽은 이 기기뿐이다.
    it('등록돼 있으면 떼어 내고 다른 기기에도 알린다', async () => {
      const { sent } = renderProvider({
        sessions: [{ ...current, pushRegistered: true }],
      });
      await waitFor(() => expect(api.registerPush).toHaveBeenCalled());
      vi.mocked(currentPermission).mockReturnValue('denied');

      returnToTab();

      await waitFor(() => expect(api.unregisterPush).toHaveBeenCalled());
      expect(sent).toContainEqual({ type: 'sessionsStale' });
    });

    // 사람이 끈 것이 아니라 받을 수 없게 된 것이다 — 권한이 돌아오면 그대로 살아나야 한다.
    it('기기에 남긴 선택은 건드리지 않는다', async () => {
      renderProvider({ sessions: [{ ...current, pushRegistered: true }] });
      vi.mocked(currentPermission).mockReturnValue('denied');

      returnToTab();

      await waitFor(() => expect(api.unregisterPush).toHaveBeenCalled());
      expect(rememberPushWanted).not.toHaveBeenCalled();
    });

    it('등록돼 있지 않으면 아무것도 하지 않는다', async () => {
      vi.mocked(currentPermission).mockReturnValue('denied');

      renderProvider();
      returnToTab();

      await waitFor(() =>
        expect(requestPermissionAndToken).not.toHaveBeenCalled(),
      );
      expect(api.unregisterPush).not.toHaveBeenCalled();
    });
  });

  describe('켜기와 끄기', () => {
    it('켜면 권한을 묻고 붙인 뒤 선택을 기억한다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      vi.mocked(currentPermission).mockReturnValue('default');
      const { sent } = renderProvider();
      await waitFor(() => expect(handle).not.toBeNull());

      await act(() => handle!.enable());

      expect(api.registerPush).toHaveBeenCalledWith('fcm-tok-1');
      expect(rememberPushWanted).toHaveBeenCalledWith(true);
      expect(sent).toContainEqual({ type: 'sessionsStale' });
    });

    // 서버가 붙이지 못했다고 답하면 성공이 아니다 — 선택을 기억하면 다음 로그인마다
    // 안 붙는 등록을 되풀이한다.
    it('서버가 붙이지 못했다고 답하면 선택을 기억하지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      vi.mocked(api.registerPush).mockResolvedValue({ registered: false });
      renderProvider();
      await waitFor(() => expect(handle).not.toBeNull());

      await act(() => handle!.enable());

      // 선택은 붙이기 전에 남겼다가 붙이지 못하면 되돌린다 — **켜진 채로 남지 않는다.**
      expect(vi.mocked(rememberPushWanted).mock.calls.at(-1)).toEqual([false]);
    });

    // 던진 실패도 실패다 — 되돌리지 않으면 선택만 켜진 채 남아 다음 로그인에 조용히 켜진다.
    it('붙이기가 던져도 선택은 켜진 채로 남지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      vi.mocked(api.registerPush).mockRejectedValue(new Error('offline'));
      renderProvider();
      await waitFor(() => expect(handle).not.toBeNull());

      await act(() => handle!.enable());

      expect(vi.mocked(rememberPushWanted).mock.calls.at(-1)).toEqual([false]);
    });

    it('떼기가 던져도 선택은 꺼진 채로 남지 않는다', async () => {
      vi.mocked(api.unregisterPush).mockRejectedValue(new Error('offline'));
      renderProvider({ sessions: [{ ...current, pushRegistered: true }] });
      await waitFor(() => expect(handle).not.toBeNull());

      await act(() => handle!.disable());

      expect(vi.mocked(rememberPushWanted).mock.calls.at(-1)).toEqual([true]);
    });

    it('끄면 떼어 내고 선택을 지운다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      const { sent } = renderProvider({
        sessions: [{ ...current, pushRegistered: true }],
      });
      await waitFor(() => expect(handle).not.toBeNull());

      await act(() => handle!.disable());

      expect(api.unregisterPush).toHaveBeenCalled();
      expect(rememberPushWanted).toHaveBeenCalledWith(false);
      expect(sent).toContainEqual({ type: 'sessionsStale' });
    });

    // 줄을 서는 동안 사용자가 바뀌었다 — 앞 세션의 끄기가 다음 사람의 자격증명으로
    // 나가면 다음 사람의 등록을 뗀다. 시작조차 하지 않는다.
    it('줄을 서는 동안 사용자가 바뀌면 앞 사람의 끄기는 나가지 않는다', async () => {
      let finishRegister = () => {};
      vi.mocked(api.registerPush).mockReturnValue(
        new Promise((resolve) => {
          finishRegister = () => resolve({ registered: true });
        }),
      );
      const { setUser } = renderProvider();
      await waitFor(() => expect(api.registerPush).toHaveBeenCalled());

      const disabled = handle!.disable();
      setUser({ ...user, id: 'u-2' });
      finishRegister();
      await act(() => disabled);

      expect(api.unregisterPush).not.toHaveBeenCalled();
    });

    // 되살리기와 화면의 끄기가 각자 출발하면 늦게 끝난 쪽이 먼저 끝난 쪽을 덮는다 —
    // "끄기" 뒤에 옛 등록이 끝나 토큰이 되살아나는 식이다. **한 줄로 선다.**
    it('되살리기가 진행 중이면 끄기는 그 뒤에 온다', async () => {
      let finishRegister = () => {};
      vi.mocked(api.registerPush).mockReturnValue(
        new Promise((resolve) => {
          finishRegister = () => resolve({ registered: true });
        }),
      );
      const order: string[] = [];
      vi.mocked(api.unregisterPush).mockImplementation(async () => {
        order.push('unregister');
        return { registered: false };
      });
      renderProvider();
      await waitFor(() => expect(api.registerPush).toHaveBeenCalled());

      const disabled = handle!.disable();
      order.push('register-finished');
      finishRegister();
      await act(() => disabled);

      expect(order).toEqual(['register-finished', 'unregister']);
    });
  });
});
