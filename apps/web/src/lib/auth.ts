// 액세스 토큰 저장소 (v1: localStorage — plan/auth.md 세션 정책).
// 추후 HttpOnly cookie 전환 검토.
const TOKEN_KEY = 'prism.accessToken';

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};
