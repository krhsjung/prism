import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setSessionAuthority } from './api';

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

// 쿠키 흐름의 /auth/me·/auth/refresh 응답 형태 — 사용자 + 액세스 토큰 수명(선제 갱신용).
const ACCESS_TTL_MS = 15 * 60 * 1000;
const sessionUser = { user, accessTokenTtlMs: ACCESS_TTL_MS };

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
      '/auth/me': [
        json(401, { error: 'SESSION_EXPIRED' }),
        json(200, sessionUser),
      ],
      '/auth/refresh': [json(200, sessionUser)],
    });

    await expect(api.me()).resolves.toEqual(sessionUser);
    expect(calls).toEqual(['/auth/me', '/auth/refresh', '/auth/me']);
  });


  // 다른 기기에서 이 세션을 해제하면 갱신으로는 살아나지 않는다. 화면이 "불러오지
  // 못했습니다"를 띄우고 마는 대신 세션의 주인에게 알려 로그인 화면으로 보내야 한다.
  it('폐기된 세션은 갱신하지 않고 세션의 주인에게 알린다', async () => {
    const calls = mockFetch({
      '/auth/sessions': [json(401, { error: 'UNAUTHORIZED' })],
    });
    const rejected = vi.fn();
    setSessionAuthority({ mark: () => 1, reject: rejected });

    await expect(api.sessions()).rejects.toThrow();

    expect(calls).toEqual(['/auth/sessions']);
    expect(rejected).toHaveBeenCalledWith(1);
    setSessionAuthority(null);
  });

  // 만료로 보이지만 갱신까지 거부되면 되살릴 수 있는 세션이 아니다. 예전에는 여기서
  // 원래 401을 그대로 돌려주기만 해, 화면이 "불러오지 못했습니다"를 띄운 채 죽은 세션의
  // 목록을 계속 보여 줬다.
  it('갱신이 확정 거부되면 세션의 주인에게 알린다', async () => {
    const calls = mockFetch({
      '/auth/sessions': [json(401, { error: 'SESSION_EXPIRED' })],
      '/auth/refresh': [json(401, { error: 'UNAUTHORIZED' })],
    });
    const rejected = vi.fn();
    setSessionAuthority({ mark: () => 1, reject: rejected });

    await expect(api.sessions()).rejects.toThrow();

    expect(calls).toEqual(['/auth/sessions', '/auth/refresh']);
    expect(rejected).toHaveBeenCalledWith(1);
    setSessionAuthority(null);
  });

  // 오프라인·5xx로 갱신이 실패한 것뿐이라면 세션을 끊지 않는다 — 일시적 실패로
  // 로그인 화면으로 쫓아내면 잠깐 끊긴 것이 곧 로그아웃이 된다.
  it('일시적 갱신 실패는 세션을 끊지 않는다', async () => {
    mockFetch({
      '/auth/sessions': [json(401, { error: 'SESSION_EXPIRED' })],
      '/auth/refresh': [json(503, { error: 'SERVICE_UNAVAILABLE' })],
    });
    const rejected = vi.fn();
    setSessionAuthority({ mark: () => 1, reject: rejected });

    await expect(api.sessions()).rejects.toThrow();

    expect(rejected).not.toHaveBeenCalled();
    setSessionAuthority(null);
  });

  // 방금 회전한 자격증명까지 거부됐다면 되살릴 수 있는 세션이 아니다.
  it('재시도가 확정 401로 돌아오면 세션의 주인에게 알린다', async () => {
    const calls = mockFetch({
      '/auth/sessions': [
        json(401, { error: 'SESSION_EXPIRED' }),
        json(401, { error: 'UNAUTHORIZED' }),
      ],
      '/auth/refresh': [json(200, sessionUser)],
    });
    const rejected = vi.fn();
    setSessionAuthority({ mark: () => 1, reject: rejected });

    await expect(api.sessions()).rejects.toThrow();

    expect(calls).toEqual(['/auth/sessions', '/auth/refresh', '/auth/sessions']);
    expect(rejected).toHaveBeenCalledWith(1);
    setSessionAuthority(null);
  });

  // 응답이 돌아오기 전에 로그아웃하고 다시 로그인하면 그 401은 **끝난 세션**의 것이다.
  // 쿠키는 자동으로 실려 나가 토큰을 비교할 수조차 없으니, 표식이 유일한 방벽이다.
  it('그사이 세션이 갈리면 갱신도 종료도 하지 않는다', async () => {
    const calls = mockFetch({
      '/auth/sessions': [json(401, { error: 'SESSION_EXPIRED' })],
    });
    const rejected = vi.fn();
    // 요청을 보낸 뒤 표식이 갈린 상황 — 두 번째 읽기부터 다른 값을 준다.
    let reads = 0;
    setSessionAuthority({ mark: () => (reads++ === 0 ? 1 : 2), reject: rejected });

    await expect(api.sessions()).rejects.toThrow();

    // 갱신 요청조차 나가지 않는다.
    expect(calls).toEqual(['/auth/sessions']);
    expect(rejected).not.toHaveBeenCalled();
    setSessionAuthority(null);
  });

  // 갱신을 기다리는 사이에도 세션은 갈릴 수 있다. 그때 재시도하면 옛 요청이 **새 세션의
  // 쿠키로** 나간다 — 쿠키는 자동으로 실려 나가므로 요청 스스로는 그것을 막지 못한다.
  it('갱신 도중 세션이 갈리면 재시도하지 않는다', async () => {
    const calls = mockFetch({
      '/auth/sessions': [json(401, { error: 'SESSION_EXPIRED' })],
      '/auth/refresh': [json(200, sessionUser)],
    });
    const rejected = vi.fn();
    // 요청 시점은 1, 갱신 직전 확인도 1, 갱신이 끝난 뒤에는 2로 갈린다.
    const marks = [1, 1, 2, 2];
    setSessionAuthority({ mark: () => marks.shift() ?? 2, reject: rejected });

    await expect(api.sessions()).rejects.toThrow();

    expect(calls).toEqual(['/auth/sessions', '/auth/refresh']);
    expect(rejected).not.toHaveBeenCalled();
    setSessionAuthority(null);
  });

  // 자격증명이 없는 **첫 방문**도 401이다. 그것을 "다른 기기에서 해제됨"으로 알리면
  // 처음 온 사람에게 엉뚱한 안내가 뜬다.
  it('세션 확인(/auth/me)의 401은 알리지 않는다', async () => {
    mockFetch({ '/auth/me': [json(401, { error: 'UNAUTHORIZED' })] });
    const rejected = vi.fn();
    setSessionAuthority({ mark: () => 1, reject: rejected });

    await expect(api.me()).rejects.toThrow();

    expect(rejected).not.toHaveBeenCalled();
    setSessionAuthority(null);
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
        json(200, sessionUser),
        json(200, sessionUser),
      ],
      '/auth/refresh': [json(200, sessionUser)],
    });

    await expect(Promise.all([api.me(), api.me()])).resolves.toEqual([
      sessionUser,
      sessionUser,
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
