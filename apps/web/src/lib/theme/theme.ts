// 사용자가 직접 고른 테마를 기억하는 자리. 고른 적이 없으면 기기 설정을 따른다.
export const THEME_STORAGE_KEY = 'prism.theme';

// 실제로 칠할 테마는 <html data-theme="…"> 하나로만 알린다 — CSS 토큰이 이 속성에서
// 갈리므로, 색을 바꾸는 경로가 하나뿐이다(클래스·인라인 스타일을 섞지 않는다).
export const THEME_ATTRIBUTE = 'data-theme';

// 기기 설정을 읽는 미디어 쿼리. index.html의 부트 스크립트도 같은 질의를 쓴다.
export const DARK_QUERY = '(prefers-color-scheme: dark)';

// 고를 수 있는 값. 'system'은 "고르지 않음"이 아니라 기기를 따르겠다는 선택이다 —
// 라이트/다크를 고른 뒤에도 되돌아올 수 있어야 하므로 하나의 값으로 둔다.
export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

// 실제로 화면에 칠해지는 두 가지. 'system'은 반드시 여기로 풀린 뒤 쓰인다.
export type ResolvedTheme = 'light' | 'dark';

export const DEFAULT_THEME: Theme = 'system';

export function toTheme(value: string | null): Theme | null {
  return THEMES.find((theme) => theme === value) ?? null;
}

// 기기 설정. matchMedia가 없는 환경(구형 브라우저·일부 테스트 런타임)에서는 라이트로
// 본다 — 테마 하나 때문에 앱이 뜨지 않는 편이 더 나쁘다.
export function systemTheme(): ResolvedTheme {
  if (typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

// 기기 설정은 우리 상태 바깥에서 바뀐다(OS 야간 모드 전환 등). 구독해 두면 'system'을
// 고른 사용자는 새로고침 없이 따라 바뀐다.
export function subscribeSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function resolveTheme(theme: Theme, system: ResolvedTheme): ResolvedTheme {
  return theme === 'system' ? system : theme;
}

// localStorage 접근은 실패할 수 있다(사파리 프라이빗 모드 등) — 테마 설정 하나 때문에
// 앱이 죽지 않도록 실패는 "저장된 값 없음"으로 흡수한다.
export function readStoredTheme(): Theme | null {
  try {
    return toTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 저장에 실패해도 이번 세션의 선택은 유효하다 — 다음 방문에 기억되지 않을 뿐이다.
  }
}

// 표시할 테마를 정한다: 사용자가 고른 값 > 기기 설정(= 'system').
export function detectTheme(): Theme {
  return readStoredTheme() ?? DEFAULT_THEME;
}

export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, resolved);
}
