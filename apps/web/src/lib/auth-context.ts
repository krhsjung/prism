import { createContext, useContext } from 'react';
import type { User } from './contracts.gen';

// 인증 상태 판별 유니온 — "로딩인데 user가 있는" 류의 불가능 상태를 타입에서 제거.
export type AuthState =
  | { status: 'loading' } // 서버에 쿠키 세션을 확인하는 중
  | { status: 'anonymous' } // 세션 없음/무효
  | { status: 'authenticated'; user: User };

export interface AuthContextValue {
  state: AuthState;
  // 서버가 방금 세션을 발급한 경우(데모 로그인) — 쿠키는 이미 심겼고 사용자만 반영한다.
  signIn(user: User): void;
  // 쿠키 세션을 서버(/auth/me)에 확인해 상태를 갱신한다. 성공 여부 반환.
  // 세션이 HttpOnly 쿠키라 클라이언트는 서버에 묻는 것 외에 알 방법이 없다.
  refresh(): Promise<boolean>;
  // 서버가 쿠키를 지우게 한 뒤 상태를 비운다. 성공 여부 반환.
  // 실패하면 세션이 그대로 살아 있으므로 상태를 비우지 않는다 — 호출부가 알려야 한다.
  signOut(): Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
