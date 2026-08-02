import { createContext, useContext } from 'react';
import type { MessageVars } from './interpolate';
import type { Locale, MessageKey } from './messages.gen';

export interface I18nContextValue {
  locale: Locale;
  // 키는 생성된 유니온이라 오타·삭제된 키가 컴파일 단계에서 걸린다
  // (런타임에 키 문자열이 그대로 노출되는 사고가 나지 않는다).
  t(key: MessageKey, vars?: MessageVars): string;
  // 선택한 언어는 저장되어 다음 방문에도 유지된다.
  setLocale(locale: Locale): void;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
