import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

// 이 파일의 관심사는 "요청이 몇 번, 어디로 나갔는가"다.
//
// 세션 쿠키는 HttpOnly라 클라이언트가 로그인 여부를 미리 알 수 없다. 그래서 401을
// 만났을 때 갱신을 시도할지는 전적으로 서버가 준 오류 코드에 달려 있다 —
// 판단이 틀리면 반드시 실패할 /auth/refresh가 한 번 더 나가고(첫 방문) 그 호출이
// 갱신 레이트리밋을 깎는다.

const user = {
  id: 'u-1',
  provider: 'demo',
  displayName: 'Demo User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// 경로별로 응답을 큐에 넣어 돌려준다(같은 경로를 다시 부르면 다음 응답).
// 동시 요청에서도 순서가 흔들리지 않도록 호출 순서가 아니라 경로로 짝짓는다.
function mockFetch(routes: { [path: string]: Response[] }) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      const next = routes[path]?.shift();
      if (!next) throw new Error(`예상하지 못한 요청: ${path}`);
      return Promise.resolve(next);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('401 갱신 판단', () => {
  // 첫 방문(자격증명 없음). 갱신해봐야 같은 이유로 실패하므로 시도 자체를 하지 않는다.
  it('UNAUTHORIZED면 갱신하지 않는다 — 요청은 한 번뿐', async () => {
    const calls = mockFetch({
      '/auth/me': [json(401, { error: 'UNAUTHORIZED' })],
    });

    await expect(api.me()).rejects.toThrow(ApiError);
    expect(calls).toEqual(['/auth/me']);
  });

  // 변조·쿠키 주입으로만 생기는 상태 — 정상 클라이언트는 여기 오지 않는다.
  it('INVALID_TOKEN이면 갱신하지 않는다', async () => {
    const calls = mockFetch({
      '/auth/me': [json(401, { error: 'INVALID_TOKEN' })],
    });

    await expect(api.me()).rejects.toThrow(ApiError);
    expect(calls).toEqual(['/auth/me']);
  });

  // 로그인된 사용자의 액세스 토큰 만료 — 사용자에겐 아무 일도 없었던 것처럼 이어져야 한다.
  it('SESSION_EXPIRED면 갱신 후 원래 요청을 재시도한다', async () => {
    const calls = mockFetch({
      '/auth/me': [json(401, { error: 'SESSION_EXPIRED' }), json(200, user)],
      '/auth/refresh': [json(200, { user })],
    });

    await expect(api.me()).resolves.toEqual(user);
    expect(calls).toEqual(['/auth/me', '/auth/refresh', '/auth/me']);
  });

  it('갱신이 실패하면 재시도하지 않고 원래 401을 그대로 돌려준다', async () => {
    const calls = mockFetch({
      '/auth/me': [json(401, { error: 'SESSION_EXPIRED' })],
      '/auth/refresh': [json(401, { error: 'UNAUTHORIZED' })],
    });

    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(calls).toEqual(['/auth/me', '/auth/refresh']);
  });

  // 리프레시 자격증명은 1회용이라 각자 갱신하면 하나만 성공하고 나머지는 세션을 잃는다.
  it('동시에 만료를 만나도 갱신은 한 번만 나간다(single-flight)', async () => {
    const calls = mockFetch({
      '/auth/me': [
        json(401, { error: 'SESSION_EXPIRED' }),
        json(401, { error: 'SESSION_EXPIRED' }),
        json(200, user),
        json(200, user),
      ],
      '/auth/refresh': [json(200, { user })],
    });

    await expect(Promise.all([api.me(), api.me()])).resolves.toEqual([
      user,
      user,
    ]);
    expect(calls.filter((p) => p === '/auth/refresh')).toHaveLength(1);
  });

  // body는 한 번만 읽을 수 있다 — 갱신 판단이 원본을 소비하면 호출부의 오류 코드가
  // 통째로 REQUEST_FAILED로 뭉개진다(화면 문구가 전부 일반 오류가 된다).
  it('갱신 판단이 오류 body를 소비하지 않는다', async () => {
    mockFetch({ '/auth/me': [json(401, { error: 'UNAUTHORIZED' })] });

    // fetchWithRefresh가 코드 확인용으로 body를 소비했다면 여기서 기본 코드가 나온다.
    await expect(api.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
