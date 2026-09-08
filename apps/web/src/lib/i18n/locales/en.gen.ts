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
  'common.retry': 'Try again',

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
  // status_active는 지금 소켓이 붙어 있다는 뜻이다 — 세션의 유효성이 아니다
  // 소켓이 없으면 유효한 세션도 inactive로 읽힌다(백그라운드로 내린 앱이 그렇다)
  'dashboard.status_active': 'Active',
  'dashboard.status_inactive': 'Inactive',
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

  // ── webrtc ──
  // WebRTC 1:1 통화 — 통화 상대는 **내 활성 세션**이다. 방·코드·링크 공유는 없다(plan/webrtc.md §4)
  'webrtc.title': 'WebRTC',
  // 로비 — 장치 확인 + 걸 대상 고르기
  'webrtc.lobby_title': 'Start a call',
  'webrtc.lobby_desc': 'Pick a signed-in device to call. Your camera and mic turn on when the call starts.',
  'webrtc.camera': 'Camera',
  'webrtc.microphone': 'Microphone',
  'webrtc.camera_front': 'Front camera',
  'webrtc.camera_back': 'Back camera',
  'webrtc.camera_other': 'Camera {name}',
  'webrtc.camera_simulator': 'Simulator camera',
  'webrtc.mic_builtin': 'Built-in microphone',
  'webrtc.mic_wired': 'Wired headset',
  'webrtc.mic_bluetooth': 'Bluetooth headset',
  'webrtc.mic_usb': 'USB microphone',
  'webrtc.mic_other': 'Microphone {name}',
  // 목록은 대시보드와 같은 GET /auth/sessions에서 온다 — 기기 종류 라벨도 dashboard.device_*를 그대로 쓴다
  'webrtc.devices': 'Your devices',
  // 소켓이 붙어 있으면 바로 울리고(isConnected) 아니면 알림으로 깨운다(pushRegistered).
  // 둘 다 없는 세션만 걸 수 없다 — 그 줄에는 버튼 대신 이유를 둔다
  'webrtc.devices_desc': 'Connected devices ring right away. The rest get a notification.',
  'webrtc.call': 'Call',
  // 푸시 경로임을 행이 말한다 — 기다리는 시간이 왜 긴지를 화면이 설명해야 한다
  'webrtc.will_notify': 'Will notify',
  'webrtc.notifications_off': 'Notifications off',
  // 다른 기기가 없어도 막다른 화면이 되지 않게 — 탭을 하나 더 열면 목록에 나타난다
  'webrtc.no_other_devices': 'No other devices are signed in. Open Prism in another tab to call yourself.',
  // 현재 세션 줄은 루프백이다 — 시그널링 서버를 거치지 않고 한 탭 안에서 두 PeerConnection을 잇는다
  'webrtc.this_tab': 'This tab',
  'webrtc.loopback': 'Loopback test',
  'webrtc.test': 'Test',
  'webrtc.loopback_note': 'Loopback stays in this tab — nothing goes through the signaling server.',
  // 미디어가 서버를 지나지 않는 것이 이 슬라이스의 핵심이라 화면에도 한 줄로 적는다
  'webrtc.p2p_note': 'Video and audio go straight between your devices. Nothing is recorded or stored.',
  // 거는 쪽 — 상대가 받을 때까지. 취소는 common.cancel을 쓴다
  // 붙은 뒤 카드 머리의 제목. 상대가 누구인지는 타일의 이름표가 말하므로 여기서 되풀이하지 않는다
  'webrtc.in_call': 'In call',
  'webrtc.calling': 'Calling {device}…',
  'webrtc.ringing_desc': 'Waiting for the other device to answer.',
  // 벨은 유한하다 — 서버가 45초 뒤 양쪽을 끊는다(plan/webrtc.md §6). 숫자는 이 한 줄에만 둔다
  'webrtc.ring_timeout_note': 'Calls stop ringing after 45 seconds.',
  // 알림으로 깨운 경우 — 기기가 열릴 때까지 기다리므로 화면이 그렇게 말한다
  'webrtc.notified_desc': 'Notified {device}. It has 45 seconds to answer.',
  'webrtc.tile_notified': 'Waiting for the device to open…',
  // 받는 쪽 — 소켓이 앱 전체에 붙어 있어 어느 화면에 있든 뜬다
  'webrtc.incoming_title': 'Incoming call',
  'webrtc.incoming_body': '{device} is calling.',
  'webrtc.accept': 'Accept',
  'webrtc.decline': 'Decline',
  'webrtc.declined': 'The other device declined the call.',
  // 알림을 늦게 열었다 — 통화는 이미 서버가 끊었다. 빈 화면 대신 무슨 일이었는지 적는다.
  // 여기에 초를 되풀이하지 않는다: 상한은 호출 중 화면(ring_timeout_note)이 이미 말했다
  'webrtc.expired_title': 'That call already ended',
  'webrtc.expired_body': '{device} called and the call has already ended. Call it back if you like.',
  // 통화 컨트롤 — 아이콘 전용 버튼이라 이 문구는 접근성 이름으로만 쓰인다(§4)
  'webrtc.mute': 'Mute microphone',
  'webrtc.unmute': 'Unmute microphone',
  'webrtc.camera_off': 'Turn camera off',
  'webrtc.camera_on': 'Turn camera on',
  'webrtc.end_call': 'End call',
  // 타일 라벨 — 상대는 내 기기이므로 이름은 dashboard.device_*가 준다. 여기 있는 것은 내 쪽뿐이다
  'webrtc.you': 'You',
  // 루프백에서는 두 타일이 같은 카메라를 나눠 쓴다 — 그것을 라벨이 말한다
  'webrtc.loopback_peer': 'Loopback',
  // 연결 상태 배지 — Atom/Badge의 기존 변형에 그대로 매핑된다(§4)
  'webrtc.status_ringing': 'Ringing',
  'webrtc.status_notified': 'Notified',
  'webrtc.status_connecting': 'Connecting',
  'webrtc.status_connected': 'Connected',
  'webrtc.status_reconnecting': 'Reconnecting',
  'webrtc.status_failed': 'Connection failed',
  // 타일 안의 한 줄 — Molecule/VideoTile의 State 변형과 1:1
  'webrtc.tile_ringing': 'Waiting for an answer…',
  'webrtc.tile_connecting': 'Connecting…',
  'webrtc.tile_reconnecting': 'Reconnecting…',
  'webrtc.tile_camera_off': 'Your camera is off',
  'webrtc.tile_peer_camera_off': 'Their camera is off',
  'webrtc.tile_camera_denied': 'No camera access',
  'webrtc.tile_camera_missing': 'No camera',
  'webrtc.tile_camera_busy': 'Camera in use',
  'webrtc.tile_camera_blocked': 'Camera unavailable',
  // 아직 카메라를 켜지 않은 상태 — 권한을 통화 시작 시점으로 미뤘기 때문이다.
  // 위 tile_camera_* 넷과 다르다: 이건 실패가 아니라 아직 묻지 않은 것이다.
  'webrtc.tile_camera_idle': 'Camera turns on when the call starts',
  // 아직 권한을 준 적이 없어 장치 이름조차 못 읽는 경우 — 미리 켜 보고 싶은 사람을 위한 문
  'webrtc.preview_start': 'Turn on camera',
  // 상대가 끊으면 로비로 돌아간다 — 방이 없으므로 남아서 기다릴 자리도 없다(§4)
  'webrtc.peer_left': 'The other device ended the call.',
  // 진단 패널 — 기본은 접혀 있다. 라벨은 Manrope · 값은 모노(JetBrains Mono)로 그린다(§4)
  'webrtc.diagnostics': 'Diagnostics',
  'webrtc.diag_show': 'Show diagnostics',
  'webrtc.diag_hide': 'Hide diagnostics',
  // 단위(ms · kbps · fps · %)는 번역하지 않는다 — 값과 함께 클라이언트가 만든다
  'webrtc.diag_quality': 'Quality',
  'webrtc.stat_rtt': 'Round-trip time',
  'webrtc.stat_jitter': 'Jitter',
  'webrtc.stat_packet_loss': 'Packet loss',
  'webrtc.stat_sending': 'Sending',
  'webrtc.stat_receiving': 'Receiving',
  'webrtc.stat_video': 'Video',
  // 값이 없으면 0이 아니라 —를 그린다. Safari는 getStats()의 일부 필드를 주지 않는다
  'webrtc.stat_unavailable': '—',
  'webrtc.diag_connection': 'Connection',
  // Path — 미디어가 직접 가는지 TURN을 거치는지. TURN을 v1부터 넣은 결정(§9-2)이
  // 값을 하는지 이 한 줄이 증명한다. Relay는 실패가 아니라 비싼 성공이라 Warning이다
  'webrtc.ice_path': 'Path',
  'webrtc.ice_path_direct': 'Direct',
  'webrtc.ice_path_reflexive': 'Via STUN',
  'webrtc.ice_path_relay': 'Relayed (TURN)',
  'webrtc.ice_path_loopback': 'Loopback',
  'webrtc.ice_local': 'Local candidate',
  'webrtc.ice_remote': 'Remote candidate',
  'webrtc.ice_state': 'ICE state',
  'webrtc.dtls_state': 'DTLS state',
  'webrtc.connected_for': 'Connected for',
  // 후보 주소는 화면에 띄우지 않는다 — 타입·전송까지만(§7)
  'webrtc.ice_address_hidden': 'address hidden',
  'webrtc.diag_settings': 'Connection settings',
  'webrtc.ice_policy': 'ICE policy',
  'webrtc.ice_policy_all': 'STUN + TURN',
  'webrtc.ice_policy_relay': 'TURN only',
  'webrtc.ice_policy_note': 'Switching reconnects the call. “TURN only” forces media through the relay, so you can watch the path change.',
  // 로그에 레벨(DEBUG/INFO/WARN/ERROR)을 두지 않는다 — 원소가 §6 계약의 메시지뿐이라
  // 네 레벨로 나누면 필터가 원소보다 커진다. 실제로 헷갈리는 축은 방향(누가 offer를 냈나)이다
  'webrtc.diag_signaling': 'Signaling',
  'webrtc.log_sent': 'Sent',
  'webrtc.log_received': 'Received',
  'webrtc.log_copy': 'Copy log',
  'webrtc.log_clear': 'Clear',
  'webrtc.log_empty': 'Nothing yet.',
  // 루프백은 시그널링을 타지 않으므로 로그가 비어 있는 것이 정상이다
  'webrtc.log_loopback': 'Loopback doesn’t use the signaling server.',

  // ── push ──
  // 푸시 — 내 기기에 알림을 보내 보는 화면(plan/push.md)
  'push.title': 'Push',
  'push.desc': 'Pick devices and send them a notification.',
  // 카드 바닥 한 줄 — 토큰이 어디에 사는지 말한다(§5-3). 목록 응답에 토큰이 실리지 않는 이유이기도 하다
  'push.foot': 'Registration tokens live inside the session and never leave the server. They disappear when you sign out.',
  // 목록은 대시보드·WebRTC 로비와 같은 데이터다. 다른 것은 할 수 있는 일뿐이다
  'push.devices': 'Send to a device',
  'push.devices_desc': 'Registered devices can receive a notification. The rest can\'t yet.',
  // 여럿 고를 수 있다. 같은 설치가 여러 세션에 걸리면 서버가 합쳐 한 번만 보낸다(§5-10)
  'push.select_all': 'Select all',
  'push.clear_all': 'Clear',
  'push.selected_count': '{count} selected',
  // 고른 줄은 버튼 글자로 말한다 — 목록에 라디오를 따로 두면 누를 곳이 둘이 된다
  'push.select': 'Select',
  'push.selected': 'Selected',
  'push.message_label': 'Message',
  'push.message_placeholder': 'Type what the device should show',
  'push.send': 'Send',
  // 알림이 실을 수 있는 것들 — 셋 다 선택이다(§5-11 ~ §5-13)
  'push.image_label': 'Image',
  'push.image_hint': 'A public https address. Samples below are served by this site.',
  'push.image_placeholder': 'https://example.com/photo.jpg',
  'push.image_none': 'No image',
  'push.link_label': 'Link',
  'push.link_hint': 'Where the notification opens when it is tapped.',
  'push.link_placeholder': 'https://example.com',
  'push.actions_label': 'Buttons',
  'push.actions_none': 'None',
  'push.actions_open': 'Open',
  'push.actions_open_dismiss': 'Open and Dismiss',
  // 알림에 붙는 버튼의 문구. **서버가 보내지 않는다** — iOS는 등록 시점에 굳어 요청의 언어를 알 수 없다(§5-13)
  'push.action_open': 'Open',
  'push.action_dismiss': 'Dismiss',
  // FCM이 알려 주는 것은 받아들였다까지다 — 배달도 열람도 알 수 없다
  'push.result_accepted': 'Sent. It shows on that device if the device is awake.',
  // 같은 설치가 여러 세션에 걸렸다 — 실패가 아니라 한 번만 보냈다는 사실이다(§5-5)
  'push.result_duplicate': 'Same device as another line — sent once.',
  'push.result_unknown': 'That session is gone. Refresh the list.',
  'push.result_no_token': 'That device has no notification token. Sign in again on it to turn notifications on.',
  'push.result_rejected': 'Firebase rejected that device\'s token. Sign in again on that device.',
  // Android 알림 채널 이름 — 시스템 설정에 그대로 보인다. 통화와 데모를 가르는 이유는 하나를 끌 때 둘 다 꺼지지 않게 하려는 것이다
  'push.channel_calls': 'Calls',
  'push.channel_general': 'Notifications',
  // 권한은 로그인 화면에서 먼저 받는다 — 토큰이 로그인 요청에 실려야 하기 때문이다(§5-2)
  'push.allow': 'Turn on notifications',
  'push.allow_desc': 'Lets this device receive calls and pushes while the app is closed.',
  'push.allow_on': 'Notifications on',
  'push.allow_denied': 'Notifications are blocked for this app. Turn them back on in your settings.',
  'push.allow_unsupported': 'This browser can\'t receive notifications.',
  // 토큰은 로그인 시점에만 세션에 실린다 — 늦게 준 권한과 회전된 토큰이 여기서 드러난다
  'push.reauth_hint': 'Notifications are on for this device but this session started without them. Sign in again to turn them on.',

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
  // 스스로 로그아웃한 것이 아닌데 로그인 화면으로 온 경우. 서버는 폐기·만료·로그아웃을 한 코드(UNAUTHORIZED)로만 알려주므로 원인을 단정하지 않는다
  'error.session_ended': 'Your session has ended. Please sign in again.',
  // WebRTC — 계약의 오류 코드가 아니라 클라이언트가 만드는 문구
  'error.camera_permission_denied': 'Prism needs your camera and microphone. Allow access in your browser, then try again.',
  'error.camera_in_use': 'Another app is using your camera. Close it and try again.',
  'error.camera_not_found': 'No camera or microphone found. Connect one, or open Prism on a device that has one.',
  'error.camera_insecure': 'This browser will not share your camera over an insecure connection. Open the site over https (or localhost) and try again.',
  // 통화 대상은 내 세션이다 — 서버가 소유권을 강제하므로 남의 세션 id를 넣어도 이 오류로 끝난다(§6)
  'error.device_offline': 'That device isn’t connected any more. Pick another one.',
  'error.device_busy': 'That device is already on a call.',
  'error.no_answer': 'No answer. The call ended after 45 seconds.',
  'error.device_unreachable': 'That device isn’t connected and has notifications off.',
  'error.call_failed': 'Couldn’t connect the call. Check your network and try again.',
  'error.signaling_lost': 'Lost the connection to the server. Reconnecting…',
};
