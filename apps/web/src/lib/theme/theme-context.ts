import { createContext, useContext } from 'react';
import type { ResolvedTheme, Theme } from './theme';

export interface ThemeContextValue {
  // 사용자가 고른 값 — 'system'이면 기기 설정을 따르는 중이다.
  theme: Theme;
  // 지금 실제로 칠해진 테마. 'system'일 때 무엇이 적용됐는지 알려면 이 값을 본다.
  resolved: ResolvedTheme;
  // 선택한 테마는 저장되어 다음 방문에도 유지된다.
  setTheme(theme: Theme): void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
