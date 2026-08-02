import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { AuthContext, type AuthContextValue } from '../lib/auth-context';
import { I18nContext } from '../lib/i18n/i18n-context';
import { englishI18n } from '../lib/i18n/test-i18n';
import type { User } from '../lib/contracts.gen';

const user: User = {
  id: 'u-1',
  provider: 'google',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderDashboard(signOut: () => Promise<boolean>) {
  const auth: AuthContextValue = {
    state: { status: 'authenticated', user },
    signIn: vi.fn(),
    refresh: vi.fn(async () => true),
    signOut,
  };
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <I18nContext.Provider value={englishI18n()}>
        <AuthContext.Provider value={auth}>
          <DashboardPage />
        </AuthContext.Provider>
      </I18nContext.Provider>
    </MemoryRouter>,
  );
}

const logoutButton = () =>
  screen.getByRole<HTMLButtonElement>('button', {
    name: /Log out|Logging out/,
  });

describe('DashboardPage', () => {
  afterEach(cleanup);

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

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toContain(
      'still signed in',
    );
    expect(logoutButton().disabled).toBe(false); // 다시 시도할 수 있다
  });

  it('로그아웃이 성공하면 오류를 띄우지 않는다', async () => {
    const signOut = vi.fn(async () => true);
    renderDashboard(signOut);
    fireEvent.click(logoutButton());

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
