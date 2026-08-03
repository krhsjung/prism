import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  SOCIAL_FLOWS,
  type JsonValue,
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

// OAuth state 토큰 전담 — 이 서비스에만 있는 개념이다.
// (세션 토큰의 서명/검증은 @app/session의 SessionTokenService가 소유한다. 모든 서비스가
//  검증해야 하는 값이라 공유 계층에 있고, state는 OAuth 흐름 안에서만 오간다)
//
// 두 토큰은 같은 키로 서명되지만 `typ` 클레임으로 갈린다 — 서로의 자리에 쓸 수 없다.
@Injectable()
export class AuthTokenService {
  constructor(private readonly jwt: JwtService) {}

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
