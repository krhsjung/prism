import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseWebConfig, type FirebaseWebConfig } from './config';
import { log } from '../log';

// 이 브라우저의 알림 상태. 화면이 그릴 수 있는 갈래가 그대로다.
//
//  - unsupported: 알림·서비스 워커·FCM 중 하나가 없다(비보안 출처 포함) 또는 미설정
//  - default:     아직 묻지 않았다 — 누를 수 있는 줄을 보여 준다
//  - granted:     토큰을 얻을 수 있다
//  - denied:      사용자가 막았다. **다시 물을 수 없다** — 설정으로 안내한다
export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function currentPermission(): PushPermission {
  if (!firebaseWebConfig()) return 'unsupported';
  if (typeof Notification === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const permission = Notification.permission;
  return permission === 'granted' || permission === 'denied'
    ? permission
    : 'default';
}

// 권한을 묻고 등록 토큰을 받는다.
//
// **진입만으로 부르지 않는다.** 자동 프롬프트는 브라우저가 벌주는 패턴이고, 이 저장소가
// 카메라에 세운 규칙("명시적 제스처 뒤에만", plan/webrtc.md §7)과도 같은 줄이다.
// 로그인 화면의 `알림 켜기`와 푸시 화면에서만 부른다.
export async function requestPermissionAndToken(): Promise<string | null> {
  const config = firebaseWebConfig();
  if (!config || currentPermission() === 'unsupported') return null;
  if (!(await isSupported())) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  try {
    // 서비스 워커를 **우리가 등록한다** — 배포 설정을 쿼리로 넘겨야 하기 때문이다
    // (classic 워커는 번들의 env를 읽지 못한다).
    const registration = await navigator.serviceWorker.register(
      serviceWorkerUrl(config),
      { scope: '/' },
    );
    // ⚠️ **활성화까지 기다린다.** `register()`는 등록을 시작한 시점에 이미 돌아오므로,
    // 갓 등록한(또는 방금 해제했다 다시 등록한) 워커는 아직 `active`가 아니다. 그 상태로
    // `getToken`을 부르면 실패하고, 그 세션은 영영 `Notifications off`가 된다 —
    // 개발자 도구에서 워커를 Unregister한 뒤 정확히 이 일이 벌어졌다.
    await navigator.serviceWorker.ready;
    return await getToken(getMessaging(appOf(config)), {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    });
  } catch (e) {
    // 토큰 발급은 네트워크·푸시 서비스에 달려 있다. 실패해도 로그인은 계속돼야 한다 —
    // 그 세션이 `Notifications off`가 될 뿐이고, 화면이 그 사실을 말한다.
    //
    // 다만 **조용히 삼키지는 않는다.** 사유가 없으면 "왜 계속 꺼져 있지"를 화면만 보고
    // 알 수 없다. 개발 빌드에서만 남고 배포에는 아무것도 남지 않는다(lib/log.ts).
    log.error('push.token_failed', {
      reason: e instanceof Error ? e.name : 'unknown',
    });
    return null;
  }
}

function serviceWorkerUrl(config: FirebaseWebConfig): string {
  const params = new URLSearchParams({
    apiKey: config.apiKey,
    projectId: config.projectId,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

// 앱은 한 번만 만든다 — `initializeApp`을 두 번 부르면 던진다.
let app: FirebaseApp | null = null;
function appOf(config: FirebaseWebConfig): FirebaseApp {
  app ??= initializeApp({
    apiKey: config.apiKey,
    projectId: config.projectId,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  return app;
}
