import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { SessionsRepository, User } from '@app/common';
import type { PrismConfigService } from '@app/config';
import { ACTIVITY_HEADER, JwtAuthGuard } from './jwt-auth.guard';
import type { SessionAuthenticator } from './session-authenticator';

// 가드는 **HTTP 매핑**과, 인증된 요청이 닿을 때 세션에 남기는 두 가지 — 유휴 창 밀기와
// 언어 맞추기 — 를 갖는다. 판단 자체는 SessionAuthenticator 스펙이 본다.
describe('JwtAuthGuard', () => {
  const user: User = {
    id: 'u-1',
    provider: 'google',
    displayName: 'Alice',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  let authenticate: jest.Mock;
  let touch: jest.Mock;
  let updateLocale: jest.Mock;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    authenticate = jest.fn(() =>
      Promise.resolve({
        ok: true,
        user,
        sessionId: 's-1',
        absoluteExpiresAt: Date.now() + 60_000,
        locale: 'en',
      }),
    );
    touch = jest.fn(() => Promise.resolve());
    updateLocale = jest.fn(() => Promise.resolve(true));
    guard = new JwtAuthGuard(
      { authenticate } as object as SessionAuthenticator,
      {
        cookiePolicy: { namespace: '', hostPrefix: false },
        refreshTokenTtlMs: 60_000,
      } as object as PrismConfigService,
      { getAllAndOverride: () => false } as object as Reflector,
      { touch, updateLocale } as object as SessionsRepository,
    );
  });

  const contextWith = (headers: { [name: string]: string }) => {
    const req = {
      headers: { authorization: 'Bearer tok', ...headers },
      cookies: {},
    };
    return {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as object as ExecutionContext;
  };

  it('인증에 실패하면 401이다', async () => {
    authenticate.mockResolvedValueOnce({ ok: false, code: 'UNAUTHORIZED' });

    await expect(guard.canActivate(contextWith({}))).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  // 서버가 그리는 알림 문구는 세션의 언어를 쓴다 — 앱에서 언어를 바꾸면 다음 요청이
  // 곧바로 세션에 반영돼야 알림이 옛 언어로 오지 않는다.
  it('요청의 언어가 세션과 다르면 세션의 언어를 맞춘다', async () => {
    await guard.canActivate(
      contextWith({ 'accept-language': 'ko-KR,ko;q=0.9' }),
    );

    expect(updateLocale).toHaveBeenCalledWith('u-1', 's-1', 'ko');
  });

  it('언어가 같으면 쓰지 않는다', async () => {
    await guard.canActivate(contextWith({ 'accept-language': 'en-US' }));

    expect(updateLocale).not.toHaveBeenCalled();
  });

  // 헤더가 없는 요청을 기본 언어로 읽어 덮어쓰면 그것이 곧 잘못된 값이다.
  it('언어 헤더가 없으면 건드리지 않는다', async () => {
    await guard.canActivate(contextWith({}));

    expect(updateLocale).not.toHaveBeenCalled();
  });

  it('언어를 맞추는 데 실패해도 요청은 통과한다', async () => {
    updateLocale.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      guard.canActivate(contextWith({ 'accept-language': 'ja' })),
    ).resolves.toBe(true);
  });

  // 유휴 창은 **사용자가 시킨 요청**에만 밀린다 — 언어 맞추기와 달리 활동의 표시가 필요하다.
  it('활동 표시가 있을 때만 유휴 창을 민다', async () => {
    await guard.canActivate(contextWith({}));
    expect(touch).not.toHaveBeenCalled();

    await guard.canActivate(contextWith({ [ACTIVITY_HEADER]: '1' }));
    expect(touch).toHaveBeenCalledWith(
      's-1',
      'u-1',
      expect.any(Number),
      60_000,
    );
  });
});
