import {
  PUSH_DATA_KEYS,
  type DeviceKind,
  type PushActionSet,
  type PushKind,
} from '@app/common';

// 알림에 실리는 문구. **서버가 그린다** — 받는 기기의 언어는 보내는 쪽의 요청에서
// 알 수 없어서, 세션에 담아 둔 언어로 여기서 렌더한 뒤 넘어온다(plan/push.md §5-7).
export interface PushText {
  title: string;
  body: string;
}

// 알림에 실리는 데이터. **이것이 페이로드의 전부다.**
//
// SDP·ICE·세션 id·사용자 정보는 넣지 않는다 — 알림은 잠금화면에 뜨고 OS 로그에 남는다
// (plan/webrtc.md §7). 통화를 가리키는 값은 `callId`뿐이고, 그것만으로는 아무것도 할 수
// 없다: 앱이 소켓을 붙여 `resume`을 물어야 하고, 서버는 그때 당사자인지 다시 확인한다.
export interface PushPayload {
  kind: PushKind;
  // 통화 알림에만 있다.
  callId?: string;
  // 건 기기의 **종류**. 화면이 "iPhone에서 걸었습니다"를 그리는 데 쓴다 —
  // 알림 본문에는 넣지 않는다(기기 라벨 9개가 서버 문구 마스터에 복제되지 않도록).
  device?: DeviceKind;
  // 알림에 함께 실을 것들. **셋 다 선택이다** — 없으면 문구만 있는 알림이다.
  //
  // 서버는 이 주소들을 **가져오지 않는다**: 이미지는 FCM이 내려받아 붙이고, 링크는
  // 기기가 연다. 그래서 서버 쪽에 SSRF 표면이 생기지 않는다(plan/push.md §5-11).
  imageUrl?: string;
  link?: string;
  actions?: PushActionSet;
}

// 알림 채널. Android는 채널마다 사용자가 소리·중요도를 따로 끌 수 있으므로,
// 통화와 데모를 한 채널에 넣으면 하나를 끄면 둘 다 꺼진다.
export const CHANNEL_CALLS = 'prism_calls';
export const CHANNEL_GENERAL = 'prism_general';

// iOS가 미리 등록해 두는 카테고리 식별자(`UNNotificationCategory`).
//
// **조합마다 하나씩 있다** — iOS는 등록된 카테고리만 쓸 수 있어, 서버가 그때그때
// 만든 버튼 목록을 보낼 방법이 없다. 세 플랫폼이 같은 `PushActionSet`을 보되
// iOS만 이 이름으로 번역해 받는다.
export const APNS_CATEGORIES: { [S in PushActionSet]: string | null } = {
  none: null,
  open: 'prism.open',
  'open-dismiss': 'prism.open_dismiss',
};

// FCM HTTP v1 `messages:send`의 body.
//
// **순수 함수다.** 페이로드가 여기서만 만들어져야 "무엇이 알림에 실리는가"를 스펙
// 하나로 못박을 수 있다.
export function buildFcmMessage(
  token: string,
  text: PushText,
  payload: PushPayload,
  // 웹이 알림을 눌렀을 때 열 기본 주소. `payload.link`가 있으면 그쪽이 이긴다.
  webLink: string,
): { message: FcmMessage } {
  const isCall = payload.kind === 'call';
  const link = payload.link ?? webLink;
  const actions = payload.actions ?? 'none';
  const category = APNS_CATEGORIES[actions];

  return {
    message: {
      token,
      // **notification 메시지다(data-only가 아니다).** 앱이 꺼져 있어도 OS가 그려 주고,
      // iOS 무음 푸시는 애초에 알림을 띄우지 못한다(plan/webrtc.md §9).
      notification: {
        title: text.title,
        body: text.body,
        // 한 자리에 두면 FCM이 세 플랫폼으로 펼쳐 준다. iOS만 그것으로 부족해
        // 아래 `mutable-content`와 확장이 함께 필요하다.
        ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
      },
      // FCM v1은 data 값이 전부 문자열이어야 한다.
      data: dataOf(payload, link, actions),
      android: {
        // 통화는 사람을 기다리게 하는 알림이라 Doze에서도 지금 떠야 한다.
        // 데모 알림은 그럴 이유가 없어 기본 우선순위로 둔다(할당량은 아껴 둔다).
        priority: isCall ? 'high' : 'normal',
        notification: { channel_id: isCall ? CHANNEL_CALLS : CHANNEL_GENERAL },
      },
      apns: {
        // alert 타입 + 우선순위. `content-available`은 두지 않는다 —
        // 무음 푸시는 저전력 모드·강제 종료에서 조용히 사라진다.
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': isCall ? '10' : '5',
        },
        payload: {
          aps: {
            sound: 'default',
            // **이미지는 이 한 줄이 있어야 보인다.** iOS는 알림을 그리기 전에
            // Notification Service Extension을 부르는데, 그 확장이 불리는 조건이
            // `mutable-content: 1`이다. 없으면 확장이 있어도 이미지가 빠진 채 뜬다.
            ...(payload.imageUrl ? { 'mutable-content': 1 } : {}),
            // 버튼은 **미리 등록된 카테고리**로 고른다.
            ...(category ? { category } : {}),
          },
        },
        // FCM의 iOS 확장 헬퍼가 이 주소를 읽어 이미지를 붙인다.
        ...(payload.imageUrl
          ? { fcm_options: { image: payload.imageUrl } }
          : {}),
      },
      webpush: {
        // 버튼이 있는 알림은 스스로 사라지지 않게 한다 — 누를 것이 있는데 지나가
        // 버리면 버튼을 둔 의미가 없다. 문구는 **서버가 보내지 않는다**: 서비스
        // 워커가 자기 언어로 그린다.
        ...(actions === 'none'
          ? {}
          : { notification: { requireInteraction: true } }),
        // 누르면 여는 주소. 서비스 워커의 클릭 처리도 같은 값을 본다.
        fcm_options: { link },
      },
    },
  };
}

function dataOf(
  payload: PushPayload,
  link: string,
  actions: PushActionSet,
): { [key: string]: string } {
  const data: { [key: string]: string } = {
    [PUSH_DATA_KEYS.KIND]: payload.kind,
    // 네이티브는 `webpush.fcm_options`를 보지 못한다 — 링크는 여기로 간다.
    [PUSH_DATA_KEYS.LINK]: link,
    [PUSH_DATA_KEYS.ACTIONS]: actions,
  };
  if (payload.callId) data[PUSH_DATA_KEYS.CALL_ID] = payload.callId;
  if (payload.device) data[PUSH_DATA_KEYS.DEVICE] = payload.device;
  return data;
}

// FCM HTTP v1의 `Message`(우리가 쓰는 부분만). 라이브러리 타입을 끌어오지 않으려고
// 여기 좁게 적는다 — 보내는 필드가 늘면 이 타입이 먼저 막는다.
export interface FcmMessage {
  token: string;
  notification: { title: string; body: string; image?: string };
  data: { [key: string]: string };
  android: {
    priority: 'high' | 'normal';
    notification: { channel_id: string };
  };
  apns: {
    headers: { [header: string]: string };
    payload: {
      aps: {
        sound: string;
        'mutable-content'?: number;
        category?: string;
      };
    };
    fcm_options?: { image: string };
  };
  webpush: {
    notification?: { requireInteraction: boolean };
    fcm_options: { link: string };
  };
}
