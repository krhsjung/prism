import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from './theme-context';
import { DARK_QUERY, THEME_ATTRIBUTE, THEME_STORAGE_KEY, type Theme } from './theme';

// 기기 설정 스텁 — 값이 바뀌고 구독자에게 알릴 수 있어야 한다(OS 야간 모드 전환).
let systemIsDark = false;
const listeners = new Set<() => void>();

function stubSystem(dark: boolean) {
  systemIsDark = dark;
  listeners.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query === DARK_QUERY && systemIsDark;
      },
      addEventListener: (_: string, fn: () => void) => {
        listeners.add(fn);
      },
      removeEventListener: (_: string, fn: () => void) => {
        listeners.delete(fn);
      },
    })),
  );
}

function changeSystem(dark: boolean) {
  systemIsDark = dark;
  act(() => listeners.forEach((notify) => notify()));
}

// 지금 고른 값과 실제로 칠해진 값을 함께 드러내는 탐침.
function Probe({ next }: { next: Theme }) {
  const { theme, resolved, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme(next)}>
      {theme}/{resolved}
    </button>
  );
}

function renderProvider(next: Theme = 'light') {
  render(
    <ThemeProvider>
      <Probe next={next} />
    </ThemeProvider>,
  );
  return screen.getByRole('button');
}

const painted = () => document.documentElement.getAttribute(THEME_ATTRIBUTE);

afterEach(() => {
  cleanup();
  localStorage.clear();
  listeners.clear();
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  vi.unstubAllGlobals();
});

describe('ThemeProvider', () => {
  it('고른 적이 없으면 기기 설정을 그대로 칠한다', () => {
    stubSystem(true);
    expect(renderProvider().textContent).toBe('system/dark');
    expect(painted()).toBe('dark');
  });

  // 기기 설정은 우리 상태 밖에서 바뀐다 — 'system'인 동안에는 새로고침 없이 따라가야 한다.
  it('system이면 기기 설정 변경을 따라간다', () => {
    stubSystem(false);
    const probe = renderProvider();
    expect(painted()).toBe('light');

    changeSystem(true);
    expect(probe.textContent).toBe('system/dark');
    expect(painted()).toBe('dark');
  });

  it('고른 뒤에는 그 테마로 굳고 저장된다', () => {
    stubSystem(true);
    const probe = renderProvider('light');

    fireEvent.click(probe);
    expect(probe.textContent).toBe('light/light');
    expect(painted()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    // 기기가 라이트↔다크를 오가도 고른 값은 그대로다.
    changeSystem(false);
    changeSystem(true);
    expect(painted()).toBe('light');
  });

  it('저장된 선택이 기기 설정보다 우선한다(다음 방문)', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    stubSystem(false);

    expect(renderProvider().textContent).toBe('dark/dark');
    expect(painted()).toBe('dark');
  });

  // system을 다시 고르는 것도 선택이다 — 기기를 따르는 상태로 되돌아와야 한다.
  it('system으로 되돌리면 다시 기기 설정을 따른다', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    stubSystem(true);
    const probe = renderProvider('system');

    fireEvent.click(probe);
    expect(probe.textContent).toBe('system/dark');
    expect(painted()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('언마운트하면 기기 설정 구독을 놓는다', () => {
    stubSystem(false);
    renderProvider();
    expect(listeners.size).toBe(1);

    cleanup();
    expect(listeners.size).toBe(0);
  });
});
