// GENERATED FILE — DO NOT EDIT.
// 원본: i18n/server.csv, i18n/locales.json
// 재생성: i18n에서 `pnpm generate`

import type { Messages } from '../messages.gen';

export const messages: Messages = {
  // ── page ──
  // OAuth 콜백 종료 페이지 — popup을 닫거나 웹으로 돌려보내는 중간 화면
  'page.signin_title': 'サインイン中 — Prism',
  'page.noscript_notice': 'JavaScript が無効なため、このページは自動で続行できません。',
  'page.noscript_continue': 'Prism へ進む',

  // ── push ──
  // 푸시 알림 — 서버가 그리는 유일한 문구다. 받는 기기의 언어는 요청에서 알 수 없어 세션에 담아 둔 값을 쓴다(plan/push.md D4)
  // 기기 종류는 본문에 넣지 않는다: 라벨 9개가 이 마스터에 복제되면 client.csv와 갈라진다. 종류는 data로 가고 앱을 연 화면이 그린다
  'push.call_title': '着信',
  'push.call_body': '応答するには Prism を開いてください。',
  'push.demo_title': 'テストプッシュ',
};
