// GENERATED FILE — DO NOT EDIT.
// 원본: i18n/server.csv, i18n/locales.json
// 재생성: i18n에서 `pnpm generate`

import { messages as en } from './locales/en.gen';
import { messages as ko } from './locales/ko.gen';
import { messages as ja } from './locales/ja.gen';

export const LOCALES = ['en', 'ko', 'ja'] as const;

export type Locale = (typeof LOCALES)[number];

// 목록의 첫 언어가 원본이자 기본값 — 지원하지 않는 요청 언어는 여기로 떨어진다.
export const DEFAULT_LOCALE: Locale = 'en';

export interface LocaleMeta {
  // 언어 선택 UI에 그대로 노출되는 이름 — 해당 언어로 표기한다.
  label: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { label: 'English', dir: 'ltr' },
  ko: { label: '한국어', dir: 'ltr' },
  ja: { label: '日本語', dir: 'ltr' },
};

export const MESSAGE_KEYS = [
  'page.signin_title',
  'page.noscript_notice',
  'page.noscript_continue',
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

// 모든 키가 채워져야 성립한다 — 언어 파일에 키가 빠지거나 남으면 컴파일이 깨진다.
export type Messages = Record<MessageKey, string>;

// 요청마다 언어가 달라지므로 전부 메모리에 둔다 — 응답 경로에 파일 I/O를 두지 않는다.
export const MESSAGES: Record<Locale, Messages> = { en, ko, ja };
