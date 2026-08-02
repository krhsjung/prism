import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ThemeContext, type ThemeContextValue } from './theme-context';
import {
  applyTheme,
  detectTheme,
  resolveTheme,
  storeTheme,
  subscribeSystemTheme,
  systemTheme,
  type Theme,
} from './theme';

// 표시 테마의 단일 원천 — 화면들은 useTheme()으로 읽고 바꾼다.
//
// 첫 페인트는 index.html의 부트 스크립트가 이미 칠해 뒀다(React를 기다리면 저장된
// 선택과 다른 화면이 한 번 번쩍인다). 여기서는 그 뒤의 변화 — 사용자의 선택과
// 기기 설정 변경 — 만 DOM에 반영한다.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(detectTheme);
  // 기기 설정은 브라우저가 들고 있는 외부 상태다 — 구독해 두면 'system'을 고른
  // 사용자의 화면이 OS 야간 모드를 따라 바로 바뀐다.
  const system = useSyncExternalStore(subscribeSystemTheme, systemTheme);
  const resolved = resolveTheme(theme, system);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const changeTheme = useCallback((next: Theme) => {
    storeTheme(next);
    setTheme(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme: changeTheme }),
    [theme, resolved, changeTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
