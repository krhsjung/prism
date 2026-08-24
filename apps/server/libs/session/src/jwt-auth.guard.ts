import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type User } from '@app/common';
import { PrismConfigService } from '@app/config';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionAuthenticator } from './session-authenticator';
import { sessionTokenOf } from './session-cookie';

// HTTP 요청의 인증 — 자격증명을 찾아 SessionAuthenticator에 묻고, 그 답을 401로 옮긴다.
//
// 판단 자체(서명 검증 + 세션 생존 확인)는 SessionAuthenticator가 갖는다. 소켓 게이트웨이가
// 같은 판단을 필요로 하는데 이 가드는 ctx.switchToHttp()에 묶여 있어 재사용할 수 없기
// 때문이다 — 여기 남은 것은 **HTTP 매핑뿐**이다.
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
    private readonly authenticator: SessionAuthenticator,
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
    const result = await this.authenticator.authenticate(token);
    if (!result.ok) throw new HttpException({ error: result.code }, 401);

    req.user = result.user;
    // 로그아웃이 "이 세션만" 지울 수 있도록 핸들러에 전달한다.
    req.sessionId = result.sessionId;
    return true;
  }
}
