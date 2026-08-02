import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_ERROR_CODES } from '@app/common';
import { PrismConfigService } from '@app/config';

// 쿠키가 실릴 수 있는 상태 변경 요청의 CSRF 방어.
//
// SameSite=Lax는 *교차 사이트* 요청만 막는다. 우리 도메인(hsjung.asuscomm.com)의
// 등록 가능 도메인은 asuscomm.com인데 이 값은 Public Suffix List에 없다 — 즉 다른
// 사람들의 *.asuscomm.com 호스트가 전부 우리와 same-site이고, 거기서 보낸 form POST
// 에는 세션 쿠키가 그대로 실린다. Lax만으로는 그들을 막지 못한다.
//
// 그래서 Origin을 직접 검증한다. 브라우저는 POST에 Origin을 반드시 싣고 스크립트로
// 위조할 수 없으므로, 허용 목록 대조만으로 브라우저발 CSRF가 차단된다.
//
// ⚠️ provider 콜백(Apple form_post)에는 붙이지 않는다 — 교차 사이트 POST가 프로토콜상
// 정상이며, 그쪽은 서명된 state + 흐름 nonce 쿠키라는 별도 방어를 이미 갖고 있다.
@Injectable()
export class WebOriginGuard implements CanActivate {
  constructor(private readonly config: PrismConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const origin = ctx.switchToHttp().getRequest<Request>().headers.origin;
    // Origin이 없으면 브라우저가 만든 요청이 아니다(네이티브 SDK·CLI 등).
    // ambient 쿠키를 자동으로 싣는 주체가 아니므로 CSRF 대상이 아니다.
    if (origin === undefined) return true;
    if (this.config.isAllowedOrigin(origin)) return true;
    throw new HttpException({ error: AUTH_ERROR_CODES.FORBIDDEN_ORIGIN }, 403);
  }
}
