// provider 검증 후 추출한 최소 정보. PII 미저장 정책상 DB에는 sub만,
// displayName은 세션(JWT) 전용이다.
export interface OAuthProfile {
  /** provider의 안정적 사용자 식별자(OAuth sub) — core.users.provider_id */
  sub: string;
  /** 토큰/userinfo에서 얻은 표시 이름(있을 때만) — 세션 한정, 영구 저장 안 함 */
  displayName?: string;
}
