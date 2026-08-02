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

  // ── error ──
  // 오류 메시지 — 키는 계약의 오류 코드와 1:1로 대응한다 (contracts.ts)
  'error.generic': '問題が発生しました。しばらくしてからもう一度お試しください。',
  'error.signin_failed': 'サインインできませんでした。もう一度お試しになるか別の方法をご利用ください。',
  'error.demo_disabled': '現在デモログインはご利用いただけません。',
  'error.network_error': '接続が切れました。ネットワークを確認してもう一度お試しください。',
  'error.logout_failed': 'ログアウトできませんでした。まだサインインしたままです — 接続を確認してもう一度お試しください。',
};
