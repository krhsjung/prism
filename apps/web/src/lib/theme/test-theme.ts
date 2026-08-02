import type { ThemeContextValue } from './theme-context';

// 테스트용 테마 값 — ThemeProvider의 기기 설정 감지·구독을 거치지 않고 라이트로
// 고정한다. 테마를 다루지 않는 화면 테스트가 matchMedia 스텁에 얽히지 않게 하기 위함이다.
export function lightTheme(): ThemeContextValue {
  return {
    theme: 'system',
    resolved: 'light',
    setTheme: () => undefined,
  };
}
