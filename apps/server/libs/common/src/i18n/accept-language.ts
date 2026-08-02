import { DEFAULT_LOCALE, LOCALES, type Locale } from './messages.gen';

// BCP 47 태그를 지원 언어로 좁힌다 — 하위 태그를 뒤에서부터 하나씩 떼며 맞춰 본다.
// ('ko-KR' → 'ko', 'zh-Hant-TW' → 'zh-Hant' → 'zh')
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

// Accept-Language 헤더를 선호도 높은 순의 태그 목록으로 편다.
// ("ko-KR,ko;q=0.9,en;q=0.8" → ['ko-KR', 'ko', 'en'])
//
// 헤더는 클라이언트가 준 값이라 형식을 신뢰하지 않는다 — 읽을 수 없는 조각은
// 버리고 남은 것으로 판단한다(요청 하나가 형식 오류로 실패할 이유가 없다).
export function parseAcceptLanguage(header?: string): string[] {
  if (!header) return [];

  const entries: { tag: string; quality: number; order: number }[] = [];

  header.split(',').forEach((part, order) => {
    const [rawTag, ...params] = part.split(';');
    const tag = rawTag?.trim() ?? '';
    // '*'는 "아무거나"라는 뜻이라 고를 근거가 없다 — 기본 언어로 떨어지게 둔다.
    if (tag === '' || tag === '*') return;

    const qParam = params
      .map((p) => p.trim())
      .find((p) => p.toLowerCase().startsWith('q='));
    const parsed = qParam === undefined ? 1 : Number(qParam.slice(2));
    // q가 없거나 숫자가 아니면 최고 선호(1)로 본다(RFC 9110의 기본값).
    const quality = Number.isFinite(parsed) ? parsed : 1;
    if (quality <= 0) return; // q=0은 "이 언어는 원하지 않는다"는 뜻

    entries.push({ tag, quality, order });
  });

  // 같은 q끼리는 헤더에 적힌 순서를 지킨다(정렬이 선호를 뒤집지 않도록).
  return entries
    .sort((a, b) => b.quality - a.quality || a.order - b.order)
    .map((entry) => entry.tag);
}

// 요청 하나의 표시 언어. 지원하는 언어가 하나도 없으면 기본 언어로 응답한다.
export function localeFrom(header?: string): Locale {
  for (const tag of parseAcceptLanguage(header)) {
    const match = toLocale(tag);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
