import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionsRepository, type User } from '@app/common';
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
// **유휴 창을 미는 자리이기도 하다.** 세션의 sliding idle은 "사용자가 손을 뗀 지 얼마나
// 됐나"를 재는 값인데, 그 판단을 회전(`/auth/refresh`)에 두면 틀린다 — 회전은 사용자가
// 눌러서 일어날 수도, 서버가 밀어 준 신호 때문에 일어날 수도 있어 구분이 불가능하다.
// **인증된 요청이 서버에 닿는 것**이 곧 활동이므로, 여기가 그 판단의 자연스러운 자리다
// (plan/auth.md §6).
//
// 라우트에 직접 붙여도 되고(@UseGuards), APP_GUARD로 전역 등록해도 된다.
// 전역일 때는 @Public()이 붙은 라우트만 통과시킨다.
/**
 * 이 요청이 **사용자가 시킨 것**이라는 표시. 붙어 있을 때만 세션의 유휴 창을 민다.
 *
 * ⚠️ **없으면 밀지 않는다**(fail-closed). 반대로 두면 안 되는 이유가 있다: 우리 도메인의
 * 등록 가능 도메인이 Public Suffix List에 없어 다른 `*.asuscomm.com` 호스트가 전부 우리와
 * same-site다. 그들이 `<img>`·최상위 이동으로 유발한 GET에도 `SameSite=Lax` 세션 쿠키가
 * 실려 오는데, "표시가 없으면 활동"이라고 두면 그 요청이 남의 세션을 absolute 상한까지
 * 살려 준다 — 응답을 읽지 못해도 수명은 늘어난다(WebOriginGuard가 POST에 대해 막는 것과
 * 같은 위협이다).
 *
 * **커스텀 헤더는 그 공격이 붙일 수 없다.** 단순 요청(img·form·이동)은 헤더를 못 달고,
 * fetch로 달면 프리플라이트가 도는데 CORS 허용 출처가 아니면 요청 자체가 나가지 않는다.
 * 그래서 이 표시는 "브라우저에서 우리 출처가 보낸 요청"의 증거가 된다.
 */
export const ACTIVITY_HEADER = 'x-prism-activity';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly authenticator: SessionAuthenticator,
    // 쿠키 이름이 환경에 따라 다르다(__Host- 접두어·네임스페이스) — 설정이 그 판단의 원천.
    private readonly config: PrismConfigService,
    private readonly reflector: Reflector,
    private readonly sessions: SessionsRepository,
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

    // 사용자가 시킨 요청이면 유휴 창을 민다(위 ACTIVITY_HEADER).
    //
    // 소켓 신호로 나가는 재조회에는 이 표시가 없다 — 사용자가 한 일이 아니라서다.
    // 기기가 둘이면 서로의 소켓 신호가 서로의 세션을 영원히 살려내, 유휴 만료가 이름만
    // 남는다(실제로 그렇게 관측됐다).
    if (req.headers[ACTIVITY_HEADER] === '1') {
      // 응답을 막지 않는다 — 미는 데 실패해도 세션이 예정대로 만료될 뿐이고, 그것은
      // 안전한 쪽의 실패다. 다만 **조용히 삼키지는 않는다**: 밀기가 계속 실패하면
      // 쓰는 도중에 세션이 끊기는 것으로 나타나는데, 로그가 없으면 원인을 알 수 없다.
      try {
        await this.sessions.touch(
          result.sessionId,
          result.user.id,
          result.absoluteExpiresAt,
          this.config.refreshTokenTtlMs,
        );
      } catch (error) {
        // catch 바인딩으로 받는다 — `unknown`을 적지 않고도 좁힐 수 있다(프로젝트 방침).
        this.logger.warn(`failed to slide session: ${String(error)}`);
      }
    }
    return true;
  }
}
