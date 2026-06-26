export type AuthProvider = 'google' | 'apple' | 'demo';

// 클라이언트에 반환되는 사용자 모델. 개인정보 미저장 정책에 따라 email은 없고,
// displayName은 DB가 아니라 세션(JWT)에서만 채워진다. (plan/auth.md 참고)
export interface User {
  id: string;
  provider: AuthProvider;
  displayName: string;
  createdAt: string;
}

export interface JwtPayload {
  sub: string;
  provider: AuthProvider;
  name: string;
  createdAt: string;
}
