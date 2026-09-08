import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseWebConfig, type FirebaseWebConfig } from './config';

// 이 브라우저의 알림 상태. 화면이 그릴 수 있는 갈래가 그대로다.
//
//  - unsupported: 알림·서비스 워커·FCM 중 하나가 없다(비보안 출처 포함) 또는 미설정
//  - default:     아직 묻지 않았다 — 누를 수 있는 줄을 보여 준다
//  - granted:     토큰을 얻을 수 있다
//  - denied:      사용자가 막았다. **다시 물을 수 없다** — 설정으로 안내한다
export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

// 로그인 요청에 실어 보낸 토큰. **회전을 알아채려고 남긴다** — 토큰은 로그인 시점에만
// 세션에 실리므로(plan/push.md §5-2), 지금 토큰이 이 값과 다르면 그 세션은 죽은 토큰을
// 들고 있다. 화면은 그때 "다시 로그인하세요" 한 줄을 띄운다.
const SENT_TOKEN_KEY = 'prism.push.sentToken';

export function readSentToken(): string | null {
  try {
    return localStorage.getItem(SENT_TOKEN_KEY);
  } catch {
    // 사생활 보호 모드·저장 차단. 회전을 못 알아채는 것뿐이라 조용히 넘어간다.
    return null;
  }
}

export function rememberSentToken(token: string): void {
  try {
    localStorage.setItem(SENT_TOKEN_KEY, token);
  } catch {
    /* 위와 같다 */
  }
}

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
    return await getToken(getMessaging(appOf(config)), {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    });
  } catch {
    // 토큰 발급은 네트워크·푸시 서비스에 달려 있다. 실패해도 로그인은 계속돼야 한다 —
    // 그 세션이 `Notifications off`가 될 뿐이고, 화면이 그 사실을 말한다.
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
