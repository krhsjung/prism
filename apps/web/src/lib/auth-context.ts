import { createContext, useContext } from 'react';
import type { User } from './contracts.gen';

// 인증 상태 판별 유니온 — "로딩인데 user가 있는" 류의 불가능 상태를 타입에서 제거.
export type AuthState =
  | { status: 'loading' } // 서버에 쿠키 세션을 확인하는 중
  | { status: 'anonymous' } // 세션 없음/무효
  | { status: 'authenticated'; user: User };

export interface AuthContextValue {
  state: AuthState;
  // 사용자가 스스로 로그아웃한 것이 **아니라** 서버가 세션을 끊어 로그인 화면으로 온 경우.
  // 이유 없이 대시보드에서 튕기면 무슨 일인지 알 수 없다 — 로그인 화면이 한 줄 알려 준다.
  endedUnexpectedly: boolean;
  // 서버가 방금 세션을 발급한 경우(데모 로그인) — 쿠키는 이미 심겼고 사용자만 반영한다.
  //
  // 토큰 수명은 받지 않는다. 회전을 예약하지 않으므로 여기서 알 필요가 없고, 만료 시각은
  // 로그인 응답을 디코딩하는 그 자리에서 api 계층이 이미 찍어 뒀다(api.ts).
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
