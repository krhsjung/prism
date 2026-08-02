import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleSwitcher } from './LocaleSwitcher';
import { I18nContext, type I18nContextValue } from '../lib/i18n/i18n-context';
import { englishI18n } from '../lib/i18n/test-i18n';

function renderSwitcher(setLocale = vi.fn()) {
  const value: I18nContextValue = { ...englishI18n(), setLocale };
  render(
    <I18nContext.Provider value={value}>
      <LocaleSwitcher />
    </I18nContext.Provider>,
  );
  return setLocale;
}

const trigger = () => screen.getByRole('button', { name: /Language/ });
const options = () => screen.queryAllByRole('menuitemradio');

afterEach(cleanup);

describe('LocaleSwitcher', () => {
  it('닫혀 있을 때는 현재 언어만 보이고 메뉴는 없다', () => {
    renderSwitcher();
    expect(trigger().textContent).toContain('English');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(options()).toHaveLength(0);
  });

  it('열면 지원 언어가 모두 나오고 현재 언어에 표시가 붙는다', () => {
    renderSwitcher();
    fireEvent.click(trigger());

    expect(options().map((o) => o.textContent)).toEqual(['English', '한국어', '日本語']);
    const checked = options().filter((o) => o.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toBe('English');
  });

  // 키보드로 열었을 때 바로 위아래로 고를 수 있어야 한다.
  it('열리면 현재 언어에 초점이 간다', () => {
    renderSwitcher();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('English');
  });

  it('위아래 키로 항목 사이를 순환한다', () => {
    renderSwitcher();
    fireEvent.click(trigger());

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('한국어');

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('日本語'); // 처음에서 위 → 끝으로
  });

  it('항목을 고르면 언어를 바꾸고 메뉴를 닫는다', () => {
    const setLocale = renderSwitcher();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitemradio', { name: '한국어' }));

    expect(setLocale).toHaveBeenCalledWith('ko');
    expect(options()).toHaveLength(0);
  });

  // 메뉴가 사라지면 초점이 갈 곳을 잃는다 — 키보드 사용자가 문서를 처음부터 훑게 된다.
  it('Escape로 닫으면 초점이 트리거로 돌아온다', () => {
    renderSwitcher();
    fireEvent.click(trigger());
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(options()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });

  it('바깥을 누르면 닫힌다', () => {
    renderSwitcher();
    fireEvent.click(trigger());
    expect(options()).toHaveLength(3);

    fireEvent.pointerDown(document.body);
    expect(options()).toHaveLength(0);
  });

  it('트리거를 다시 누르면 닫힌다', () => {
    renderSwitcher();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(options()).toHaveLength(0);
  });
});
