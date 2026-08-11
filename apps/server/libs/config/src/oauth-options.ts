// 소셜 OAuth 설정 옵션 — PrismConfigService가 만들어 반환하는 타입은 config가 소유한다.
export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  // 네이티브(Android/iOS) id_token의 audience 후보. google_sign_in이 serverClientId로
  // 받은 id_token은 aud가 웹 clientId지만, 플랫폼별 클라이언트 ID로 받는 구성도 있어
  // 추가 audience를 허용한다. 웹 clientId는 항상 후보에 포함된다.
  nativeAudiences: string[];
}

export interface KakaoOAuthOptions {
  clientId: string; // Kakao REST API 키
  clientSecret: string; // 옵션(콘솔에서 활성화한 경우) — 비활성이면 빈 문자열
  redirectUri: string;
  // Kakao 앱의 숫자 app_id. 네이티브 로그인에서 access token이 **우리 앱** 발급인지
  // access_token_info의 app_id와 대조하는 데 쓴다(다른 앱 토큰 재사용 방어). 미설정이면
  // 네이티브 경로가 비활성(웹 redirect 로그인에는 필요 없음).
  appId?: string;
}

export interface AppleOAuthOptions {
  teamId: string; // Apple Developer Team ID
  clientId: string; // Services ID (웹), client_secret JWT의 sub
  keyId: string; // 비공개 키의 Key ID
  privateKey: string; // .p8 키 내용 (env에서 \n 이스케이프 가능)
  bundleId?: string; // iOS/Android 네이티브 audience (옵션)
  redirectUri: string;
}
