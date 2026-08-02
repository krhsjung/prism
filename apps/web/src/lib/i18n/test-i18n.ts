import type { I18nContextValue } from './i18n-context';
import { interpolate } from './interpolate';
import { messages } from './locales/en.gen';

// 테스트용 i18n 값 — I18nProvider의 언어 감지·비동기 로드를 거치지 않고 원본 언어로
// 고정한다. 테스트가 브라우저 언어 설정이나 로드 타이밍에 흔들리지 않게 하기 위함이며,
// 단언에 쓰는 문구는 마스터(client.csv)에서 온 실제 값이다.
export function englishI18n(): I18nContextValue {
  return {
    locale: 'en',
    t: (key, vars) => interpolate(messages[key], vars),
    setLocale: () => undefined,
  };
}
