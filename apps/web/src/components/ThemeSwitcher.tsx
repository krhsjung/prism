import { useMemo, type ReactNode } from 'react';
import { SelectMenu, type Align, type SelectOption } from './SelectMenu';
import { useI18n } from '../lib/i18n/i18n-context';
import { useTheme } from '../lib/theme/theme-context';
import { THEMES, type Theme } from '../lib/theme/theme';

function MonitorIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1" />
      <path d="M12 16v4" />
      <path d="M8 20h8" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8" />
    </svg>
  );
}

const THEME_ICONS: Record<Theme, ReactNode> = {
  system: <MonitorIcon />,
  light: <SunIcon />,
  dark: <MoonIcon />,
};

// 테마 선택. 고르기 전에는 기기 설정을 따르고(system), 한 번 고르면 그 값이 저장되어
// 기기 설정과 무관하게 유지된다(theme.ts).
//
// 트리거에는 고른 값을 그대로 보여준다 — 'system'일 때 지금 칠해진 색(라이트/다크)을
// 보여주면 사용자가 무엇을 골랐는지 알 수 없게 된다.
export function ThemeSwitcher({ align = 'center' }: { align?: Align }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  // 이름은 화면 언어를 따르므로 언어가 바뀌면 다시 만든다.
  const options = useMemo<readonly SelectOption<Theme>[]>(
    () =>
      THEMES.map((value) => ({
        value,
        // 키를 조립하지만 유니온 안에 머문다 — 없는 키를 쓰면 컴파일에서 걸린다.
        label: t(`theme.${value}`),
        icon: THEME_ICONS[value],
      })),
    [t],
  );

  return (
    <SelectMenu
      label={t('common.theme')}
      value={theme}
      options={options}
      onChange={setTheme}
      icon={THEME_ICONS[theme]}
      align={align}
    />
  );
}
