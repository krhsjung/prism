import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  SOCIAL_FLOWS,
  decodeJwtPayload,
  type JsonValue,
  type JwtPayload,
  type SocialFlow,
  type SocialProvider,
} from '@app/common';

// OAuth state(CSRF 방어용 단명 토큰)의 유효 기간과 식별 클레임.
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const STATE_TYP = 'oauth_state';

// state에서 복원되는 흐름 정보 — 콜백이 신뢰할 수 있는 유일한 출처.
export interface SocialState {
  nonce: string;
  flow: SocialFlow;
}

// 토큰 발급/검증 전담 — 세션 access token과 OAuth state 서명이 모두 여기를 거친다.
// (JwtService를 직접 만지는 유일한 곳)
//
// 세션 토큰은 "어느 세션인가"만 말한다. 사용자 정보는 서버 세션에 있으므로
// 이 서비스는 신원을 복원하지 않는다 — 그건 SessionsRepository의 몫이다.
@Injectable()
export class AuthTokenService {
  constructor(private readonly jwt: JwtService) {}

  signSession(userId: string, sessionId: string): string {
    const payload: JwtPayload = { sub: userId, jti: sessionId };
    return this.jwt.sign(payload);
  }

  // 서명·만료 검증 후 클레임을 돌려준다. 유효하지 않으면 throw.
  // ⚠️ 여기를 통과했다고 "로그인 상태"인 것은 아니다 — 세션이 살아 있는지는
  // 호출부가 저장소에 물어야 한다(로그아웃/폐기가 즉시 반영되는 지점).
  verifySession(token: string): JwtPayload {
    const claims = this.jwt.verify<{ [key: string]: JsonValue }>(token);
    return decodeJwtPayload(claims);
  }

  // 만료를 무시하고 서명만 확인해 세션 id를 꺼낸다(무효면 null). **로그아웃 전용.**
  //
  // 로그아웃은 인증이 아니라 정리라서 만료를 이유로 거부하면 안 된다. 액세스 토큰은
  // 15분짜리인데 그보다 오래 자리를 비운 뒤 로그아웃을 누르는 것이 오히려 흔하고,
  // 거기서 막으면 서버 세션이 idle 만료까지 남는다.
  // 서명 검증은 그대로 두므로 남의 세션 id를 넣어 강제 폐기시킬 수는 없다.
  readSessionIdForLogout(token: string): string | null {
    try {
      const claims = this.jwt.verify<{ [key: string]: JsonValue }>(token, {
        ignoreExpiration: true,
      });
      return decodeJwtPayload(claims).jti;
    } catch {
      return null;
    }
  }

  // 서버가 서명한 단명 state 토큰. 브라우저별 nonce(쿠키)와 provider를 클레임에 바인딩해,
  // 콜백에서 "이 브라우저가 시작한 이 provider의 흐름"인지까지 검증한다(login-CSRF 방어).
  // flow도 함께 서명한다 — 콜백에서 결과를 어떻게 돌려줄지(redirect/popup)를 정하는 값이라
  // 클라이언트가 콜백 시점에 바꿔치기할 수 없어야 한다.
  buildState(
    provider: SocialProvider,
    nonce: string,
    flow: SocialFlow,
  ): string {
    return this.jwt.sign(
      { typ: STATE_TYP, provider, nonce, flow },
      { expiresIn: OAUTH_STATE_TTL_MS / 1000 },
    );
  }

  // state의 서명·만료·typ·provider를 검증하고 바인딩된 nonce·flow를 반환한다(무효면 null).
  // "이 브라우저가 시작한 흐름인가"의 확인은 호출부 몫 — flow별 쿠키명이 이 nonce로 유도된다.
  readState(
    state: string | undefined,
    provider: SocialProvider,
  ): SocialState | null {
    if (!state) return null;
    try {
      const payload = this.jwt.verify<{ [key: string]: JsonValue }>(state);
      if (payload.typ !== STATE_TYP || payload.provider !== provider) {
        return null;
      }
      const nonce =
        typeof payload.nonce === 'string' && payload.nonce
          ? payload.nonce
          : null;
      if (!nonce) return null;
      // 구 버전 state(flow 없음)는 redirect로 본다 — 배포 교차 구간의 진행 중 흐름 보호.
      const flow = SOCIAL_FLOWS.find((f) => f === payload.flow) ?? 'redirect';
      return { nonce, flow };
    } catch {
      return null;
    }
  }
}
