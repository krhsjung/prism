import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthCallbackPage } from '../pages/AuthCallbackPage';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './auth-context';
import { I18nContext } from './i18n/i18n-context';
import { englishI18n } from './i18n/test-i18n';
import type { SessionUser, User } from './contracts.gen';

// api를 mock해 /auth/me 응답 타이밍을 테스트가 제어한다. refreshSession은 선제 갱신
// 타이머·wake가 부르지만 이 파일의 예약 지연(≥11분)은 테스트 중 발화하지 않는다 —
// 그래도 호출돼도 안전하도록 성공 결과를 돌려준다.
vi.mock('./api', () => ({
  // provider가 "확정 401인지"를 이 타입으로 가린다 — mock에도 있어야 한다.
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  },
  api: {
    me: vi.fn(),
    logout: vi.fn(async () => undefined),
    refreshSession: vi.fn(async () => ({
      ok: true,
      ttlMs: 15 * 60 * 1000,
      rejected: false,
    })),
    registerPush: vi.fn(async () => ({ registered: true })),
  },
  // 확정 401을 알리는 고리 — provider가 마운트될 때 꽂고 언마운트에서 뗀다.
  setSessionAuthority: vi.fn(),
}));
// 이 기기의 선택과 브라우저 권한 — 로그인 뒤 조용한 재등록이 이 둘을 본다(§5-16).
vi.mock('./push/registration', () => ({
  currentPermission: vi.fn(() => 'granted'),
  pushWanted: vi.fn(() => false),
  requestPermissionAndToken: vi.fn(async () => 'fcm-tok-1'),
}));
import {
  currentPermission,
  pushWanted,
  requestPermissionAndToken,
} from './push/registration';
import { api, setSessionAuthority, type SessionAuthority } from './api';

const user: User = {
  id: 'u-1',
  provider: 'demo',
  displayName: 'Demo User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// 쿠키 흐름의 /auth/me 응답 형태 — 사용자 + 액세스 토큰 수명(선제 갱신 스케줄용).
const ACCESS_TTL_MS = 15 * 60 * 1000;
const sessionUser: SessionUser = { user, accessTokenTtlMs: ACCESS_TTL_MS };

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

// 이 프로젝트의 vitest는 globals가 꺼져 있어 Testing Library 자동 cleanup이 등록되지
// 않는다 — 명시적으로 unmount하지 않으면 마운트가 테스트 간 누적되고, AuthProvider가
// document/window에 건 wake 리스너가 남아 다음 테스트의 이벤트에 함께 반응한다.
afterEach(() => {
  cleanup();
});

// 응답 시점을 수동 제어하는 deferred.
const deferredMe = () => {
  let resolve: (u: SessionUser) => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  vi.mocked(api.me).mockImplementationOnce(
    () =>
      new Promise<SessionUser>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return {
    resolve: (u: SessionUser) => resolve(u),
    reject: (e: Error) => reject(e),
  };
};

// 콜백 페이지처럼 mount effect에서 refresh를 호출하는 자식.
// (React의 mount effect는 자식→부모 순서 — 초기 확인과 겹치는 조건의 재현)
function CallbackLike() {
  const { refresh } = useAuth();
  const [label, setLabel] = useState('pending');
  useEffect(() => {
    void refresh().then((ok) => setLabel(ok ? 'adopted' : 'rejected'));
  }, [refresh]);
  return <output>{label}</output>;
}

describe('AuthProvider 경합 방어', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('세션은 서버에만 물어볼 수 있으므로 항상 loading으로 시작한다', () => {
    deferredMe();
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.state.status).toBe('loading');
  });

  it('늦게 실패한 이전 확인이 새 로그인을 덮어쓰지 않는다', async () => {
    const stale = deferredMe(); // 초기 확인이 pending 상태로 매달림

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.state.status).toBe('loading');

    // 확인이 끝나기 전에 사용자가 데모 로그인.
    act(() => result.current.signIn(user));
    expect(result.current.state.status).toBe('authenticated');

    // 이제야 도착한 이전 확인의 실패 — 새 로그인을 건드리면 안 된다.
    await act(async () => {
      stale.reject(new Error('unauthorized'));
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('authenticated');
  });

  it('로그아웃 후 도착한 이전 확인 성공이 세션을 되살리지 못한다', async () => {
    const stale = deferredMe();

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signOut();
    });
    expect(result.current.state.status).toBe('anonymous');

    await act(async () => {
      stale.resolve(sessionUser); // 늦은 성공 응답
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('anonymous');
  });

  it('로그아웃은 서버에 쿠키 삭제를 요청한다(JS가 HttpOnly 쿠키를 못 지운다)', async () => {
    deferredMe();
    const { result } = renderHook(() => useAuth(), { wrapper });
    let ok = false;
    await act(async () => {
      ok = await result.current.signOut();
    });
    expect(vi.mocked(api.logout)).toHaveBeenCalled();
    expect(ok).toBe(true);
    expect(result.current.state.status).toBe('anonymous');
  });

  // 회귀 방지: 쿠키는 서버만 지울 수 있으므로, 요청이 실패했다면 세션은 살아 있다.
  // 상태를 먼저 비우면 "로그아웃됐다"고 표시해놓고 새로고침에 되살아난다.
  it('로그아웃이 실패하면 상태를 비우지 않고 실패를 알린다', async () => {
    vi.mocked(api.me).mockResolvedValue(sessionUser);
    vi.mocked(api.logout).mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() =>
      expect(result.current.state.status).toBe('authenticated'),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.signOut();
    });

    expect(ok).toBe(false);
    expect(result.current.state.status).toBe('authenticated'); // 여전히 로그인 상태
  });

  it('정상 경로: 쿠키 세션 확인 성공 → authenticated', async () => {
    const initial = deferredMe();

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      initial.resolve(sessionUser);
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: 'authenticated', user });
  });

  it('자식 effect의 refresh가 초기 확인과 중복 요청을 만들지 않는다', async () => {
    vi.mocked(api.me).mockResolvedValue(sessionUser);

    render(
      <AuthProvider>
        <CallbackLike />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('adopted')).toBeDefined());
    // 자식이 이미 전이를 시작했으므로 부모의 초기 확인은 생략돼야 한다.
    expect(vi.mocked(api.me)).toHaveBeenCalledTimes(1);
  });

  it('StrictMode 이중 마운트에서도 콜백 페이지가 한 번만 확인하고 dashboard로 간다', async () => {
    vi.mocked(api.me).mockResolvedValue(sessionUser);

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/auth/callback']}>
          <I18nContext.Provider value={englishI18n()}>
            <AuthProvider>
              <Routes>
                <Route path="/auth/callback" element={<AuthCallbackPage />} />
                <Route path="/dashboard" element={<output>dashboard</output>} />
                <Route path="/login" element={<output>login</output>} />
              </Routes>
            </AuthProvider>
          </I18nContext.Provider>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText('dashboard')).toBeDefined());
    expect(screen.queryByText('login')).toBeNull();
    expect(vi.mocked(api.me)).toHaveBeenCalledTimes(1);
  });

  it('콜백: 세션이 무효면 로그인 화면으로 돌려보낸다', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthorized'));

    render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <I18nContext.Provider value={englishI18n()}>
          <AuthProvider>
            <Routes>
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/dashboard" element={<output>dashboard</output>} />
              <Route path="/login" element={<output>login</output>} />
            </Routes>
          </AuthProvider>
        </I18nContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('login')).toBeDefined());
  });

  it('refresh: 세션이 무효면 anonymous를 반환한다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const cb = deferredMe();

    let outcome: Promise<boolean> = Promise.resolve(true);
    act(() => {
      outcome = result.current.refresh();
    });
    await act(async () => {
      cb.reject(new Error('unauthorized'));
      await Promise.resolve();
    });
    await expect(outcome).resolves.toBe(false);
    expect(result.current.state.status).toBe('anonymous');
  });
});

