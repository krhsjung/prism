/// <reference types="vite/client" />

// 앱이 읽는 Vite env를 선언해 import.meta.env 접근에 단언이 필요 없게 한다.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
