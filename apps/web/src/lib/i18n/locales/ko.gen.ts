// GENERATED FILE — DO NOT EDIT.
// 원본: i18n/client.csv, i18n/locales.json
// 재생성: i18n에서 `pnpm generate`

import type { Messages } from '../messages.gen';

export const messages: Messages = {
  // ── common ──
  // 화면 공통
  'common.loading': '불러오는 중…',
  'common.language': '언어',
  'common.theme': '테마',
  'common.cancel': '취소',

  // ── theme ──
  // 테마 선택 — System은 "고르지 않음"이자 기기 설정을 따르겠다는 선택이다
  'theme.system': '시스템',
  'theme.light': '라이트',
  'theme.dark': '다크',

  // ── auth ──
  // 로그인 화면
  'auth.welcome_back': '다시 오셨네요',
  'auth.sign_in_to_continue': '계속하려면 로그인하세요',
  'auth.continue_with_google': 'Google로 계속하기',
  'auth.continue_with_apple': 'Apple로 계속하기',
  'auth.continue_with_kakao': '카카오로 계속하기',
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
  'dashboard.nav_webrtc': 'WebRTC',
  'dashboard.coming_soon': '준비 중',
  'dashboard.navigation': '내비게이션',
  'dashboard.open_menu': '메뉴 열기',
  'dashboard.close_menu': '메뉴 닫기',
  'dashboard.active_sessions': '활성 세션',
  'dashboard.active_sessions_desc': '계정이 로그인된 위치',
  'dashboard.sign_out_all': '모두 로그아웃',
  'dashboard.signing_out_all': '로그아웃하는 중…',
  // 전체 로그아웃은 되돌릴 수 없다 — 누르기 전에 무엇이 끊기는지 적는다
  'dashboard.sign_out_all_confirm_title': '모든 기기에서 로그아웃할까요?',
  'dashboard.sign_out_all_confirm_body': '지금 이 세션을 포함해 모든 세션이 끊깁니다. 다시 로그인해야 합니다.',
  'dashboard.col_device': '기기',
  'dashboard.col_started': '시작',
  'dashboard.col_expires': '만료',
  'dashboard.col_status': '상태',
  'dashboard.status_current': '현재',
  // status_active는 지금 소켓이 붙어 있다는 뜻이다 — 세션의 유효성이 아니다
  // 소켓이 없으면 유효한 세션도 inactive로 읽힌다(백그라운드로 내린 앱이 그렇다)
  'dashboard.status_active': '활성',
  'dashboard.status_inactive': '비활성',
  // 세션을 만든 기기의 종류(계약의 DeviceKind와 1:1). 모델·버전·위치는 담지 않는다
  // 브랜드명은 고유명사라 옮기지 않는다 — 옮길 것은 device_desktop·device_unknown뿐이다
  'dashboard.device_iphone': 'iPhone',
  'dashboard.device_ipad': 'iPad',
  'dashboard.device_galaxy': 'Galaxy',
  'dashboard.device_pixel': 'Pixel',
  'dashboard.device_android': 'Android',
  'dashboard.device_mac': 'Mac',
  'dashboard.device_windows': 'Windows',
  'dashboard.device_desktop': '데스크톱',
  'dashboard.device_unknown': '알 수 없는 기기',
  'dashboard.this_session': '현재 세션',
  'dashboard.a_session': '로그인된 세션',
  'dashboard.revoke': '해제',
  'dashboard.only_this_session': '이 기기에서만 로그인되어 있습니다.',
  'dashboard.retry': '다시 시도',

  // ── error ──
  // 오류 메시지 — 키는 계약의 오류 코드와 1:1로 대응한다 (contracts.ts)
  'error.generic': '문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  'error.signin_failed': '로그인하지 못했습니다. 다시 시도하거나 다른 방법을 이용해 주세요.',
  'error.demo_disabled': '지금은 데모 로그인을 사용할 수 없습니다.',
  'error.network_error': '연결이 끊겼습니다. 네트워크를 확인하고 다시 시도해 주세요.',
  // 계약의 오류 코드가 아니라 클라이언트가 만드는 문구 — 서버에 해당 흐름의 엔드포인트가 아직 없을 때
  'error.provider_unavailable': '이 로그인 방법은 아직 앱에서 사용할 수 없습니다.',
  'error.logout_failed': '로그아웃하지 못했습니다. 아직 로그인된 상태입니다 — 연결을 확인하고 다시 시도해 주세요.',
  'error.sessions_load_failed': '세션을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.',
  'error.revoke_failed': '해당 세션을 로그아웃하지 못했습니다. 다시 시도해 주세요.',
  // 스스로 로그아웃한 것이 아닌데 로그인 화면으로 온 경우. 서버는 폐기·만료·로그아웃을 한 코드(UNAUTHORIZED)로만 알려주므로 원인을 단정하지 않는다
  'error.session_ended': '세션이 종료되었습니다. 다시 로그인해 주세요.',
};
