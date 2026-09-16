import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { SessionsProvider } from './SessionsProvider';
import { useSessions } from './sessions-context';
import { AuthContext, type AuthContextValue } from './auth-context';
import {
  SessionSocketContext,
  type SessionSocketValue,
} from './session-socket-context';
import type { SessionListItem, User } from './contracts.gen';

// api는 **완전한 가짜 한 벌**로 대체한다(lib/test-api.ts). 일부만 채우면 화면이 나중에
// 쓰기 시작한 메서드가 조용히 `undefined`가 되고, 그 호출은 대부분 `try` 안이라
// TypeError가 catch로 들어가 "네트워크 실패"와 구별되지 않는다.
vi.mock('./api', async () => ({ api: (await import('./test-api')).fakeApi() }));
import { api } from './api';

const user: User = {
  id: 'u-1',
  displayName: 'Demo',
  provider: 'demo',
  createdAt: '2026-09-14T00:00:00.000Z',
};
const other: User = { ...user, id: 'u-2' };

const session = (id: string): SessionListItem => ({
  id,
  device: 'iphone',
  startedAt: '2026-09-14T00:00:00.000Z',
  expiresAt: '2026-09-21T00:00:00.000Z',
  isCurrent: id === 'sess-1',
  isConnected: false,
  pushRegistered: false,
});

// 목록을 쓰는 화면 대신 세워 두는 최소 소비자 — 이 Provider가 화면들에 무엇을 주는지만
// 본다(화면의 그리기는 각 화면의 테스트가 본다).
function Probe() {
  const { sessions, loadFailed } = useSessions();
  return (
    <>
      <p data-testid="state">
        {loadFailed ? 'failed' : sessions === null ? 'loading' : 'loaded'}
      </p>
      <ul>
        {sessions?.map((s) => (
          <li key={s.id}>{s.id}</li>
        ))}
      </ul>
    </>
  );
}

const socketValue = (changed: number): SessionSocketValue => ({
  ready: true,
  changed,
  send: () => false,
  subscribeCall: () => () => {},
});

function authValue(current: User | null): AuthContextValue {
  return {
    state: current
      ? { status: 'authenticated', user: current }
      : { status: 'anonymous' },
    endedUnexpectedly: false,
    signIn: vi.fn(),
    refresh: vi.fn(async () => true),
    signOut: vi.fn(async () => true),
  };
}

function tree(current: User | null, changed: number, children: ReactNode) {
  return (
    <AuthContext.Provider value={authValue(current)}>
      <SessionSocketContext.Provider value={socketValue(changed)}>
        <SessionsProvider>{children}</SessionsProvider>
      </SessionSocketContext.Provider>
    </AuthContext.Provider>
  );
}

