/// <reference types="vite/client" />

// 앱이 읽는 Vite env를 선언해 import.meta.env 접근에 단언이 필요 없게 한다.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  // 세션 소켓 주소. auth API와 **다른 포트**라(로컬 3000 vs 3002) 유도할 수 없다.
  // 운영에서는 반드시 wss:// — 세션 쿠키가 __Host- 접두어라 Secure를 요구한다.
  readonly VITE_SOCKET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
