import { DEFAULT_LOCALE, LOCALES, type Locale } from './messages.gen';

// 사용자가 직접 고른 언어를 기억하는 자리. 고른 적이 없으면 브라우저 설정을 따른다.
export const LOCALE_STORAGE_KEY = 'prism.locale';

// BCP 47 태그를 지원 언어로 좁힌다 — 하위 태그를 뒤에서부터 하나씩 떼며 맞춰 본다.
// ('ko-KR' → 'ko', 'zh-Hant-TW' → 'zh-Hant' → 'zh'). 브라우저가 주는 값은 거의 항상
// 지역까지 붙어 있어(ko-KR) 정확히 일치하는 경우가 오히려 드물다.
export function toLocale(tag: string): Locale | null {
  let candidate = tag.trim().toLowerCase();
  while (candidate !== '') {
    const match = LOCALES.find((locale) => locale.toLowerCase() === candidate);
    if (match) return match;
    const cut = candidate.lastIndexOf('-');
    if (cut < 0) return null;
    candidate = candidate.slice(0, cut);
  }
  return null;
}

// 선호 순서대로 훑어 처음 지원되는 언어를 고른다. 하나도 없으면 기본 언어.
export function negotiateLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const match = toLocale(tag);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

// localStorage 접근은 실패할 수 있다(사파리 프라이빗 모드 등) — 언어 설정 하나 때문에
// 앱이 죽지 않도록 실패는 "저장된 값 없음"으로 흡수한다.
export function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === null ? null : toLocale(stored);
  } catch {
    return null;
  }
}

export function storeLocale(locale: Locale): void {
  chosen = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 저장에 실패해도 이번 세션의 선택은 유효하다 — 다음 방문에 기억되지 않을 뿐이다.
  }
}

// 이번 세션에서 고른 값. **저장이 실패해도 남는다** — 사파리 프라이빗 모드에서
// localStorage가 던지면 `detectLocale`은 선택을 못 보지만 이 값은 본다.
let chosen: Locale | null = null;

// 화면이 지금 쓰고 있는 언어. React 밖(API 클라이언트)에서 읽으려고 둔다 —
// 훅을 쓸 수 없는 자리이고, 서버는 이 값을 `Accept-Language`로 받아 **세션의 언어**로
// 담아 둔다(plan/push.md D4).
export function currentLocale(): Locale {
  return chosen ?? detectLocale();
}

// 표시할 언어를 정한다: 사용자가 고른 값 > 브라우저 선호 순서 > 기본 언어.
export function detectLocale(): Locale {
  return (
    readStoredLocale() ??
    negotiateLocale(
      navigator.languages?.length ? navigator.languages : [navigator.language],
    )
  );
}
