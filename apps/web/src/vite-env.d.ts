/// <reference types="vite/client" />

// 앱이 읽는 Vite env를 선언해 import.meta.env 접근에 단언이 필요 없게 한다.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  // 세션 소켓 주소. auth API와 **다른 포트**라(로컬 3000 vs 3002) 유도할 수 없다.
  // 운영에서는 반드시 wss:// — 세션 쿠키가 __Host- 접두어라 Secure를 요구한다.
  readonly VITE_SOCKET_URL?: string;
  // Firebase 웹 설정 + 웹 푸시 인증서(VAPID) 공개 키.
  //
  // **비밀이 아니다** — 번들과 서비스 워커에 그대로 실린다. 레포에 두지 않는 이유는
  // 배포마다 다르기 때문이고, 하나라도 빠지면 앱이 푸시를 꺼진 것으로 다룬다.
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_VAPID_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
