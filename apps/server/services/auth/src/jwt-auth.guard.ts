import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_ERROR_CODES, SessionsRepository, type User } from '@app/common';
import { PrismConfigService } from '@app/config';
import { AuthTokenService } from './session/auth-token.service';
import { sessionTokenOf } from './session/session-cookie';

// 인증 = 서명 검증 + **세션 생존 확인**. 두 번째가 핵심이다.
// 서명만 보면 로그아웃해도 만료(1h)까지 그 토큰이 계속 통한다 — 폐기할 방법이 없다.
// 세션 행을 매 요청 확인하므로 로그아웃·강제 폐기가 다음 요청부터 즉시 반영된다.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: AuthTokenService,
    private readonly sessions: SessionsRepository,
    // 쿠키 이름이 환경에 따라 다르다(__Host- 접두어) — 설정이 그 판단의 원천.
    private readonly config: PrismConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: User; sessionId?: string }>();
    // 웹은 HttpOnly 쿠키, 네이티브는 Bearer — 둘 다 같은 세션 JWT다.
    const token = sessionTokenOf(req, this.config.isProduction);
    if (!token) throw this.unauthorized();

    let sessionId: string;
    try {
      sessionId = this.tokens.verifySession(token).jti;
    } catch {
      throw this.unauthorized();
    }

    // 서명이 유효해도 세션이 없으면(로그아웃·만료·폐기) 인증되지 않는다.
    const user = await this.sessions.findValid(sessionId);
    if (!user) throw this.unauthorized();

    req.user = user;
    // 로그아웃이 "이 세션만" 지울 수 있도록 핸들러에 전달한다.
    req.sessionId = sessionId;
    return true;
  }

  private unauthorized(): HttpException {
    return new HttpException({ error: AUTH_ERROR_CODES.UNAUTHORIZED }, 401);
  }
}
