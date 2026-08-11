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
  api: {
    me: vi.fn(),
    logout: vi.fn(async () => undefined),
    refreshSession: vi.fn(async () => ({ ok: true, ttlMs: 15 * 60 * 1000 })),
  },
}));
import { api } from './api';

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
    act(() => result.current.signIn(user, ACCESS_TTL_MS));
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
describe('AuthProvider 선제 갱신', () => {
  const LEAD_MS = ACCESS_TTL_MS * 0.75; // REFRESH_LEAD_RATIO

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.mocked(api.me).mockResolvedValue(sessionUser);
    vi.mocked(api.logout).mockResolvedValue(undefined);
    vi.mocked(api.refreshSession).mockResolvedValue({
      ok: true,
      ttlMs: ACCESS_TTL_MS,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('수명의 75% 지점에 세션을 회전하고 다시 예약한다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('authenticated');
    expect(vi.mocked(api.refreshSession)).not.toHaveBeenCalled();

    // 75% 지점: 첫 회전.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAD_MS);
    });
    expect(vi.mocked(api.refreshSession)).toHaveBeenCalledTimes(1);

    // 회전이 성공하면 새 수명으로 다시 예약된다 — 다음 주기에 또 회전.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAD_MS);
    });
    expect(vi.mocked(api.refreshSession)).toHaveBeenCalledTimes(2);
  });

  it('데모 로그인(signIn) 직후부터 회전이 예약된다', async () => {
    // 초기 me는 매달아 두고, signIn으로 곧장 인증시킨다.
    let hang = false;
    vi.mocked(api.me).mockImplementation(
      () =>
        new Promise(() => {
          hang = true;
        }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.signIn(user, ACCESS_TTL_MS));
    expect(result.current.state.status).toBe('authenticated');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAD_MS);
    });
    expect(vi.mocked(api.refreshSession)).toHaveBeenCalledTimes(1);
    expect(hang).toBe(true); // me는 여전히 매달린 채 — 회전은 signIn이 건 예약이다
  });

  it('선제 회전이 실패하면 재검증(me)으로 세션을 확인한다', async () => {
    vi.mocked(api.refreshSession).mockResolvedValue({ ok: false, ttlMs: null });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('authenticated');

    // 다음 me(재검증)는 세션이 사라진 것으로 응답한다.
    vi.mocked(api.me).mockRejectedValueOnce(new Error('gone'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAD_MS);
    });
    expect(vi.mocked(api.refreshSession)).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('anonymous');
  });

  it('탭 복귀 시 직전 회전이 오래됐으면 즉시 회전한다', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('authenticated');

    // 예약 회전(75%)에는 못 미치지만 wake 창(60초)은 넘는 시간만 흐른다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(vi.mocked(api.refreshSession)).not.toHaveBeenCalled();

    // 탭이 다시 보이면 즉시 회전한다(백그라운드 타이머 억제·절전 복귀 보정).
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(vi.mocked(api.refreshSession)).toHaveBeenCalledTimes(1);
  });
});
