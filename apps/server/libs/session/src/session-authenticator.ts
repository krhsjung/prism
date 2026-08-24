import { Injectable } from '@nestjs/common';
import {
  AUTH_ERROR_CODES,
  SessionsRepository,
  type AuthErrorCode,
  type User,
} from '@app/common';
import { SessionTokenService } from './session-token.service';

// 인증의 두 단계 — 서명 검증 + **세션 생존 확인**. 두 번째가 핵심이다.
// 서명만 보면 로그아웃해도 만료까지 그 토큰이 계속 통한다(폐기할 방법이 없다).
// 세션 행을 확인하므로 로그아웃·강제 폐기가 즉시 반영된다.
//
// **HTTP에서 떼어 낸 이유**는 WebSocket이 같은 판단을 필요로 하기 때문이다.
// JwtAuthGuard는 ctx.switchToHttp()로 요청을 꺼내므로 소켓에서 쓸 수 없는데, 그렇다고
// 소켓 쪽에 같은 로직을 한 벌 더 두면 인증의 원천이 둘이 되고 한쪽만 고쳐지는 순간
// 그게 구멍이 된다(@app/session이 존재하는 이유 그대로다).
// 여기는 **판단만** 하고, 그 판단을 401로 옮기는 일은 가드가, close(1008)로 옮기는 일은
// 소켓 게이트웨이가 맡는다.
export type SessionAuthResult =
  | { ok: true; user: User; sessionId: string }
  | { ok: false; code: AuthErrorCode };

@Injectable()
export class SessionAuthenticator {
  constructor(
    private readonly tokens: SessionTokenService,
    private readonly sessions: SessionsRepository,
  ) {}

  async authenticate(token: string | null): Promise<SessionAuthResult> {
    // 자격증명이 아예 없다 → 갱신도 불가능하다. 리프레시 쿠키는 세션 쿠키와 수명·경로가
    // 같아(session-cookie.ts) 한쪽이 없으면 다른 쪽도 없다.
    if (!token) return { ok: false, code: AUTH_ERROR_CODES.UNAUTHORIZED };

    let sessionId: string;
    try {
      sessionId = this.tokens.verifySession(token).jti;
    } catch (error) {
      // 만료만이 갱신으로 살아나는 실패다. 서명이 깨진 토큰은 정상 클라이언트가 만들 수
      // 없으므로(변조·쿠키 주입) 갱신을 권하지 않는다 — 헛 왕복만 늘고 세션은 안 돌아온다.
      // ('TokenExpiredError'는 JwtService의 내부 구현인 jsonwebtoken이 만료에만 붙이는
      //  이름이다. 여기서 잡는 이유는 catch 바인딩이라야 unknown 타입을 쓰지 않고
      //  좁힐 수 있어서다 — 별도 함수로 빼면 시그니처에 unknown이 드러난다)
      return {
        ok: false,
        code:
          error instanceof Error && error.name === 'TokenExpiredError'
            ? AUTH_ERROR_CODES.SESSION_EXPIRED
            : AUTH_ERROR_CODES.INVALID_TOKEN,
      };
    }

    // 서명이 유효해도 세션이 없으면(로그아웃·만료·폐기) 인증되지 않는다.
    // 갱신도 같은 세션 저장소를 보므로 여기서 실패한 요청은 갱신해도 실패한다.
    const user = await this.sessions.findValid(sessionId);
    if (!user) return { ok: false, code: AUTH_ERROR_CODES.UNAUTHORIZED };

    return { ok: true, user, sessionId };
  }
}