describe('SessionsProvider', () => {
  beforeEach(() => {
    vi.mocked(api.sessions).mockResolvedValue([session('sess-1')]);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('로그인해 있으면 목록을 한 번 가져온다', async () => {
    render(tree(user, 0, <Probe />));
    await screen.findByText('sess-1');
    expect(api.sessions).toHaveBeenCalledTimes(1);
    // 화면에 들어온 것은 사용자의 동작이다 — 첫 조회는 활동으로 센다.
    expect(api.sessions).toHaveBeenCalledWith(false);
  });

  it('로그인하지 않았으면 묻지 않는다', async () => {
    render(tree(null, 0, <Probe />));
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('loading'),
    );
    expect(api.sessions).not.toHaveBeenCalled();
  });

  // 이것이 이 Provider가 있는 이유다 — 신호를 듣는 자리가 하나뿐이라, 목록을 보는
  // **모든** 화면이 같은 순간에 같은 목록을 본다.
  it('소켓 신호가 오면 배경으로 다시 가져온다', async () => {
    const { rerender } = render(tree(user, 0, <Probe />));
    await screen.findByText('sess-1');

    vi.mocked(api.sessions).mockResolvedValue([session('sess-1'), session('sess-2')]);
    rerender(tree(user, 1, <Probe />));

    await screen.findByText('sess-2');
    // 소켓이 시킨 재조회는 **활동이 아니다**(plan/auth.md §6).
    expect(api.sessions).toHaveBeenLastCalledWith(true);
  });

  it('이미 지나간 신호 번호로는 다시 가져오지 않는다', async () => {
    const { rerender } = render(tree(user, 3, <Probe />));
    await screen.findByText('sess-1');
    rerender(tree(user, 3, <Probe />));
    await waitFor(() => expect(api.sessions).toHaveBeenCalledTimes(1));
  });

  // 조회는 겹칠 수 있고 응답은 출발 순서대로 오지 않는다 — 옛 응답이 늦게 와서 새 응답을
  // 덮으면 방금 켠 등록이 화면에서 꺼진 것으로 보인다. 가장 늦게 출발한 조회만 쓴다.
  it('늦게 도착한 옛 응답이 새 응답을 덮지 않는다', async () => {
    let releaseFirst = () => {};
    vi.mocked(api.sessions)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = () => resolve([session('sess-1')]);
        }),
      )
      .mockResolvedValueOnce([session('sess-1'), session('sess-2')]);
    let refresh: (background?: boolean) => Promise<void> = async () => {};
    // 렌더 중에 바깥 변수를 쓰지 않는다 — 효과에서 넘긴다(react-hooks 규칙).
    function Grab({ onReady }: { onReady: (r: typeof refresh) => void }) {
      const value = useSessions().refresh;
      useEffect(() => {
        onReady(value);
      }, [value, onReady]);
      return null;
    }
    render(
      tree(user, 0, (
        <>
          <Probe />
          <Grab
            onReady={(r) => {
              refresh = r;
            }}
          />
        </>
      )),
    );
    await waitFor(() => expect(api.sessions).toHaveBeenCalledTimes(1));

    const second = refresh(true);
    await waitFor(() => expect(api.sessions).toHaveBeenCalledTimes(2));
    await second;
    expect(screen.getByText('sess-2')).toBeTruthy();

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByText('sess-2')).toBeTruthy();
  });

  it('못 가져오면 있던 목록을 지우지 않고 실패만 말한다', async () => {
    const { rerender } = render(tree(user, 0, <Probe />));
    await screen.findByText('sess-1');

    vi.mocked(api.sessions).mockRejectedValue(new Error('offline'));
    rerender(tree(user, 1, <Probe />));

    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('failed'),
    );
    // 재시도할 대상이 화면에서 사라지지 않는다.
    expect(screen.getByText('sess-1')).toBeTruthy();
  });

  // 앞 세션의 목록이 다음 세션의 화면에 한 프레임이라도 보이면 안 된다 — 그래서
  // 효과에서 지우지 않고 **주인을 대조해 읽는다**.
  it('다른 사용자로 바뀌면 앞 사람의 목록을 물려주지 않는다', async () => {
    const { rerender } = render(tree(user, 0, <Probe />));
    await screen.findByText('sess-1');

    let release: (list: SessionListItem[]) => void = () => {};
    vi.mocked(api.sessions).mockImplementation(
      () => new Promise<SessionListItem[]>((resolve) => (release = resolve)),
    );
    rerender(tree(other, 0, <Probe />));

    expect(screen.getByTestId('state').textContent).toBe('loading');
    expect(screen.queryByText('sess-1')).toBeNull();

    release([session('sess-9')]);
    await screen.findByText('sess-9');
  });

  it('로그아웃했다 다시 로그인하면 목록을 새로 받는다', async () => {
    const { rerender } = render(tree(user, 0, <Probe />));
    await screen.findByText('sess-1');

    rerender(tree(null, 0, <Probe />));
    rerender(tree(user, 0, <Probe />));

    await waitFor(() => expect(api.sessions).toHaveBeenCalledTimes(2));
  });
});
