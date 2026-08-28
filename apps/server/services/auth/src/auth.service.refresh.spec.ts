import { Logger } from '@nestjs/common';

// jose는 ESM 전용이라 jest(CJS)가 파싱하지 못한다 — 이 스펙은 회전 경로만 보므로
// Apple 클라이언트가 실제로 필요하지 않다(auth.http.spec.ts와 같은 이유).
jest.mock('jose', () => ({}));

import { AuthService } from './auth.service';

// 유휴 창을 미는 것은 회전이 아니라 **활동**이다(plan/auth.md §6). 회전이 활동으로
// 표시돼 들어오면 서버가 회전 뒤 창도 밀어야 하는데, 그 자리는 네이티브 앱의 복원이다 —
// `/auth/me`가 만료로 실패하면 회전으로 끝나고 다시 보호된 요청을 보내지 않는다.
//
// HTTP 경계 스펙은 컨트롤러가 표시를 **넘기는지**까지만 본다. 여기서는 서비스가 그 표시로
// 실제로 `touch`를 부르는지, 그리고 밀기가 실패해도 회전 결과를 잃지 않는지를 못박는다.
describe('AuthService.refreshSession — 활동 표시', () => {
  const user = {
    id: 'u-1',
    provider: 'demo' as const,
    displayName: 'Demo',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const makeService = (touch: jest.Mock) => {
    const sessions = {
      rotate: jest.fn(() =>
        Promise.resolve({
          status: 'rotated' as const,
          user,
          refreshCredential: 'sess-1.next',
          absoluteExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        }),
      ),
      touch,
    };
    const tokens = { signSession: jest.fn(() => 'access-token') };
    const config = { refreshTokenTtlMs: 12 * 60 * 60 * 1000 };
    // 회전 경로가 쓰는 것은 이 셋뿐이다 — 나머지 의존성은 이 계약과 무관하다.
    const service = new AuthService(
      {} as never,
      sessions as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      tokens as never,
      {} as never,
      config as never,
    );
    return { service, sessions };
  };

  it('활동 표시가 있으면 회전 뒤 유휴 창을 민다', async () => {
    const touch = jest.fn(() => Promise.resolve());
    const { service } = makeService(touch);

    const result = await service.refreshSession('sess-1.secret', true);

    expect(result.status).toBe('rotated');
    expect(touch).toHaveBeenCalledWith(
      'sess-1',
      'u-1',
      expect.any(Number),
      12 * 60 * 60 * 1000,
    );
  });

  it('표시가 없으면 밀지 않는다', async () => {
    const touch = jest.fn(() => Promise.resolve());
    const { service } = makeService(touch);

    await service.refreshSession('sess-1.secret');

    expect(touch).not.toHaveBeenCalled();
  });

  // ⚠️ 밀기 실패로 회전 결과를 잃으면 안 된다 — 자격증명은 이미 서버에서 교체됐고,
  // 여기서 실패로 답하면 클라이언트는 쓸 수 없는 옛 값만 들고 남는다.
  it('밀기가 실패해도 회전 결과를 돌려주고 경고만 남긴다', async () => {
    const touch = jest.fn(() => Promise.reject(new Error('redis down')));
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service } = makeService(touch);

    const result = await service.refreshSession('sess-1.secret', true);

    // status만 보면 "회전됐다"까지고, 정작 클라이언트가 써야 할 값이 비어 있어도 통과한다.
    expect(result).toMatchObject({
      status: 'rotated',
      session: { refreshToken: 'sess-1.next', accessToken: 'access-token' },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('slide'));
    warn.mockRestore();
  });
});
