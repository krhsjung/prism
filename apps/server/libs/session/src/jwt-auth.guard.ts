import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  AUTH_ERROR_CODES,
  SessionsRepository,
  type AuthErrorCode,
  type User,
} from '@app/common';
import { PrismConfigService } from '@app/config';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionTokenService } from './session-token.service';
import { sessionTokenOf } from './session-cookie';

// 인증 = 서명 검증 + **세션 생존 확인**. 두 번째가 핵심이다.
// 서명만 보면 로그아웃해도 만료까지 그 토큰이 계속 통한다 — 폐기할 방법이 없다.
// 세션 행을 매 요청 확인하므로 로그아웃·강제 폐기가 다음 요청부터 즉시 반영된다.
//
// 401은 전부 같은 401이 아니다. 웹 클라이언트는 HttpOnly 쿠키를 읽을 수 없어
// "지금 갱신을 시도할 가치가 있는가"를 스스로 판단하지 못하므로, 그 답을 아는 이곳이
// 오류 코드로 실어 보낸다 — 만료(SESSION_EXPIRED)만 갱신으로 살아나고 나머지는 아니다.
//
// 라우트에 직접 붙여도 되고(@UseGuards), APP_GUARD로 전역 등록해도 된다.
// 전역일 때는 @Public()이 붙은 라우트만 통과시킨다.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: SessionTokenService,
    private readonly sessions: SessionsRepository,
    // 쿠키 이름이 환경에 따라 다르다(__Host- 접두어·네임스페이스) — 설정이 그 판단의 원천.
    private readonly config: PrismConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // 핸들러 우선, 없으면 컨트롤러 — 컨트롤러 전체를 공개로 열 수도 있게 한다.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: User; sessionId?: string }>();
    // 웹은 HttpOnly 쿠키, 네이티브는 Bearer — 둘 다 같은 세션 JWT다.
    const token = sessionTokenOf(req, this.config.cookiePolicy);
    // 자격증명이 아예 없다 → 갱신도 불가능하다. 리프레시 쿠키는 세션 쿠키와 수명·경로가
    // 같아(session-cookie.ts) 한쪽이 없으면 다른 쪽도 없다.
    if (!token) throw this.fail(AUTH_ERROR_CODES.UNAUTHORIZED);

    let sessionId: string;
    try {
      sessionId = this.tokens.verifySession(token).jti;
    } catch (error) {
      // 만료만이 갱신으로 살아나는 실패다. 서명이 깨진 토큰은 정상 클라이언트가 만들 수
      // 없으므로(변조·쿠키 주입) 갱신을 권하지 않는다 — 헛 왕복만 늘고 세션은 안 돌아온다.
      // ('TokenExpiredError'는 JwtService의 내부 구현인 jsonwebtoken이 만료에만 붙이는
      //  이름이다. 여기서 잡는 이유는 catch 바인딩이라야 unknown 타입을 쓰지 않고
      //  좁힐 수 있어서다 — 별도 함수로 빼면 시그니처에 unknown이 드러난다)
      throw this.fail(
        error instanceof Error && error.name === 'TokenExpiredError'
          ? AUTH_ERROR_CODES.SESSION_EXPIRED
          : AUTH_ERROR_CODES.INVALID_TOKEN,
      );
    }

    // 서명이 유효해도 세션이 없으면(로그아웃·만료·폐기) 인증되지 않는다.
    // 갱신도 같은 세션 저장소를 보므로 여기서 실패한 요청은 갱신해도 실패한다.
    const user = await this.sessions.findValid(sessionId);
    if (!user) throw this.fail(AUTH_ERROR_CODES.UNAUTHORIZED);

    req.user = user;
    // 로그아웃이 "이 세션만" 지울 수 있도록 핸들러에 전달한다.
    req.sessionId = sessionId;
    return true;
  }

  private fail(code: AuthErrorCode): HttpException {
    return new HttpException({ error: code }, 401);
  }
}
