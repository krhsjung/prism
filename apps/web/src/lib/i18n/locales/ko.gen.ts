// GENERATED FILE — DO NOT EDIT.
// 원본: i18n/client.csv, i18n/locales.json
// 재생성: i18n에서 `pnpm generate`

import type { Messages } from '../messages.gen';

export const messages: Messages = {
  // ── common ──
  // 화면 공통
  'common.loading': '불러오는 중…',
  'common.language': '언어',

  // ── auth ──
  // 로그인 화면
  'auth.welcome_back': '다시 오셨네요',
  'auth.sign_in_to_continue': '계속하려면 로그인하세요',
  'auth.continue_with_google': 'Google로 계속하기',
  'auth.continue_with_apple': 'Apple로 계속하기',
  'auth.try_the_demo': '데모 체험하기',
  'auth.connecting': '연결하는 중…',
  'auth.no_personal_data': '이 포트폴리오는 개인정보를 저장하지 않습니다.',
  // 소셜 로그인 redirect 착지 화면
  'auth.signing_you_in': '로그인하는 중…',

  // ── dashboard ──
  // 대시보드
  'dashboard.title': '대시보드',
  'dashboard.signed_in_as': '{name} 님으로 로그인했습니다',
  'dashboard.log_out': '로그아웃',
  'dashboard.logging_out': '로그아웃하는 중…',
  'dashboard.placeholder_body': '로그인됐습니다. 인증 vertical slice를 위한 임시 대시보드로, 데모 로그인 흐름이 처음부터 끝까지 동작합니다.',

  // ── error ──
  // 오류 메시지 — 키는 계약의 오류 코드와 1:1로 대응한다 (contracts.ts)
  'error.generic': '문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  'error.signin_failed': '로그인하지 못했습니다. 다시 시도하거나 다른 방법을 이용해 주세요.',
  'error.demo_disabled': '지금은 데모 로그인을 사용할 수 없습니다.',
  'error.network_error': '연결이 끊겼습니다. 네트워크를 확인하고 다시 시도해 주세요.',
  'error.logout_failed': '로그아웃하지 못했습니다. 아직 로그인된 상태입니다 — 연결을 확인하고 다시 시도해 주세요.',
};
