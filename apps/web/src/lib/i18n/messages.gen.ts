// GENERATED FILE — DO NOT EDIT.
// 원본: i18n/client.csv, i18n/locales.json
// 재생성: i18n에서 `pnpm generate`

import { messages as defaultMessages } from './locales/en.gen';

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
  'common.loading',
  'common.language',
  'auth.welcome_back',
  'auth.sign_in_to_continue',
  'auth.continue_with_google',
  'auth.continue_with_apple',
  'auth.try_the_demo',
  'auth.connecting',
  'auth.no_personal_data',
  'auth.signing_you_in',
  'dashboard.title',
  'dashboard.signed_in_as',
  'dashboard.log_out',
  'dashboard.logging_out',
  'dashboard.placeholder_body',
  'error.generic',
  'error.signin_failed',
  'error.demo_disabled',
  'error.network_error',
  'error.logout_failed',
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

// 모든 키가 채워져야 성립한다 — 언어 파일에 키가 빠지거나 남으면 컴파일이 깨진다.
export type Messages = Record<MessageKey, string>;

// 기본 언어만 정적으로 번들한다 — 첫 렌더에서 곧바로 그릴 수 있어야 하기 때문.
export const DEFAULT_MESSAGES: Messages = defaultMessages;

// 나머지 언어는 고를 때 내려받는다 — 언어가 늘어도 초기 번들 크기는 그대로다.
export const LOAD_MESSAGES: Record<Locale, () => Promise<Messages>> = {
  en: () => Promise.resolve(defaultMessages),
  ko: () => import('./locales/ko.gen').then((m) => m.messages),
  ja: () => import('./locales/ja.gen').then((m) => m.messages),
};
