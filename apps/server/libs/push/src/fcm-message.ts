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

// 알림 채널은 **서버가 고르지 않는다.** Android에 `notification` 블록을 보내지 않으므로
// 채널을 실을 자리도 없고, 앱이 `kind`를 보고 스스로 고른다(`PrismMessagingService`).
// 통화와 데모가 다른 채널인 이유는 그대로다 — 하나를 끄면 둘 다 꺼지지 않게.

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
      // ⚠️ **최상위 `notification`을 두지 않는다**(plan/push.md §5-20).
      //
      // FCM v1에서 최상위 `notification`은 **모든 플랫폼**에 적용된다. 그러면 Android는
      // 앱이 뒤에 있을 때 FCM SDK가 그 블록으로 알림을 대신 그리고 `onMessageReceived`를
      // 부르지 않는다 — 그 알림에는 버튼이 붙지 않고(`AndroidNotification`에 버튼 필드가
      // 없다) 아이콘도 매니페스트 기본값으로 떨어져, **앞에서 받은 것과 뒤에서 받은 것이
      // 서로 다른 알림이 된다.** 실제로 기기에서 그렇게 보였다.
      //
      // 그래서 그릴 재료를 플랫폼마다 **그 플랫폼이 읽는 자리에** 싣는다:
      //   · Android — `data`만. 앞이든 뒤든 앱이 한 코드로 그린다.
      //   · iOS     — `apns.payload.aps.alert`. 여전히 OS가 그린다(무음 푸시는 알림을
      //               띄우지 못한다 — plan/webrtc.md §9).
      //   · 웹       — `webpush.notification`. 서비스 워커가 그린다.
      //
      // FCM v1은 data 값이 전부 문자열이어야 한다.
      //
      // 링크는 **기본 주소까지** 싣는다 — 세 플랫폼이 같은 곳으로 간다: 통화는 통화 화면,
      // 데모는 푸시 화면(웹은 `/push`를 열고, 네이티브는 우리 주소를 앱 안의 그 화면으로
      // 연다 — 딥링크, plan/push.md §5-11). 사람이 적은 링크가 있으면 그것이 이긴다.
      data: dataOf(payload, text, link, actions),
      android: {
        // **data 메시지는 우선순위가 높아야 제때 닿는다.** 보통 우선순위의 data 메시지는
        // Doze에서 유지 보수 창까지 미뤄지는데, 지금은 앱이 그리는 알림이 곧 도착이다 —
        // 미뤄지면 알림 자체가 늦는다. 매번 눈에 보이는 알림을 띄우므로 높은 우선순위를
        // 쓰는 것이 FCM이 요구하는 조건 안이다(보이지 않는 메시지에 쓰면 강등된다).
        priority: 'high',
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
            // 최상위 `notification`이 없으므로 **iOS에 보일 문구는 여기 적는다.** 이것이
            // 없으면 alert 푸시가 아니라 조용히 사라지는 푸시가 된다.
            alert: { title: text.title, body: text.body },
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
        // 서비스 워커가 그린다. 문구는 최상위 `notification`에서 오던 것을 여기로 옮겼다.
        // 버튼이 있는 알림은 스스로 사라지지 않게 한다 — 누를 것이 있는데 지나가
        // 버리면 버튼을 둔 의미가 없다. **버튼 문구는 서버가 보내지 않는다**: 서비스
        // 워커가 자기 언어로 그린다.
        notification: {
          title: text.title,
          body: text.body,
          ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
          ...(actions === 'none' ? {} : { requireInteraction: true }),
        },
        // 누르면 여는 주소. 서비스 워커의 클릭 처리는 `data.link`를 본다 — 같은 값이다.
        fcm_options: { link },
      },
    },
  };
}

/**
 * 기기 하나가 받는 payload의 크기(바이트) — FCM/APNs의 4 KB 한도에 걸리는 값이다.
 *
 * FCM은 플랫폼마다 그 플랫폼의 블록만 전하므로 메시지 전체가 아니라 **가장 큰 플랫폼 몫**을
 * 잰다. 보내는 쪽(`PushSender`)과 같은 재료로 같은 함수(`buildFcmMessage`)를 지어 재므로
 * 검증과 전송이 어긋나지 않는다. 토큰은 한도에 들지 않아 비워 둔다.
 */
export function deliveredBytes(
  text: PushText,
  payload: PushPayload,
  webLink: string,
): number {
  const { message } = buildFcmMessage('', text, payload, webLink);
  const bytes = (part: object) => Buffer.byteLength(JSON.stringify(part));
  return Math.max(
    // Android — data만 받는다.
    bytes({ data: message.data, android: message.android }),
    // iOS — aps와 data 키가 한 payload에 합쳐진다.
    bytes({ ...message.apns.payload, ...message.data }),
    // 웹 — webpush 블록과 data.
    bytes({ data: message.data, webpush: message.webpush }),
  );
}

function dataOf(
  payload: PushPayload,
  text: PushText,
  link: string,
  actions: PushActionSet,
): { [key: string]: string } {
  const data: { [key: string]: string } = {
    [PUSH_DATA_KEYS.KIND]: payload.kind,
    // Android가 알림을 그리는 재료다 — 그쪽에는 `notification` 블록이 없다.
    [PUSH_DATA_KEYS.TITLE]: text.title,
    [PUSH_DATA_KEYS.BODY]: text.body,
    // 네이티브는 `webpush.fcm_options`를 보지 못한다 — 링크는 여기로 간다(기본 주소 포함).
    [PUSH_DATA_KEYS.LINK]: link,
    [PUSH_DATA_KEYS.ACTIONS]: actions,
  };
  if (payload.imageUrl) data[PUSH_DATA_KEYS.IMAGE] = payload.imageUrl;
  if (payload.callId) data[PUSH_DATA_KEYS.CALL_ID] = payload.callId;
  if (payload.device) data[PUSH_DATA_KEYS.DEVICE] = payload.device;
  return data;
}

// FCM HTTP v1의 `Message`(우리가 쓰는 부분만). 라이브러리 타입을 끌어오지 않으려고
// 여기 좁게 적는다 — 보내는 필드가 늘면 이 타입이 먼저 막는다.
export interface FcmMessage {
  token: string;
  // **최상위 `notification`은 없다** — 두면 Android가 앱이 뒤에 있을 때 FCM SDK에게
  // 그리기를 넘긴다(위 buildFcmMessage 주석). 타입에서도 빼 두어 다시 들어오지 않게 한다.
  data: { [key: string]: string };
  android: {
    priority: 'high';
  };
  apns: {
    headers: { [header: string]: string };
    payload: {
      aps: {
        alert: { title: string; body: string };
        sound: string;
        'mutable-content'?: number;
        category?: string;
      };
    };
    fcm_options?: { image: string };
  };
  webpush: {
    notification: {
      title: string;
      body: string;
      image?: string;
      requireInteraction?: boolean;
    };
    fcm_options: { link: string };
  };
}
