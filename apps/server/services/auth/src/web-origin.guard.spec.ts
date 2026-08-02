import { HttpException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { PrismConfigService } from '@app/config';
import { WebOriginGuard } from './web-origin.guard';

const WEB = 'https://prism.example';

// 허용 목록이 undefined면 로컬(전체 허용), 배열이면 운영.
const guardWith = (corsOrigins: string[] | undefined) =>
  new WebOriginGuard({
    isAllowedOrigin: (origin: string) =>
      corsOrigins === undefined || corsOrigins.includes(origin),
  } as object as PrismConfigService);

const ctxWith = (origin?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () =>
        ({ headers: origin ? { origin } : {} }) as object as Request,
    }),
  }) as object as ExecutionContext;

describe('WebOriginGuard', () => {
  const guard = guardWith([WEB]);

  it('허용된 출처는 통과한다', () => {
    expect(guard.canActivate(ctxWith(WEB))).toBe(true);
  });

  // 핵심: asuscomm.com이 PSL에 없어 형제 호스트가 same-site다 —
  // SameSite=Lax가 막지 못하는 이 경로를 Origin 검증이 막는다.
  it('same-site 형제 호스트라도 허용 목록에 없으면 403', () => {
    expect(() =>
      guard.canActivate(ctxWith('https://evil.asuscomm.com')),
    ).toThrow();
  });

  it('교차 사이트 출처는 403', () => {
    expect(() => guard.canActivate(ctxWith('https://evil.example'))).toThrow();
  });

  // 브라우저는 POST에 Origin을 반드시 싣는다 — 없으면 브라우저가 만든 요청이 아니고
  // ambient 쿠키를 자동으로 싣는 주체도 아니므로 CSRF 대상이 아니다(네이티브·CLI).
  it('Origin이 없으면 통과한다(네이티브·CLI)', () => {
    expect(guard.canActivate(ctxWith())).toBe(true);
  });

  it('허용 목록 미설정(로컬)이면 어떤 출처도 통과한다', () => {
    const local = guardWith(undefined);
    expect(local.canActivate(ctxWith('http://localhost:5173'))).toBe(true);
    expect(local.canActivate(ctxWith('https://anything.example'))).toBe(true);
  });

  it('403 응답에 FORBIDDEN_ORIGIN 코드를 담는다', () => {
    expect.assertions(2);
    try {
      guard.canActivate(ctxWith('https://evil.example'));
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      expect(e.getStatus()).toBe(403);
      expect(e.getResponse()).toEqual({ error: 'FORBIDDEN_ORIGIN' });
    }
  });
});
