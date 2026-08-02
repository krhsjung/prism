import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthCallbackPage } from '../pages/AuthCallbackPage';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './auth-context';
import type { User } from './contracts.gen';

// api를 mock해 /auth/me 응답 타이밍을 테스트가 제어한다.
vi.mock('./api', () => ({
  api: { me: vi.fn(), logout: vi.fn(async () => undefined) },
}));
import { api } from './api';

const user: User = {
  id: 'u-1',
  provider: 'demo',
  displayName: 'Demo User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

// 응답 시점을 수동 제어하는 deferred.
const deferredMe = () => {
  let resolve: (u: User) => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  vi.mocked(api.me).mockImplementationOnce(
    () =>
      new Promise<User>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return { resolve: (u: User) => resolve(u), reject: (e: Error) => reject(e) };
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
      stale.resolve(user); // 늦은 성공 응답
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
    vi.mocked(api.me).mockResolvedValue(user);
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
      initial.resolve(user);
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: 'authenticated', user });
  });

  it('자식 effect의 refresh가 초기 확인과 중복 요청을 만들지 않는다', async () => {
    vi.mocked(api.me).mockResolvedValue(user);

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
    vi.mocked(api.me).mockResolvedValue(user);

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/auth/callback']}>
          <AuthProvider>
            <Routes>
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/dashboard" element={<output>dashboard</output>} />
              <Route path="/login" element={<output>login</output>} />
            </Routes>
          </AuthProvider>
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
        <AuthProvider>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/dashboard" element={<output>dashboard</output>} />
            <Route path="/login" element={<output>login</output>} />
          </Routes>
        </AuthProvider>
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
