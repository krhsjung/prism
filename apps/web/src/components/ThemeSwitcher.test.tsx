import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeSwitcher } from './ThemeSwitcher';
import { I18nContext } from '../lib/i18n/i18n-context';
import { englishI18n } from '../lib/i18n/test-i18n';
import { ThemeContext, type ThemeContextValue } from '../lib/theme/theme-context';
import { lightTheme } from '../lib/theme/test-theme';

function renderSwitcher(theme: Partial<ThemeContextValue> = {}) {
  const setTheme = vi.fn();
  const value: ThemeContextValue = { ...lightTheme(), setTheme, ...theme };
  render(
    <I18nContext.Provider value={englishI18n()}>
      <ThemeContext.Provider value={value}>
        <ThemeSwitcher />
      </ThemeContext.Provider>
    </I18nContext.Provider>,
  );
  return setTheme;
}

const trigger = () => screen.getByRole('button', { name: /Theme/ });
const options = () => screen.queryAllByRole('menuitemradio');

afterEach(cleanup);

describe('ThemeSwitcher', () => {
  // 'system'일 때 지금 칠해진 색(라이트)을 보여주면 무엇을 골랐는지 알 수 없게 된다.
  it('닫혀 있을 때는 고른 값을 보여준다(칠해진 값이 아니라)', () => {
    renderSwitcher({ theme: 'system', resolved: 'light' });
    expect(trigger().textContent).toContain('System');
    expect(options()).toHaveLength(0);
  });

  it('열면 세 선택지가 나오고 고른 값에 표시가 붙는다', () => {
    renderSwitcher({ theme: 'dark', resolved: 'dark' });
    fireEvent.click(trigger());

    expect(options().map((o) => o.textContent)).toEqual(['System', 'Light', 'Dark']);
    const checked = options().filter((o) => o.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toBe('Dark');
  });

  it('항목을 고르면 테마를 바꾸고 메뉴를 닫는다', () => {
    const setTheme = renderSwitcher();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));

    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(options()).toHaveLength(0);
  });

  it('기기 설정으로 되돌리는 길이 있다', () => {
    const setTheme = renderSwitcher({ theme: 'dark', resolved: 'dark' });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'System' }));

    expect(setTheme).toHaveBeenCalledWith('system');
  });
});