// 선제 갱신: 액세스 토큰이 만료되기 전에 세션을 회전(idle 창 연장)해, 요청이 없는
// 탭도 죽지 않게 한다(plan/auth.md §6). 시간 축이 핵심이라 fake timer로 검증한다.
// 확정 401을 만나면 api가 세션의 주인에게 알린다. 그 고리가 실제로 화면까지 닿는지 —
// 그리고 **표식이 갈린 낡은 알림은 무시되는지** 본다.
describe('AuthProvider 세션 종료 알림', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.me).mockResolvedValue(sessionUser);
    vi.mocked(api.logout).mockResolvedValue(undefined);
  });

  function attachedAuthority(): SessionAuthority {
    const calls = vi.mocked(setSessionAuthority).mock.calls;
    const attached = calls.map(([a]) => a).filter(Boolean);
    return attached[attached.length - 1] as SessionAuthority;
  }

  it('세션이 끊겼다는 알림을 받으면 로그인 화면에 이유를 남긴다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.endedUnexpectedly).toBe(false);

    const authority = attachedAuthority();
    await act(async () => {
      authority.reject(authority.mark());
    });

    expect(result.current.state.status).toBe('anonymous');
    expect(result.current.endedUnexpectedly).toBe(true);
  });

  // 알림을 남겨둔 채 다시 로그인하면, 다음에 **스스로** 로그아웃했을 때도 로그인 화면이
  // "세션이 종료되었습니다"를 띄운다 — 사용자가 직접 누른 로그아웃인데.
  it('다시 로그인하면 앞 세션의 알림은 지운다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    const authority = attachedAuthority();
    await act(async () => {
      authority.reject(authority.mark());
    });
    expect(result.current.endedUnexpectedly).toBe(true);

    await act(async () => {
      result.current.signIn(user);
    });

    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.endedUnexpectedly).toBe(false);
  });

  // 로그아웃은 서버 응답을 기다린다. 그 사이 만료가 먼저 발견되면, 자기가 누른 버튼의
  // 결과가 "세션이 종료되었습니다"라는 사고 통지로 뜬다.
  it('로그아웃을 기다리는 동안 세션이 끊겨도 알리지 않는다', async () => {
    let finishLogout: (() => void) | null = null;
    vi.mocked(api.logout).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLogout = () => resolve();
        }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    const authority = attachedAuthority();

    // 로그아웃을 누르고, 응답을 기다리는 사이에 만료가 발견된다.
    const pending: Array<Promise<boolean>> = [];
    await act(async () => {
      pending.push(result.current.signOut());
      await Promise.resolve();
      authority.reject(authority.mark());
    });

    await act(async () => {
      finishLogout?.();
      await pending[0];
    });

    expect(result.current.state.status).toBe('anonymous');
    expect(result.current.endedUnexpectedly).toBe(false);
  });

  // 로그아웃이 겹쳐 눌릴 수 있다. 의도를 boolean으로 들고 있으면 **한쪽의 실패가 아직
  // 진행 중인 다른 로그아웃의 의도까지 내려** 버려, 그 틈에 안내가 뜬다.
  it('겹친 로그아웃 중 하나가 실패해도 나머지의 의도는 남는다', async () => {
    const settle: Array<{ ok: () => void; fail: () => void }> = [];
    // noUncheckedIndexedAccess가 켜져 있어 인덱스 접근이 optional이다 — 아직 시작되지
    // 않은 로그아웃을 건드리면 조용히 넘어가지 말고 여기서 터지게 한다.
    const settleAt = (index: number) => {
      const at = settle[index];
      if (!at) throw new Error(`로그아웃 ${index}번이 아직 시작되지 않았다`);
      return at;
    };
    vi.mocked(api.logout).mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          settle.push({ ok: () => resolve(), fail: () => reject(new Error('nope')) });
        }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    const authority = attachedAuthority();

    // 두 번 눌렸다.
    const pending: Array<Promise<boolean>> = [];
    await act(async () => {
      pending.push(result.current.signOut(), result.current.signOut());
      await Promise.resolve();
    });
    expect(settle).toHaveLength(2);

    // 첫 번째가 실패한다 — 두 번째는 아직 진행 중이다.
    await act(async () => {
      settleAt(0).fail();
      await pending[0];
    });

    // 그 틈에 만료가 발견된다.
    await act(async () => {
      authority.reject(authority.mark());
    });
    expect(result.current.endedUnexpectedly).toBe(false);

    await act(async () => {
      settleAt(1).ok();
      await pending[1];
    });
    expect(result.current.endedUnexpectedly).toBe(false);
  });

  it('그사이 세션이 갈렸으면 낡은 알림은 무시한다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });

    const authority = attachedAuthority();
    const stale = authority.mark();
    // 새 로그인이 앞질렀다 — 표식이 오른다.
    await act(async () => {
      result.current.signIn(user);
    });

    await act(async () => {
      authority.reject(stale);
    });

    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.endedUnexpectedly).toBe(false);
  });

  // 등록은 세션에 붙어 로그아웃과 함께 사라진다 — 그때마다 다시 누르게 하면 토글이
  // "켜 두는 것"이 아니라 "매번 켜는 것"이 된다(§5-16).
  describe('로그인 뒤 알림 재등록', () => {
    it('받기로 해 뒀으면 조용히 다시 붙인다', async () => {
      vi.mocked(pushWanted).mockReturnValue(true);
      vi.mocked(api.me).mockResolvedValue(sessionUser);

      render(<AuthProvider>{null}</AuthProvider>);

      await waitFor(() =>
        expect(api.registerPush).toHaveBeenCalledWith('fcm-tok-1'),
      );
    });

    it('꺼 뒀으면 아무것도 하지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(false);
      vi.mocked(api.me).mockResolvedValue(sessionUser);

      render(<AuthProvider>{null}</AuthProvider>);

      await waitFor(() => expect(api.me).toHaveBeenCalled());
      expect(requestPermissionAndToken).not.toHaveBeenCalled();
      expect(api.registerPush).not.toHaveBeenCalled();
    });

    // 권한이 없으면 부르지 않는다 — 부르면 진입만으로 권한 창이 뜬다.
    it('권한이 없으면 묻지 않는다', async () => {
      vi.mocked(pushWanted).mockReturnValue(true);
      vi.mocked(currentPermission).mockReturnValue('default');
      vi.mocked(api.me).mockResolvedValue(sessionUser);

      render(<AuthProvider>{null}</AuthProvider>);

      await waitFor(() => expect(api.me).toHaveBeenCalled());
      expect(requestPermissionAndToken).not.toHaveBeenCalled();
    });
  });
});
