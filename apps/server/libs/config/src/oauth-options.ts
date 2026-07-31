// 소셜 OAuth 설정 옵션 — PrismConfigService가 만들어 반환하는 타입은 config가 소유한다.
export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AppleOAuthOptions {
  teamId: string; // Apple Developer Team ID
  clientId: string; // Services ID (웹), client_secret JWT의 sub
  keyId: string; // 비공개 키의 Key ID
  privateKey: string; // .p8 키 내용 (env에서 \n 이스케이프 가능)
  bundleId?: string; // iOS/Android 네이티브 audience (옵션)
  redirectUri: string;
}
