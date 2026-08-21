import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { AuthContext, type AuthContextValue } from '../lib/auth-context';
import { I18nContext } from '../lib/i18n/i18n-context';
import { englishI18n } from '../lib/i18n/test-i18n';
import { ThemeContext } from '../lib/theme/theme-context';
import { lightTheme } from '../lib/theme/test-theme';
import type { SessionListItem, User } from '../lib/contracts.gen';

// 대시보드는 마운트 시 세션을 불러오고 revoke/sign-out-all을 호출한다 — 네트워크 대신
// 계약 형태의 값을 돌려주는 가짜 api로 대체한다(테스트가 서버에 의존하지 않게).
vi.mock('../lib/api', () => ({
  api: {
    sessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeAllSessions: vi.fn(),
  },
}));
import { api } from '../lib/api';

const user: User = {
  id: 'u-1',
  provider: 'google',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const currentSession: SessionListItem = {
  id: 'sess-current-1',
  startedAt: '2026-01-01T09:00:00.000Z',
  expiresAt: '2026-01-01T17:00:00.000Z',
  isCurrent: true,
  device: 'desktop',
};
const otherSession: SessionListItem = {
  id: 'sess-other-2',
  startedAt: '2026-01-02T09:00:00.000Z',
  expiresAt: '2026-01-03T09:00:00.000Z',
  isCurrent: false,
  device: 'phone',
};

function renderDashboard(
  signOut: () => Promise<boolean> = async () => true,
): void {
  const auth: AuthContextValue = {
    state: { status: 'authenticated', user },
    signIn: vi.fn(),
    refresh: vi.fn(async () => true),
    signOut,
  };
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <I18nContext.Provider value={englishI18n()}>
        <ThemeContext.Provider value={lightTheme()}>
          <AuthContext.Provider value={auth}>
            <DashboardPage />
          </AuthContext.Provider>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    </MemoryRouter>,
  );
}

const logoutButton = () =>
  screen.getByRole<HTMLButtonElement>('button', {
    name: /Log out|Logging out/,
  });

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.mocked(api.sessions).mockResolvedValue([currentSession, otherSession]);
    vi.mocked(api.revokeSession).mockResolvedValue(undefined);
    vi.mocked(api.revokeAllSessions).mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── 로그아웃(상단 바) ──

  it('로그아웃 중에는 버튼이 잠긴다(중복 요청 방지)', () => {
    renderDashboard(() => new Promise<boolean>(() => undefined)); // 응답 없음
    fireEvent.click(logoutButton());

    expect(logoutButton().textContent).toContain('Logging out');
    expect(logoutButton().disabled).toBe(true);
  });

  // 회귀 방지: 쿠키를 못 지웠으면 세션이 살아 있다 — 조용히 성공처럼 넘어가면 안 된다.
  it('로그아웃이 실패하면 세션이 남아 있음을 알리고 재시도할 수 있다', async () => {
    renderDashboard(async () => false);
    fireEvent.click(logoutButton());

    await waitFor(() =>
      expect(screen.getByText(/still signed in/)).toBeDefined(),
    );
    expect(logoutButton().disabled).toBe(false); // 다시 시도할 수 있다
  });

  it('로그아웃이 성공하면 오류를 띄우지 않는다', async () => {
    const signOut = vi.fn(async () => true);
    renderDashboard(signOut);
    fireEvent.click(logoutButton());

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(screen.queryByText(/still signed in/)).toBeNull();
  });

  // ── 활성 세션 ──

  it('세션 종류를 라벨로 보여준다', async () => {
    renderDashboard();

    // 기기명·위치는 저장하지 않으므로(§5) 표시는 종류 하나로 끝난다.
    expect(await screen.findByText('Desktop')).toBeTruthy();
    expect(screen.getByText('Phone')).toBeTruthy();
  });

  it('세션 목록을 불러와 현재/다른 세션을 구분해 보여준다', async () => {
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/This session/)).toBeDefined());
    expect(screen.getByText('Current')).toBeDefined();
    expect(screen.getByText(/Signed-in session/)).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
    // Revoke는 현재 세션이 아닌 행에만 있다(현재 세션은 상단 바 Log out으로 끊는다).
    expect(
      screen.getAllByRole('button', { name: 'Revoke' }),
    ).toHaveLength(1);
  });

  it('세션을 Revoke하면 목록에서 사라진다', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/Signed-in session/)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() =>
      expect(vi.mocked(api.revokeSession)).toHaveBeenCalledWith('sess-other-2'),
    );
    await waitFor(() =>
      expect(screen.queryByText(/Signed-in session/)).toBeNull(),
    );
  });

  it('세션을 못 불러오면 오류와 재시도를 보여준다', async () => {
    vi.mocked(api.sessions).mockRejectedValueOnce(new Error('network'));
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(/load your sessions/)).toBeDefined(),
    );
    // 재시도하면 다시 불러온다.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText(/This session/)).toBeDefined());
  });

  // ── 모바일 네비 드로어 ──
  // 모바일에선 사이드바가 숨겨져 기능 이동 수단이 없었다 — 햄버거로 여는 드로어를 추가했다.

  it('햄버거로 네비 드로어를 열고 Esc로 닫는다', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/This session/)).toBeDefined());

    const menu = screen.getByRole('button', { name: 'Open menu' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.scrim')).toBeNull();

    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.scrim')).not.toBeNull();
    expect(document.querySelector('.sidebar')?.className).toContain(
      'sidebar--open',
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.scrim')).toBeNull();
  });

  it('스크림을 누르면 드로어가 닫힌다', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/This session/)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const scrim = document.querySelector('.scrim');
    expect(scrim).not.toBeNull();

    fireEvent.click(scrim as HTMLElement);
    expect(
      screen.getByRole('button', { name: 'Open menu' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
});
