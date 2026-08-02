// GENERATED FILE — DO NOT EDIT.
// 원본: i18n/client.csv, i18n/locales.json
// 재생성: i18n에서 `pnpm generate`

import type { Messages } from '../messages.gen';

export const messages: Messages = {
  // ── common ──
  // 화면 공통
  'common.loading': 'Loading…',
  'common.language': 'Language',
  'common.theme': 'Theme',

  // ── theme ──
  // 테마 선택 — System은 "고르지 않음"이자 기기 설정을 따르겠다는 선택이다
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  // ── auth ──
  // 로그인 화면
  'auth.welcome_back': 'Welcome back',
  'auth.sign_in_to_continue': 'Sign in to continue',
  'auth.continue_with_google': 'Continue with Google',
  'auth.continue_with_apple': 'Continue with Apple',
  'auth.try_the_demo': 'Try the demo',
  'auth.connecting': 'Connecting…',
  'auth.no_personal_data': 'This portfolio stores no personal data.',
  // 소셜 로그인 redirect 착지 화면
  'auth.signing_you_in': 'Signing you in…',

  // ── dashboard ──
  // 대시보드
  'dashboard.title': 'Dashboard',
  'dashboard.signed_in_as': 'Signed in as {name}',
  'dashboard.log_out': 'Log out',
  'dashboard.logging_out': 'Logging out…',
  'dashboard.placeholder_body': 'You’re in. This is a placeholder dashboard for the authentication vertical slice — the demo login flow works end to end.',

  // ── error ──
  // 오류 메시지 — 키는 계약의 오류 코드와 1:1로 대응한다 (contracts.ts)
  'error.generic': 'Something went wrong. Please try again in a moment.',
  'error.signin_failed': 'Couldn’t sign you in. Try again or use another method.',
  'error.demo_disabled': 'Demo login is disabled right now.',
  'error.network_error': 'Connection lost. Check your network and try again.',
  'error.logout_failed': 'Couldn’t log you out. You’re still signed in — check your connection and try again.',
};
