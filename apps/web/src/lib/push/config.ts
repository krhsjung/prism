// 이 배포의 Firebase 웹 설정. **비밀이 아니다** — 클라이언트 번들과 서비스 워커에
// 그대로 실리는 값이다. 그래도 레포에 두지 않는 이유는 배포마다 다르기 때문이다
// (VITE_API_URL·VITE_SOCKET_URL과 같은 규칙).
export interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  // 웹 푸시 인증서(VAPID) 공개 키. 이것이 없으면 `getToken`이 토큰을 주지 않는다.
  vapidKey: string;
}

// **일부만 설정된 상태를 표현할 수 없게 한다.** 하나라도 없으면 null이고, 화면은
// "이 브라우저는 알림을 받을 수 없습니다"로 정직하게 접힌다 — 서버가 셋을 함께
// 요구하는 것과 같은 판단이다(app-config.ts의 loadFcmConfig).
export function firebaseWebConfig(): FirebaseWebConfig | null {
  const env = import.meta.env;
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
    vapidKey: env.VITE_FIREBASE_VAPID_KEY ?? '',
  };
  return Object.values(config).every(Boolean) ? config : null;
}
