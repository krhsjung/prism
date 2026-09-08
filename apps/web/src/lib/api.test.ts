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

// 헤더·본문까지 봐야 하는 테스트용 — 경로와 함께 보낸 값을 남긴다.
function mockFetchWithHeaders(routes: { [path: string]: Response[] }) {
  const sent: {
    path: string;
    body: string | null;
    activity?: string;
    language?: string;
    contentType?: string;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      sent.push({
        path,
        body: (init?.body as string | undefined) ?? null,
        activity: headers['X-Prism-Activity'],
        language: headers['Accept-Language'],
        contentType: headers['Content-Type'],
      });
      const next = routes[path]?.shift();
      if (!next) throw new Error(`예상하지 못한 요청: ${path}`);
      return Promise.resolve(next);
    }),
  );
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// 유휴 창은 **사용자 활동**을 재는 값이다. 서버가 밀어 준 신호(`sessionsChanged`) 때문에
// 도는 재조회까지 창을 밀면, 기기가 둘일 때 서로가 서로의 세션을 영원히 살려낸다.
//
// 미는 것은 회전이 아니라 **요청**이다 — 그래서 표시도 회전이 아니라 요청 헤더가 나른다
// (plan/auth.md §6). 회전에 표시를 달던 시절에는 배경 회전에 합류한 사용자 요청이 창을
// 잃었다.
describe('활동 표시', () => {
  // ⚠️ 회귀 방지: 화면 진입·해제 뒤의 재조회는 활동이다 — 표시가 있어야 서버가 창을 민다.
  it('사용자가 시킨 재조회는 활동으로 표시된다', async () => {
    const sent = mockFetchWithHeaders({ '/auth/sessions': [json(200, [])] });

    await api.sessions();

    expect(sent[0]?.activity).toBe('1');
  });

  // 소켓이 시킨 재조회에는 표시가 없다 — 사용자가 한 일이 아니다.
  it('소켓이 시킨 재조회에는 표시가 없다', async () => {
    const sent = mockFetchWithHeaders({ '/auth/sessions': [json(200, [])] });

    await api.sessions(true);

    expect(sent[0]?.activity).toBeUndefined();
  });

  // 회전은 성격을 갖지 않는다 — 자격증명 교체가 전부다.
  it('회전 요청은 표시도 body도 싣지 않는다', async () => {
    const sent = mockFetchWithHeaders({
      '/auth/sessions': [json(401, { error: 'SESSION_EXPIRED' }), json(200, [])],
      '/auth/refresh': [json(200, sessionUser)],
    });

    await api.sessions(true);

    const refresh = sent.find((r) => r.path === '/auth/refresh');
    expect(refresh?.body ?? null).toBeNull();
  });

  // 재시도도 같은 성격을 유지해야 한다 — 그러지 않으면 배경 재조회가 회전 한 번으로
  // 슬그머니 활동이 된다.
  it('회전 뒤 재시도도 성격을 유지한다', async () => {
    const sent = mockFetchWithHeaders({
      '/auth/sessions': [json(401, { error: 'SESSION_EXPIRED' }), json(200, [])],
      '/auth/refresh': [json(200, sessionUser)],
    });

    await api.sessions(true);

    const list = sent.filter((r) => r.path === '/auth/sessions');
    expect(list).toHaveLength(2);
    expect(list.every((r) => r.activity === undefined)).toBe(true);
  });
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

// 만료 임박 시의 **보내기 전** 회전.
//
// 타이머로 미리 돌지 않는 것이 이 설계의 요점이다: 요청이 없는 동안에도 세션을 밀면
// idle 타임아웃이 무의미해진다(탭만 열어두면 absolute 상한까지 산다). 요청이 있을 때만
// 보므로 유휴 상태에서는 트래픽이 0이고, 그러면서도 만료된 요청을 보내 401을 받고
// 되돌리는 왕복이 없다.
describe('보내기 전 선제 회전', () => {
  // 만료 시각은 모듈 안에 남으므로, 각 테스트가 자기 상태를 직접 만든다.
  const primeSession = async (ttlMs: number) => {
    mockFetch({ '/auth/me': [json(200, { user, accessTokenTtlMs: ttlMs })] });
    await api.me();
    vi.unstubAllGlobals();
  };

  it('수명이 넉넉하면 회전하지 않고 그대로 보낸다', async () => {
    await primeSession(ACCESS_TTL_MS);

    const calls = mockFetch({ '/auth/sessions': [json(200, [])] });
    await api.sessions();

    expect(calls).toEqual(['/auth/sessions']);
  });

  it('만료가 임박하면 먼저 회전하고 나서 보낸다', async () => {
    await primeSession(1_000); // 여유(5초)보다 짧다

    const calls = mockFetch({
      '/auth/refresh': [json(200, sessionUser)],
      '/auth/sessions': [json(200, [])],
    });
    await api.sessions();

    // 회전이 **먼저** 나가야 한다 — 뒤면 만료된 요청을 이미 보낸 것이다.
    expect(calls).toEqual(['/auth/refresh', '/auth/sessions']);
  });

  // 회전 응답이 새 수명을 실어 오므로, 다음 요청은 다시 조용해야 한다.
  it('회전 뒤에는 다시 회전하지 않는다', async () => {
    await primeSession(1_000);

    mockFetch({
      '/auth/refresh': [json(200, sessionUser)],
      '/auth/sessions': [json(200, [])],
    });
    await api.sessions();
    vi.unstubAllGlobals();

    const calls = mockFetch({ '/auth/sessions': [json(200, [])] });
    await api.sessions();

    expect(calls).toEqual(['/auth/sessions']);
  });

  // 여기는 최적화지 정확성이 아니다 — 회전이 실패해도 요청은 나가고, 정말 만료였다면
  // 반응형 401 경로가 받아 낸다.
  it('선제 회전이 실패해도 요청은 그대로 보낸다', async () => {
    await primeSession(1_000);

    const calls = mockFetch({
      '/auth/refresh': [json(500, {})],
      '/auth/sessions': [json(200, [])],
    });
    await api.sessions();

    expect(calls).toEqual(['/auth/refresh', '/auth/sessions']);
  });

  // /auth/refresh 앞에서 또 회전하면 무한 루프다. me·logout도 세션의 뒷일을 스스로 쥔다.
  it('세션이 자기 뒷일을 쥐는 경로에는 선제 회전을 걸지 않는다', async () => {
    await primeSession(1_000);

    const calls = mockFetch({ '/auth/me': [json(200, sessionUser)] });
    await api.me();

    expect(calls).toEqual(['/auth/me']);
  });

  // 확정 거부·로그아웃 뒤에는 만료 시각을 잊는다 — 남겨 두면 다음 세션의 첫 요청이
  // 낡은 값을 보고 헛 회전한다.
  it('로그아웃 뒤에는 만료 시각을 잊는다', async () => {
    await primeSession(1_000);

    mockFetch({ '/auth/logout': [new Response(null, { status: 204 })] });
    await api.logout();
    vi.unstubAllGlobals();

    const calls = mockFetch({ '/auth/sessions': [json(200, [])] });
    await api.sessions();

    expect(calls).toEqual(['/auth/sessions']);
  });
});

// ── 푸시 (plan/push.md) ──
describe('푸시', () => {
  // 클라이언트는 **대상 세션 id들과 내용만** 준다 — 토큰은 서버가 레코드에서
  // 꺼낸다(§5-3). 답은 대상마다 따로 온다(§5-10).
  it('전송은 대상 id들과 내용만 싣는다', async () => {
    const sent = mockFetchWithHeaders({
      '/auth/push/send': [
        json(200, {
          results: [
            { sessionId: 's-1', result: 'accepted' },
            { sessionId: 's-2', result: 'duplicate' },
          ],
        }),
      ],
    });

    await expect(
      api.sendPush({ sessionIds: ['s-1', 's-2'], message: 'hello' }),
    ).resolves.toEqual({
      results: [
        { sessionId: 's-1', result: 'accepted' },
        { sessionId: 's-2', result: 'duplicate' },
      ],
    });
    expect(sent[0]?.body).toBe(
      JSON.stringify({ sessionIds: ['s-1', 's-2'], message: 'hello' }),
    );
    // 사용자가 누른 요청이다 — 유휴 창을 민다.
    expect(sent[0]?.activity).toBe('1');
  });

  it('이미지·링크·버튼도 함께 싣는다', async () => {
    const sent = mockFetchWithHeaders({
      '/auth/push/send': [json(200, { results: [] })],
    });

    await api.sendPush({
      sessionIds: ['s-1'],
      message: 'hi',
      imageUrl: 'https://cdn.example/a.png',
      link: 'https://example.com/x',
      actions: 'open-dismiss',
    });

    expect(JSON.parse(sent[0]?.body ?? '{}')).toEqual({
      sessionIds: ['s-1'],
      message: 'hi',
      imageUrl: 'https://cdn.example/a.png',
      link: 'https://example.com/x',
      actions: 'open-dismiss',
    });
  });

  it('계약에 없는 결과는 거부한다', async () => {
    mockFetch({
      '/auth/push/send': [
        json(200, { results: [{ sessionId: 's-1', result: 'delivered' }] }),
      ],
    });

    await expect(
      api.sendPush({ sessionIds: ['s-1'], message: 'hi' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  // 등록은 **로그인과 분리됐다**(§5-2를 뒤집었다) — 살아 있는 세션에 토큰을 붙인다.
  it('등록은 지금 세션에 토큰을 붙인다', async () => {
    const sent = mockFetchWithHeaders({
      '/auth/push/register': [json(200, { registered: true })],
    });

    await expect(api.registerPush('fcm-tok-1')).resolves.toEqual({
      registered: true,
    });
    expect(sent[0]?.path).toBe('/auth/push/register');
    expect(sent[0]?.body).toBe(JSON.stringify({ pushToken: 'fcm-tok-1' }));
  });

  it('데모 로그인은 더 이상 토큰을 싣지 않는다', async () => {
    const sent = mockFetchWithHeaders({ '/auth/demo': [json(200, sessionUser)] });

    await api.demoLogin();

    expect(sent[0]?.body).toBe('{}');
  });

  // 서버는 이 헤더로 **세션의 언어**를 정하고, 나중에 그 기기로 보내는 알림 문구를
  // 그 언어로 그린다(plan/push.md D4). 브라우저 기본값이 아니라 앱에서 고른 언어다.
  it('모든 요청이 화면의 언어를 싣는다', async () => {
    const sent = mockFetchWithHeaders({ '/auth/sessions': [json(200, [])] });

    await api.sessions();

    expect(sent[0]?.language).toBeTruthy();
  });

  // ⚠️ 회귀 방지: 한때 `...init`이 헤더 뒤에 있어, 활동 표시가 붙는 요청마다
  // `Content-Type`이 통째로 사라졌다. body를 실은 POST가 서버에서 파싱되지 않는다.
  it('활동 표시가 붙어도 Content-Type이 살아남는다', async () => {
    const sent = mockFetchWithHeaders({
      '/auth/push/send': [json(200, { results: [] })],
    });

    await api.sendPush({ sessionIds: ['s-1'], message: 'hi' });

    expect(sent[0]?.contentType).toBe('application/json');
    expect(sent[0]?.activity).toBe('1');
  });
});
