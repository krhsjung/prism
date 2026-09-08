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
  'common.retry': '다시 시도',

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

  // ── webrtc ──
  // WebRTC 1:1 통화 — 통화 상대는 **내 활성 세션**이다. 방·코드·링크 공유는 없다(plan/webrtc.md §4)
  'webrtc.title': 'WebRTC',
  // 로비 — 장치 확인 + 걸 대상 고르기
  'webrtc.lobby_title': '통화 시작하기',
  'webrtc.lobby_desc': '로그인된 기기 중 하나를 골라 거세요. 카메라와 마이크는 통화가 시작될 때 켜집니다.',
  'webrtc.camera': '카메라',
  'webrtc.microphone': '마이크',
  'webrtc.camera_front': '전면 카메라',
  'webrtc.camera_back': '후면 카메라',
  'webrtc.camera_other': '카메라 {name}',
  'webrtc.camera_simulator': '시뮬레이터 카메라',
  'webrtc.mic_builtin': '내장 마이크',
  'webrtc.mic_wired': '유선 헤드셋',
  'webrtc.mic_bluetooth': '블루투스 헤드셋',
  'webrtc.mic_usb': 'USB 마이크',
  'webrtc.mic_other': '마이크 {name}',
  // 목록은 대시보드와 같은 GET /auth/sessions에서 온다 — 기기 종류 라벨도 dashboard.device_*를 그대로 쓴다
  'webrtc.devices': '내 기기',
  // 소켓이 붙어 있으면 바로 울리고(isConnected) 아니면 알림으로 깨운다(pushRegistered).
  // 둘 다 없는 세션만 걸 수 없다 — 그 줄에는 버튼 대신 이유를 둔다
  'webrtc.devices_desc': '연결된 기기는 바로 울립니다. 나머지는 알림을 받습니다.',
  'webrtc.call': '걸기',
  // 푸시 경로임을 행이 말한다 — 기다리는 시간이 왜 긴지를 화면이 설명해야 한다
  'webrtc.will_notify': '알림을 보냅니다',
  'webrtc.notifications_off': '알림 꺼짐',
  // 다른 기기가 없어도 막다른 화면이 되지 않게 — 탭을 하나 더 열면 목록에 나타난다
  'webrtc.no_other_devices': '다른 기기가 로그인되어 있지 않습니다. 탭을 하나 더 열면 자신에게 걸 수 있습니다.',
  // 현재 세션 줄은 루프백이다 — 시그널링 서버를 거치지 않고 한 탭 안에서 두 PeerConnection을 잇는다
  'webrtc.this_tab': '현재 탭',
  'webrtc.loopback': '루프백 테스트',
  'webrtc.test': '시험',
  'webrtc.loopback_note': '루프백은 이 탭 안에서만 돕니다 — 시그널링 서버를 거치지 않습니다.',
  // 미디어가 서버를 지나지 않는 것이 이 슬라이스의 핵심이라 화면에도 한 줄로 적는다
  'webrtc.p2p_note': '영상과 음성은 기기 사이로 바로 갑니다. 녹화하거나 저장하지 않습니다.',
  // 거는 쪽 — 상대가 받을 때까지. 취소는 common.cancel을 쓴다
  // 붙은 뒤 카드 머리의 제목. 상대가 누구인지는 타일의 이름표가 말하므로 여기서 되풀이하지 않는다
  'webrtc.in_call': '통화 중',
  'webrtc.calling': '{device}에 거는 중…',
  'webrtc.ringing_desc': '상대 기기가 받기를 기다리는 중입니다.',
  // 벨은 유한하다 — 서버가 45초 뒤 양쪽을 끊는다(plan/webrtc.md §6). 숫자는 이 한 줄에만 둔다
  'webrtc.ring_timeout_note': '45초가 지나면 호출이 끝납니다.',
  // 알림으로 깨운 경우 — 기기가 열릴 때까지 기다리므로 화면이 그렇게 말한다
  'webrtc.notified_desc': '{device}에 알림을 보냈습니다. 45초 안에 받아야 합니다.',
  'webrtc.tile_notified': '기기가 열리기를 기다리는 중…',
  // 받는 쪽 — 소켓이 앱 전체에 붙어 있어 어느 화면에 있든 뜬다
  'webrtc.incoming_title': '걸려 오는 통화',
  'webrtc.incoming_body': '{device}에서 걸려 왔습니다.',
  'webrtc.accept': '받기',
  'webrtc.decline': '거절',
  'webrtc.declined': '상대 기기가 통화를 거절했습니다.',
  // 알림을 늦게 열었다 — 통화는 이미 서버가 끊었다. 빈 화면 대신 무슨 일이었는지 적는다.
  // 여기에 초를 되풀이하지 않는다: 상한은 호출 중 화면(ring_timeout_note)이 이미 말했다
  'webrtc.expired_title': '이미 끝난 통화입니다',
  'webrtc.expired_body': '{device}에서 걸었지만 통화는 이미 끝났습니다. 원하면 다시 걸어 보세요.',
  // 통화 컨트롤 — 아이콘 전용 버튼이라 이 문구는 접근성 이름으로만 쓰인다(§4)
  'webrtc.mute': '마이크 끄기',
  'webrtc.unmute': '마이크 켜기',
  'webrtc.camera_off': '카메라 끄기',
  'webrtc.camera_on': '카메라 켜기',
  'webrtc.end_call': '통화 종료',
  // 타일 라벨 — 상대는 내 기기이므로 이름은 dashboard.device_*가 준다. 여기 있는 것은 내 쪽뿐이다
  'webrtc.you': '나',
  // 루프백에서는 두 타일이 같은 카메라를 나눠 쓴다 — 그것을 라벨이 말한다
  'webrtc.loopback_peer': '루프백',
  // 연결 상태 배지 — Atom/Badge의 기존 변형에 그대로 매핑된다(§4)
  'webrtc.status_ringing': '호출 중',
  'webrtc.status_notified': '알림 보냄',
  'webrtc.status_connecting': '연결 중',
  'webrtc.status_connected': '연결됨',
  'webrtc.status_reconnecting': '재연결 중',
  'webrtc.status_failed': '연결 실패',
  // 타일 안의 한 줄 — Molecule/VideoTile의 State 변형과 1:1
  'webrtc.tile_ringing': '응답을 기다리는 중…',
  'webrtc.tile_connecting': '연결하는 중…',
  'webrtc.tile_reconnecting': '다시 연결하는 중…',
  'webrtc.tile_camera_off': '카메라가 꺼져 있습니다',
  'webrtc.tile_peer_camera_off': '상대의 카메라가 꺼져 있습니다',
  'webrtc.tile_camera_denied': '카메라 권한 없음',
  'webrtc.tile_camera_missing': '카메라 없음',
  'webrtc.tile_camera_busy': '카메라 사용 중',
  'webrtc.tile_camera_blocked': '카메라를 쓸 수 없습니다',
  // 아직 카메라를 켜지 않은 상태 — 권한을 통화 시작 시점으로 미뤘기 때문이다.
  // 위 tile_camera_* 넷과 다르다: 이건 실패가 아니라 아직 묻지 않은 것이다.
  'webrtc.tile_camera_idle': '통화가 시작되면 카메라가 켜집니다',
  // 아직 권한을 준 적이 없어 장치 이름조차 못 읽는 경우 — 미리 켜 보고 싶은 사람을 위한 문
  'webrtc.preview_start': '카메라 켜기',
  // 상대가 끊으면 로비로 돌아간다 — 방이 없으므로 남아서 기다릴 자리도 없다(§4)
  'webrtc.peer_left': '상대 기기가 통화를 끊었습니다.',
  // 진단 패널 — 기본은 접혀 있다. 라벨은 Manrope · 값은 모노(JetBrains Mono)로 그린다(§4)
  'webrtc.diagnostics': '진단',
  'webrtc.diag_show': '진단 열기',
  'webrtc.diag_hide': '진단 닫기',
  // 단위(ms · kbps · fps · %)는 번역하지 않는다 — 값과 함께 클라이언트가 만든다
  'webrtc.diag_quality': '품질',
  'webrtc.stat_rtt': '왕복 지연',
  'webrtc.stat_jitter': '지터',
  'webrtc.stat_packet_loss': '패킷 손실',
  'webrtc.stat_sending': '보내는 중',
  'webrtc.stat_receiving': '받는 중',
  'webrtc.stat_video': '영상',
  // 값이 없으면 0이 아니라 —를 그린다. Safari는 getStats()의 일부 필드를 주지 않는다
  'webrtc.stat_unavailable': '—',
  'webrtc.diag_connection': '연결',
  // Path — 미디어가 직접 가는지 TURN을 거치는지. TURN을 v1부터 넣은 결정(§9-2)이
  // 값을 하는지 이 한 줄이 증명한다. Relay는 실패가 아니라 비싼 성공이라 Warning이다
  'webrtc.ice_path': '경로',
  'webrtc.ice_path_direct': '직접 연결',
  'webrtc.ice_path_reflexive': 'STUN 경유',
  'webrtc.ice_path_relay': 'TURN 릴레이',
  'webrtc.ice_path_loopback': '루프백',
  'webrtc.ice_local': '로컬 후보',
  'webrtc.ice_remote': '원격 후보',
  'webrtc.ice_state': 'ICE 상태',
  'webrtc.dtls_state': 'DTLS 상태',
  'webrtc.connected_for': '연결 유지',
  // 후보 주소는 화면에 띄우지 않는다 — 타입·전송까지만(§7)
  'webrtc.ice_address_hidden': '주소 숨김',
  'webrtc.diag_settings': '연결 설정',
  'webrtc.ice_policy': 'ICE 정책',
  'webrtc.ice_policy_all': 'STUN + TURN',
  'webrtc.ice_policy_relay': 'TURN만 사용',
  'webrtc.ice_policy_note': '바꾸면 통화가 다시 연결됩니다. “TURN만 사용”은 미디어를 릴레이로 강제해, 경로가 바뀌는 것을 눈으로 볼 수 있습니다.',
  // 로그에 레벨(DEBUG/INFO/WARN/ERROR)을 두지 않는다 — 원소가 §6 계약의 메시지뿐이라
  // 네 레벨로 나누면 필터가 원소보다 커진다. 실제로 헷갈리는 축은 방향(누가 offer를 냈나)이다
  'webrtc.diag_signaling': '시그널링',
  'webrtc.log_sent': '보냄',
  'webrtc.log_received': '받음',
  'webrtc.log_copy': '로그 복사',
  'webrtc.log_clear': '지우기',
  'webrtc.log_empty': '아직 없습니다.',
  // 루프백은 시그널링을 타지 않으므로 로그가 비어 있는 것이 정상이다
  'webrtc.log_loopback': '루프백은 시그널링 서버를 쓰지 않습니다.',

  // ── push ──
  // 푸시 — 내 기기에 알림을 보내 보는 화면(plan/push.md)
  'push.title': '푸시',
  'push.desc': '기기를 골라 알림을 보내 보세요.',
  // 카드 바닥 한 줄 — 토큰이 어디에 사는지 말한다(§5-3). 목록 응답에 토큰이 실리지 않는 이유이기도 하다
  'push.foot': '등록 토큰은 세션 안에 있고 서버 밖으로 나가지 않습니다. 로그아웃하면 함께 사라집니다.',
  // 목록은 대시보드·WebRTC 로비와 같은 데이터다. 다른 것은 할 수 있는 일뿐이다
  'push.devices': '기기로 보내기',
  'push.devices_desc': '등록된 기기가 알림을 받을 수 있습니다. 나머지는 아직입니다.',
  // 여럿 고를 수 있다. 같은 설치가 여러 세션에 걸리면 서버가 합쳐 한 번만 보낸다(§5-10)
  'push.select_all': '모두 선택',
  'push.clear_all': '해제',
  'push.selected_count': '{count}개 선택됨',
  // 고른 줄은 버튼 글자로 말한다 — 목록에 라디오를 따로 두면 누를 곳이 둘이 된다
  'push.select': '선택',
  'push.selected': '선택됨',
  // 제목은 선택이다 — 비우면 서버가 받는 기기의 언어로 그린다(server.csv의 demo_title)
  'push.title_label': '제목',
  'push.title_placeholder': '비우면 기본 제목이 쓰입니다',
  'push.message_label': '문구',
  'push.message_placeholder': '기기에 뜰 문구를 적으세요',
  'push.send': '보내기',
  // 알림이 실을 수 있는 것들 — 셋 다 선택이다(§5-11 ~ §5-13)
  'push.image_label': '이미지',
  'push.image_hint': '공개 https 주소입니다. 아래 샘플은 이 사이트가 서빙합니다.',
  'push.image_placeholder': 'https://example.com/photo.jpg',
  'push.image_none': '이미지 없음',
  'push.link_label': '링크',
  'push.link_hint': '알림을 누르면 여는 곳입니다.',
  'push.link_placeholder': 'https://example.com',
  'push.actions_label': '버튼',
  'push.actions_none': '없음',
  'push.actions_open': '열기',
  'push.actions_open_dismiss': '열기와 닫기',
  // 알림에 붙는 버튼의 문구. **서버가 보내지 않는다** — iOS는 등록 시점에 굳어 요청의 언어를 알 수 없다(§5-13)
  'push.action_open': '열기',
  'push.action_dismiss': '닫기',
  // FCM이 알려 주는 것은 받아들였다까지다 — 배달도 열람도 알 수 없다
  'push.result_accepted': '보냈습니다. 기기가 깨어 있으면 알림이 뜹니다.',
  // 같은 설치가 여러 세션에 걸렸다 — 실패가 아니라 한 번만 보냈다는 사실이다(§5-5)
  'push.result_duplicate': '다른 줄과 같은 기기입니다 — 한 번만 보냈습니다.',
  'push.result_unknown': '그 세션이 사라졌습니다. 목록을 새로 고치세요.',
  'push.result_no_token': '그 기기에는 알림 토큰이 없습니다. 그 기기에서 다시 로그인하면 켜집니다.',
  'push.result_rejected': 'Firebase가 그 기기의 토큰을 거부했습니다. 그 기기에서 다시 로그인하세요.',
  // Android 알림 채널 이름 — 시스템 설정에 그대로 보인다. 통화와 데모를 가르는 이유는 하나를 끌 때 둘 다 꺼지지 않게 하려는 것이다
  'push.channel_calls': '통화',
  'push.channel_general': '알림',
  // 권한은 로그인 화면에서 먼저 받는다 — 토큰이 로그인 요청에 실려야 하기 때문이다(§5-2)
  'push.allow': '알림 켜기',
  'push.allow_desc': '앱이 닫혀 있어도 이 기기가 통화와 푸시를 받게 합니다.',
  'push.allow_on': '알림 켜짐',
  'push.allow_denied': '이 앱의 알림이 차단돼 있습니다. 설정에서 다시 켜 주세요.',
  'push.allow_unsupported': '이 브라우저는 알림을 받을 수 없습니다.',
  // 토큰은 로그인 시점에만 세션에 실린다 — 늦게 준 권한과 회전된 토큰이 여기서 드러난다
  'push.reauth_hint': '이 기기의 알림은 켜져 있지만 이 세션은 알림 없이 시작됐습니다. 다시 로그인하면 켜집니다.',

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
  // WebRTC — 계약의 오류 코드가 아니라 클라이언트가 만드는 문구
  'error.camera_permission_denied': '카메라와 마이크 권한이 필요합니다. 브라우저에서 허용한 뒤 다시 시도해 주세요.',
  'error.camera_in_use': '다른 앱이 카메라를 쓰고 있습니다. 종료한 뒤 다시 시도해 주세요.',
  'error.camera_not_found': '카메라와 마이크를 찾지 못했습니다. 연결하거나, 카메라가 있는 기기에서 열어 주세요.',
  'error.camera_insecure': '보안 연결이 아니면 브라우저가 카메라를 내주지 않습니다. https(또는 localhost) 주소로 열고 다시 시도해 주세요.',
  // 통화 대상은 내 세션이다 — 서버가 소유권을 강제하므로 남의 세션 id를 넣어도 이 오류로 끝난다(§6)
  'error.device_offline': '그 기기는 더 이상 연결되어 있지 않습니다. 다른 기기를 골라 주세요.',
  'error.device_busy': '그 기기는 이미 통화 중입니다.',
  'error.no_answer': '45초 동안 응답이 없어 통화가 끝났습니다.',
  'error.device_unreachable': '그 기기는 연결되어 있지 않고 알림도 꺼져 있습니다.',
  'error.call_failed': '통화를 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.',
  'error.signaling_lost': '서버와의 연결이 끊겼습니다. 다시 연결하는 중…',
};
