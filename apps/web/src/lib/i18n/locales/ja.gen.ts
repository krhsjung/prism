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
  'common.retry': 'もう一度試す',

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

  // ── webrtc ──
  // WebRTC 1:1 통화 — 통화 상대는 **내 활성 세션**이다. 방·코드·링크 공유는 없다(plan/webrtc.md §4)
  'webrtc.title': 'WebRTC',
  // 로비 — 장치 확인 + 걸 대상 고르기
  'webrtc.lobby_title': '通話を始める',
  'webrtc.lobby_desc': 'サインイン中の端末を選んで発信してください。カメラとマイクは通話の開始時にオンになります。',
  'webrtc.camera': 'カメラ',
  'webrtc.microphone': 'マイク',
  'webrtc.camera_front': '前面カメラ',
  'webrtc.camera_back': '背面カメラ',
  'webrtc.camera_other': 'カメラ {name}',
  'webrtc.camera_simulator': 'シミュレータカメラ',
  'webrtc.mic_builtin': '内蔵マイク',
  'webrtc.mic_wired': '有線ヘッドセット',
  'webrtc.mic_bluetooth': 'Bluetooth ヘッドセット',
  'webrtc.mic_usb': 'USB マイク',
  'webrtc.mic_other': 'マイク {name}',
  // 목록은 대시보드와 같은 GET /auth/sessions에서 온다 — 기기 종류 라벨도 dashboard.device_*를 그대로 쓴다
  'webrtc.devices': '自分の端末',
  // 소켓이 붙어 있으면 바로 울리고(isConnected) 아니면 알림으로 깨운다(pushRegistered).
  // 둘 다 없는 세션만 걸 수 없다 — 그 줄에는 버튼 대신 이유를 둔다
  'webrtc.devices_desc': '接続中の端末はすぐに鳴ります。それ以外には通知が届きます。',
  'webrtc.call': '発信',
  // 푸시 경로임을 행이 말한다 — 기다리는 시간이 왜 긴지를 화면이 설명해야 한다
  'webrtc.will_notify': '通知を送ります',
  'webrtc.notifications_off': '通知オフ',
  // 다른 기기가 없어도 막다른 화면이 되지 않게 — 탭을 하나 더 열면 목록에 나타난다
  'webrtc.no_other_devices': '他の端末はサインインしていません。別のタブで開くと自分に発信できます。',
  // 현재 세션 줄은 루프백이다 — 시그널링 서버를 거치지 않고 한 탭 안에서 두 PeerConnection을 잇는다
  'webrtc.this_tab': 'このタブ',
  'webrtc.loopback': 'ループバックテスト',
  'webrtc.test': 'テスト',
  'webrtc.loopback_note': 'ループバックはこのタブ内で完結します — シグナリングサーバーを経由しません。',
  // 미디어가 서버를 지나지 않는 것이 이 슬라이스의 핵심이라 화면에도 한 줄로 적는다
  'webrtc.p2p_note': '映像と音声は端末どうしで直接やり取りされます。録画も保存もしません。',
  // 거는 쪽 — 상대가 받을 때까지. 취소는 common.cancel을 쓴다
  // 붙은 뒤 카드 머리의 제목. 상대가 누구인지는 타일의 이름표가 말하므로 여기서 되풀이하지 않는다
  'webrtc.in_call': '通話中',
  'webrtc.calling': '{device} に発信中…',
  'webrtc.ringing_desc': '相手の端末の応答を待っています。',
  // 벨은 유한하다 — 서버가 45초 뒤 양쪽을 끊는다(plan/webrtc.md §6). 숫자는 이 한 줄에만 둔다
  'webrtc.ring_timeout_note': '45 秒を過ぎると呼び出しは終了します。',
  // 알림으로 깨운 경우 — 기기가 열릴 때까지 기다리므로 화면이 그렇게 말한다
  'webrtc.notified_desc': '{device} に通知しました。45 秒以内に応答が必要です。',
  'webrtc.tile_notified': '端末が開かれるのを待っています…',
  // 받는 쪽 — 소켓이 앱 전체에 붙어 있어 어느 화면에 있든 뜬다
  'webrtc.incoming_title': '着信',
  'webrtc.incoming_body': '{device} から着信しています。',
  'webrtc.accept': '応答',
  'webrtc.decline': '拒否',
  'webrtc.declined': '相手の端末が通話を拒否しました。',
  // 알림을 늦게 열었다 — 통화는 이미 서버가 끊었다. 빈 화면 대신 무슨 일이었는지 적는다.
  // 여기에 초를 되풀이하지 않는다: 상한은 호출 중 화면(ring_timeout_note)이 이미 말했다
  'webrtc.expired_title': 'その通話はすでに終了しました',
  'webrtc.expired_body': '{device} から発信がありましたが、通話はすでに終了しています。必要なら折り返してください。',
  // 통화 컨트롤 — 아이콘 전용 버튼이라 이 문구는 접근성 이름으로만 쓰인다(§4)
  'webrtc.mute': 'マイクをオフにする',
  'webrtc.unmute': 'マイクをオンにする',
  'webrtc.camera_off': 'カメラをオフにする',
  'webrtc.camera_on': 'カメラをオンにする',
  'webrtc.end_call': '通話を終了',
  // 타일 라벨 — 상대는 내 기기이므로 이름은 dashboard.device_*가 준다. 여기 있는 것은 내 쪽뿐이다
  'webrtc.you': '自分',
  // 루프백에서는 두 타일이 같은 카메라를 나눠 쓴다 — 그것을 라벨이 말한다
  'webrtc.loopback_peer': 'ループバック',
  // 연결 상태 배지 — Atom/Badge의 기존 변형에 그대로 매핑된다(§4)
  'webrtc.status_ringing': '呼び出し中',
  'webrtc.status_notified': '通知済み',
  'webrtc.status_connecting': '接続中',
  'webrtc.status_connected': '接続済み',
  'webrtc.status_reconnecting': '再接続中',
  'webrtc.status_failed': '接続に失敗',
  // 타일 안의 한 줄 — Molecule/VideoTile의 State 변형과 1:1
  'webrtc.tile_ringing': '応答を待っています…',
  'webrtc.tile_connecting': '接続しています…',
  'webrtc.tile_reconnecting': '再接続しています…',
  'webrtc.tile_camera_off': 'カメラはオフです',
  'webrtc.tile_peer_camera_off': '相手のカメラはオフです',
  'webrtc.tile_camera_denied': 'カメラ権限なし',
  'webrtc.tile_camera_missing': 'カメラなし',
  'webrtc.tile_camera_busy': 'カメラ使用中',
  'webrtc.tile_camera_blocked': 'カメラを使用できません',
  // 아직 카메라를 켜지 않은 상태 — 권한을 통화 시작 시점으로 미뤘기 때문이다.
  // 위 tile_camera_* 넷과 다르다: 이건 실패가 아니라 아직 묻지 않은 것이다.
  'webrtc.tile_camera_idle': '通話が始まるとカメラがオンになります',
  // 아직 권한을 준 적이 없어 장치 이름조차 못 읽는 경우 — 미리 켜 보고 싶은 사람을 위한 문
  'webrtc.preview_start': 'カメラをオンにする',
  // 상대가 끊으면 로비로 돌아간다 — 방이 없으므로 남아서 기다릴 자리도 없다(§4)
  'webrtc.peer_left': '相手の端末が通話を終了しました。',
  // 진단 패널 — 기본은 접혀 있다. 라벨은 Manrope · 값은 모노(JetBrains Mono)로 그린다(§4)
  'webrtc.diagnostics': '診断',
  'webrtc.diag_show': '診断を開く',
  'webrtc.diag_hide': '診断を閉じる',
  // 단위(ms · kbps · fps · %)는 번역하지 않는다 — 값과 함께 클라이언트가 만든다
  'webrtc.diag_quality': '品質',
  'webrtc.stat_rtt': '往復遅延',
  'webrtc.stat_jitter': 'ジッター',
  'webrtc.stat_packet_loss': 'パケットロス',
  'webrtc.stat_sending': '送信',
  'webrtc.stat_receiving': '受信',
  'webrtc.stat_video': '映像',
  // 값이 없으면 0이 아니라 —를 그린다. Safari는 getStats()의 일부 필드를 주지 않는다
  'webrtc.stat_unavailable': '—',
  'webrtc.diag_connection': '接続',
  // Path — 미디어가 직접 가는지 TURN을 거치는지. TURN을 v1부터 넣은 결정(§9-2)이
  // 값을 하는지 이 한 줄이 증명한다. Relay는 실패가 아니라 비싼 성공이라 Warning이다
  'webrtc.ice_path': '経路',
  'webrtc.ice_path_direct': '直接接続',
  'webrtc.ice_path_reflexive': 'STUN 経由',
  'webrtc.ice_path_relay': 'TURN リレー',
  'webrtc.ice_path_loopback': 'ループバック',
  'webrtc.ice_local': 'ローカル候補',
  'webrtc.ice_remote': 'リモート候補',
  'webrtc.ice_state': 'ICE の状態',
  'webrtc.dtls_state': 'DTLS の状態',
  'webrtc.connected_for': '接続時間',
  // 후보 주소는 화면에 띄우지 않는다 — 타입·전송까지만(§7)
  'webrtc.ice_address_hidden': 'アドレス非表示',
  'webrtc.diag_settings': '接続設定',
  'webrtc.ice_policy': 'ICE ポリシー',
  'webrtc.ice_policy_all': 'STUN + TURN',
  'webrtc.ice_policy_relay': 'TURN のみ',
  'webrtc.ice_policy_note': '切り替えると通話が再接続されます。「TURN のみ」はメディアをリレー経由に強制するため、経路の変化を確認できます。',
  // 로그에 레벨(DEBUG/INFO/WARN/ERROR)을 두지 않는다 — 원소가 §6 계약의 메시지뿐이라
  // 네 레벨로 나누면 필터가 원소보다 커진다. 실제로 헷갈리는 축은 방향(누가 offer를 냈나)이다
  'webrtc.diag_signaling': 'シグナリング',
  'webrtc.log_sent': '送信',
  'webrtc.log_received': '受信',
  'webrtc.log_copy': 'ログをコピー',
  'webrtc.log_clear': 'クリア',
  'webrtc.log_empty': 'まだありません。',
  // 루프백은 시그널링을 타지 않으므로 로그가 비어 있는 것이 정상이다
  'webrtc.log_loopback': 'ループバックはシグナリングサーバーを使用しません。',

  // ── push ──
  // 푸시 — 내 기기에 알림을 보내 보는 화면(plan/push.md)
  'push.title': 'プッシュ',
  'push.desc': '端末を選んで通知を送ってみましょう。',
  // 카드 바닥 한 줄 — 토큰이 어디에 사는지 말한다(§5-3). 목록 응답에 토큰이 실리지 않는 이유이기도 하다
  'push.foot': '登録トークンはセッション内にあり、サーバーの外に出ません。サインアウトすると一緒に消えます。',
  // 목록은 대시보드·WebRTC 로비와 같은 데이터다. 다른 것은 할 수 있는 일뿐이다
  'push.devices': '端末に送信',
  'push.devices_desc': '登録済みの端末が通知を受け取れます。それ以外はまだです。',
  // 여럿 고를 수 있다. 같은 설치가 여러 세션에 걸리면 서버가 합쳐 한 번만 보낸다(§5-10)
  'push.select_all': 'すべて選択',
  'push.clear_all': '解除',
  'push.selected_count': '{count} 件選択中',
  // 고른 줄은 버튼 글자로 말한다 — 목록에 라디오를 따로 두면 누를 곳이 둘이 된다
  'push.select': '選択',
  'push.selected': '選択中',
  // 제목은 선택이다 — 비우면 서버가 받는 기기의 언어로 그린다(server.csv의 demo_title)
  'push.title_label': 'タイトル',
  'push.title_placeholder': '空欄なら既定のタイトルになります',
  'push.message_label': 'メッセージ',
  'push.message_placeholder': '端末に表示する文言を入力',
  'push.send': '送信',
  // 알림이 실을 수 있는 것들 — 셋 다 선택이다(§5-11 ~ §5-13)
  'push.image_label': '画像',
  'push.image_hint': '公開 https アドレスです。下のサンプルはこのサイトが配信します。',
  // 그리는 것은 결국 OS다 — macOS Chrome은 시스템 알림 센터를 쓰고 거기엔 큰 그림 자리가 없다(§5-11)
  'push.image_desktop_note': 'デスクトップのブラウザーでは画像が表示されないことがあります。',
  'push.image_placeholder': 'https://example.com/photo.jpg',
  'push.image_none': '画像なし',
  'push.link_label': 'リンク',
  'push.link_hint': '通知をタップしたときに開く場所です。',
  'push.link_placeholder': 'https://example.com',
  'push.actions_label': 'ボタン',
  'push.actions_none': 'なし',
  'push.actions_open': '開く',
  'push.actions_open_dismiss': '開くと閉じる',
  // 알림에 붙는 버튼의 문구. **서버가 보내지 않는다** — iOS는 등록 시점에 굳어 요청의 언어를 알 수 없다(§5-13)
  'push.action_open': '開く',
  'push.action_dismiss': '閉じる',
  // FCM이 알려 주는 것은 받아들였다까지다 — 배달도 열람도 알 수 없다
  'push.result_accepted': '送信しました。端末が起動していれば通知が表示されます。',
  // 같은 설치가 여러 세션에 걸렸다 — 실패가 아니라 한 번만 보냈다는 사실이다(§5-5)
  'push.result_duplicate': '別の行と同じ端末です — 一度だけ送信しました。',
  'push.result_unknown': 'そのセッションはありません。一覧を更新してください。',
  'push.result_no_token': 'その端末には通知トークンがありません。その端末で再度サインインすると有効になります。',
  'push.result_rejected': 'Firebase がその端末のトークンを拒否しました。その端末で再度サインインしてください。',
  // Android 알림 채널 이름 — 시스템 설정에 그대로 보인다. 통화와 데모를 가르는 이유는 하나를 끌 때 둘 다 꺼지지 않게 하려는 것이다
  'push.channel_calls': '通話',
  'push.channel_general': '通知',
  // 권한은 로그인 화면에서 먼저 받는다 — 토큰이 로그인 요청에 실려야 하기 때문이다(§5-2)
  'push.allow': '通知をオンにする',
  'push.allow_desc': 'アプリを閉じていても、この端末が通話とプッシュを受け取れるようになります。',
  // 끌 수 있는 것은 **등록**뿐이다 — 브라우저·OS 권한은 앱이 되돌릴 수 없다(§5-15)
  'push.allow_off': '通知をオフにする',
  'push.allow_off_desc': 'この端末は受信しなくなります。ブラウザーの権限はそのままです。',
  'push.allow_denied': 'このアプリの通知はブロックされています。設定でオンに戻してください。',
  'push.allow_unsupported': 'このブラウザーは通知を受け取れません。',

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
  // WebRTC — 계약의 오류 코드가 아니라 클라이언트가 만드는 문구
  'error.camera_permission_denied': 'カメラとマイクへのアクセスが必要です。ブラウザで許可してからもう一度お試しください。',
  'error.camera_in_use': '別のアプリがカメラを使用しています。終了してからもう一度お試しください。',
  'error.camera_not_found': 'カメラとマイクが見つかりません。接続するか、カメラのある端末で開いてください。',
  'error.camera_insecure': '安全な接続でないとブラウザはカメラを利用できません。https（または localhost）で開いてからもう一度お試しください。',
  // 통화 대상은 내 세션이다 — 서버가 소유권을 강제하므로 남의 세션 id를 넣어도 이 오류로 끝난다(§6)
  'error.device_offline': 'その端末はもう接続されていません。別の端末を選んでください。',
  'error.device_busy': 'その端末はすでに通話中です。',
  'error.no_answer': '45 秒間応答がなかったため通話を終了しました。',
  'error.device_unreachable': 'その端末は接続されておらず、通知もオフです。',
  'error.call_failed': '通話を接続できませんでした。ネットワークを確認してもう一度お試しください。',
  'error.signaling_lost': 'サーバーとの接続が切れました。再接続しています…',
};
