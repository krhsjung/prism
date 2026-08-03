import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { decodeJwtPayload, type JsonValue, type JwtPayload } from '@app/common';

// 세션 토큰의 서명/검증 전담.
//
// 세션 토큰은 "어느 세션인가"만 말한다. 사용자 정보는 서버 세션에 있으므로
// 이 서비스는 신원을 복원하지 않는다 — 그건 SessionsRepository의 몫이다.
//
// auth 서비스가 발급하고 **모든 서비스가 검증한다.** 검증 로직이 서비스마다
// 따로 있으면 인증의 원천이 둘이 되므로(한쪽만 고쳐지는 순간 구멍) 여기 한 곳에 둔다.
@Injectable()
export class SessionTokenService {
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
  // 짧은데 그보다 오래 자리를 비운 뒤 로그아웃을 누르는 것이 오히려 흔하고,
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
}
