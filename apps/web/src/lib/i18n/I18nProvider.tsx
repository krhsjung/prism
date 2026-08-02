import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { I18nContext, type I18nContextValue } from './i18n-context';
import { interpolate, type MessageVars } from './interpolate';
import { detectLocale, storeLocale } from './locale';
import {
  DEFAULT_LOCALE,
  DEFAULT_MESSAGES,
  LOAD_MESSAGES,
  LOCALE_META,
  type Locale,
  type MessageKey,
  type Messages,
} from './messages.gen';

// 표시 언어의 단일 원천 — 화면들은 useI18n()으로 t()만 부른다.
//
// 기본 언어는 번들에 정적으로 들어 있어 첫 렌더부터 바로 그릴 수 있고, 나머지 언어는
// 동적 import로 그때 내려받는다. 내려받는 동안에는 아무것도 그리지 않는다 — 영어를
// 먼저 보여줬다가 한국어로 바꾸면 첫 화면이 눈에 띄게 깜빡이기 때문이다.
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const [messages, setMessages] = useState<Messages | null>(() =>
    locale === DEFAULT_LOCALE ? DEFAULT_MESSAGES : null,
  );

  useEffect(() => {
    let current = true;
    void LOAD_MESSAGES[locale]().then((loaded) => {
      // 빠르게 두 번 바꾸면 먼저 시작한 로드가 나중에 끝날 수 있다 — 늦게 도착한
      // 이전 언어가 지금 언어를 덮어쓰지 못하게 한다.
      if (current) setMessages(loaded);
    });
    return () => {
      current = false;
    };
  }, [locale]);

  // 스크린 리더의 발음과 브라우저의 줄바꿈 규칙이 문서 언어를 따른다 — 화면 텍스트만
  // 바꾸고 여기를 두면 한국어 문장을 영어로 읽는다.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = LOCALE_META[locale].dir;
  }, [locale]);

  const changeLocale = useCallback((next: Locale) => {
    storeLocale(next);
    setLocale(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: MessageVars) =>
      interpolate((messages ?? DEFAULT_MESSAGES)[key], vars),
    [messages],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, t, setLocale: changeLocale }),
    [locale, t, changeLocale],
  );

  if (!messages) return null;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
