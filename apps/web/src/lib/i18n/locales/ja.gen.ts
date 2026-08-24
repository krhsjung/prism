// GENERATED FILE — DO NOT EDIT.
// 원본: i18n/client.csv, i18n/locales.json
// 재생성: i18n에서 `pnpm generate`

import type { Messages } from '../messages.gen';

export const messages: Messages = {
  // ── common ──
  // 화면 공통
  'common.loading': '読み込み中…',
  'common.language': '言語',
  'common.theme': 'テーマ',
  'common.cancel': 'キャンセル',

  // ── theme ──
  // 테마 선택 — System은 "고르지 않음"이자 기기 설정을 따르겠다는 선택이다
  'theme.system': 'システム',
  'theme.light': 'ライト',
  'theme.dark': 'ダーク',

  // ── auth ──
  // 로그인 화면
  'auth.welcome_back': 'おかえりなさい',
  'auth.sign_in_to_continue': '続けるにはサインインしてください',
  'auth.continue_with_google': 'Google で続ける',
  'auth.continue_with_apple': 'Apple で続ける',
  'auth.continue_with_kakao': 'Kakao で続ける',
  'auth.try_the_demo': 'デモを試す',
  'auth.connecting': '接続しています…',
  'auth.no_personal_data': 'このポートフォリオは個人情報を保存しません。',
  // 소셜 로그인 redirect 착지 화면
  'auth.signing_you_in': 'サインインしています…',

  // ── dashboard ──
  // 대시보드
  'dashboard.title': 'ダッシュボード',
  'dashboard.signed_in_as': '{name} としてサインイン中',
  'dashboard.log_out': 'ログアウト',
  'dashboard.logging_out': 'ログアウトしています…',
  'dashboard.placeholder_body': 'ログインできました。認証の vertical slice 用の仮ダッシュボードで、デモログインの流れが最後まで動作します。',
  'dashboard.nav_webrtc': 'WebRTC',
  'dashboard.coming_soon': '準備中',
  'dashboard.navigation': 'ナビゲーション',
  'dashboard.open_menu': 'メニューを開く',
  'dashboard.close_menu': 'メニューを閉じる',
  'dashboard.active_sessions': 'アクティブなセッション',
  'dashboard.active_sessions_desc': 'アカウントがサインインしている場所',
  'dashboard.sign_out_all': 'すべてサインアウト',
  'dashboard.signing_out_all': 'サインアウトしています…',
  // 전체 로그아웃은 되돌릴 수 없다 — 누르기 전에 무엇이 끊기는지 적는다
  'dashboard.sign_out_all_confirm_title': 'すべての端末からサインアウトしますか？',
  'dashboard.sign_out_all_confirm_body': 'このセッションを含むすべてのセッションが終了します。もう一度サインインが必要です。',
  'dashboard.col_device': 'デバイス',
  'dashboard.col_started': '開始',
  'dashboard.col_expires': '有効期限',
  'dashboard.col_status': 'ステータス',
  'dashboard.status_current': '現在',
  // status_active는 지금 소켓이 붙어 있다는 뜻이다 — 세션의 유효성이 아니다
  // 소켓이 없으면 유효한 세션도 inactive로 읽힌다(백그라운드로 내린 앱이 그렇다)
  'dashboard.status_active': 'アクティブ',
  'dashboard.status_inactive': '非アクティブ',
  // 세션을 만든 기기의 종류(계약의 DeviceKind와 1:1). 모델·버전·위치는 담지 않는다
  // 브랜드명은 고유명사라 옮기지 않는다 — 옮길 것은 device_desktop·device_unknown뿐이다
  'dashboard.device_iphone': 'iPhone',
  'dashboard.device_ipad': 'iPad',
  'dashboard.device_galaxy': 'Galaxy',
  'dashboard.device_pixel': 'Pixel',
  'dashboard.device_android': 'Android',
  'dashboard.device_mac': 'Mac',
  'dashboard.device_windows': 'Windows',
  'dashboard.device_desktop': 'デスクトップ',
  'dashboard.device_unknown': '不明な端末',
  'dashboard.this_session': 'このセッション',
  'dashboard.a_session': 'サインイン中のセッション',
  'dashboard.revoke': '解除',
  'dashboard.only_this_session': 'この端末でのみサインインしています。',
  'dashboard.retry': 'もう一度試す',

  // ── error ──
  // 오류 메시지 — 키는 계약의 오류 코드와 1:1로 대응한다 (contracts.ts)
  'error.generic': '問題が発生しました。しばらくしてからもう一度お試しください。',
  'error.signin_failed': 'サインインできませんでした。もう一度お試しになるか別の方法をご利用ください。',
  'error.demo_disabled': '現在デモログインはご利用いただけません。',
  'error.network_error': '接続が切れました。ネットワークを確認してもう一度お試しください。',
  // 계약의 오류 코드가 아니라 클라이언트가 만드는 문구 — 서버에 해당 흐름의 엔드포인트가 아직 없을 때
  'error.provider_unavailable': 'このサインイン方法はまだアプリでご利用いただけません。',
  'error.logout_failed': 'ログアウトできませんでした。まだサインインしたままです — 接続を確認してもう一度お試しください。',
  'error.sessions_load_failed': 'セッションを読み込めませんでした。接続を確認してもう一度お試しください。',
  'error.revoke_failed': 'そのセッションをサインアウトできませんでした。もう一度お試しください。',
  // 스스로 로그아웃한 것이 아닌데 로그인 화면으로 온 경우. 서버는 폐기·만료·로그아웃을 한 코드(UNAUTHORIZED)로만 알려주므로 원인을 단정하지 않는다
  'error.session_ended': 'セッションが終了しました。もう一度サインインしてください。',
};
