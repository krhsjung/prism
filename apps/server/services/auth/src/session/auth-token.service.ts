import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  decodeJwtPayload,
  toSessionUser,
  type JsonValue,
  type JwtPayload,
  type SocialProvider,
  type User,
} from '@app/common';

// OAuth state(CSRF 방어용 단명 토큰)의 유효 기간과 식별 클레임.
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const STATE_TYP = 'oauth_state';

// 토큰 발급/검증 전담 — 세션 access token과 OAuth state 서명이 모두 여기를 거친다.
// (JwtService를 직접 만지는 유일한 곳)
@Injectable()
export class AuthTokenService {
  constructor(private readonly jwt: JwtService) {}

  signSession(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      provider: user.provider,
      name: user.displayName,
      createdAt: user.createdAt,
    };
    return this.jwt.sign(payload);
  }

  // 서명 검증 + 클레임 디코딩 + 세션 사용자 복원. 유효하지 않으면 throw.
  verifySession(token: string): User {
    // JWT 페이로드는 스펙상 JSON 객체 — 값 단위 검증은 decodeJwtPayload가 수행한다.
    const claims = this.jwt.verify<{ [key: string]: JsonValue }>(token);
    return toSessionUser(decodeJwtPayload(claims));
  }

  // 서버가 서명한 단명 state 토큰. 브라우저별 nonce(쿠키)와 provider를 클레임에 바인딩해,
  // 콜백에서 "이 브라우저가 시작한 이 provider의 흐름"인지까지 검증한다(login-CSRF 방어).
  buildState(provider: SocialProvider, nonce: string): string {
    return this.jwt.sign(
      { typ: STATE_TYP, provider, nonce },
      { expiresIn: OAUTH_STATE_TTL_MS / 1000 },
    );
  }

  // state의 서명·만료·typ·provider를 검증하고 바인딩된 nonce를 반환한다(무효면 null).
  // "이 브라우저가 시작한 흐름인가"의 확인은 호출부 몫 — flow별 쿠키명이 이 nonce로 유도된다.
  stateNonce(
    state: string | undefined,
    provider: SocialProvider,
  ): string | null {
    if (!state) return null;
    try {
      const payload = this.jwt.verify<{ [key: string]: JsonValue }>(state);
      if (payload.typ !== STATE_TYP || payload.provider !== provider) {
        return null;
      }
      return typeof payload.nonce === 'string' && payload.nonce
        ? payload.nonce
        : null;
    } catch {
      return null;
    }
  }
}
