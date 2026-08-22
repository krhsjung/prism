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
  'common.cancel': 'Cancel',

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
  'auth.continue_with_kakao': 'Continue with Kakao',
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
  'dashboard.nav_webrtc': 'WebRTC',
  'dashboard.coming_soon': 'Coming soon',
  'dashboard.navigation': 'Navigation',
  'dashboard.open_menu': 'Open menu',
  'dashboard.close_menu': 'Close menu',
  'dashboard.active_sessions': 'Active sessions',
  'dashboard.active_sessions_desc': 'Where your account is signed in',
  'dashboard.sign_out_all': 'Sign out all',
  'dashboard.signing_out_all': 'Signing out…',
  // 전체 로그아웃은 되돌릴 수 없다 — 누르기 전에 무엇이 끊기는지 적는다
  'dashboard.sign_out_all_confirm_title': 'Sign out of all devices?',
  'dashboard.sign_out_all_confirm_body': 'Every session ends, including this one. You’ll need to sign in again.',
  'dashboard.col_device': 'Device',
  'dashboard.col_started': 'Started',
  'dashboard.col_expires': 'Expires',
  'dashboard.col_status': 'Status',
  'dashboard.status_current': 'Current',
  'dashboard.status_active': 'Active',
  // 세션을 만든 기기의 종류(계약의 DeviceKind와 1:1). 모델·버전·위치는 담지 않는다
  // 브랜드명은 고유명사라 옮기지 않는다 — 옮길 것은 device_desktop·device_unknown뿐이다
  'dashboard.device_iphone': 'iPhone',
  'dashboard.device_ipad': 'iPad',
  'dashboard.device_galaxy': 'Galaxy',
  'dashboard.device_pixel': 'Pixel',
  'dashboard.device_android': 'Android',
  'dashboard.device_mac': 'Mac',
  'dashboard.device_windows': 'Windows',
  'dashboard.device_desktop': 'Desktop',
  'dashboard.device_unknown': 'Unknown device',
  'dashboard.this_session': 'This session',
  'dashboard.a_session': 'Signed-in session',
  'dashboard.revoke': 'Revoke',
  'dashboard.only_this_session': 'You’re only signed in on this device.',
  'dashboard.retry': 'Try again',

  // ── error ──
  // 오류 메시지 — 키는 계약의 오류 코드와 1:1로 대응한다 (contracts.ts)
  'error.generic': 'Something went wrong. Please try again in a moment.',
  'error.signin_failed': 'Couldn’t sign you in. Try again or use another method.',
  'error.demo_disabled': 'Demo login is disabled right now.',
  'error.network_error': 'Connection lost. Check your network and try again.',
  // 계약의 오류 코드가 아니라 클라이언트가 만드는 문구 — 서버에 해당 흐름의 엔드포인트가 아직 없을 때
  'error.provider_unavailable': 'That sign-in method isn’t available in this app yet.',
  'error.logout_failed': 'Couldn’t log you out. You’re still signed in — check your connection and try again.',
  'error.sessions_load_failed': 'Couldn’t load your sessions. Check your connection and try again.',
  'error.revoke_failed': 'Couldn’t sign out that session. Try again.',
};
