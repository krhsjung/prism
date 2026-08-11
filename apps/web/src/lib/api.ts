import {
  AUTH_ERROR_CODES,
  CLIENT_ERROR_CODES,
  decodeSessionList,
  decodeSessionUser,
  jsonBodyOf,
  type JsonValue,
  type SocialFlow,
  type SocialProvider,
} from './contracts.gen';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// popup 흐름에서 들어오는 postMessage의 발신 출처를 대조할 값.
// (API와 웹이 같은 도메인을 쓰는 운영에서도, 포트가 갈리는 로컬에서도 이 값이 기준)
export const API_ORIGIN = new URL(API_URL, window.location.href).origin;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// 모든 요청에 데드라인을 둔다 — 서버 무응답 시 로그인/초기 검증 화면이 무한 대기하지 않게.
const REQUEST_TIMEOUT_MS = 10_000;

async function fetchOrThrow(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
      // 세션은 HttpOnly 쿠키다 — JS가 토큰을 들고 다니지 않으므로 쿠키를 실어 보낸다.
      // (로컬은 웹:5173 ↔ API:3000으로 교차 출처라 이 옵션이 없으면 쿠키가 빠진다)
      credentials: 'include',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // 타임아웃(TimeoutError)도 네트워크 문제로 묶는다.
    throw new ApiError(0, CLIENT_ERROR_CODES.NETWORK_ERROR);
  }
}

// 액세스 토큰이 짧아 정상 사용 중에도 만료된다. 401을 만나면 세션을 한 번 갱신하고
// 원래 요청을 다시 보낸다 — 사용자에겐 아무 일도 일어나지 않은 것처럼 보인다.
//
// 동시에 여러 요청이 401을 받아도 갱신은 한 번만 나간다(single-flight). 각자 갱신하면
// 리프레시 자격증명이 1회용이라 하나만 성공하고 나머지는 세션을 잃는다.
// 선제(스케줄러)·반응형(401 재시도) 두 경로가 공유하는 회전 결과. 반응형은 `ok`만 보고
// 원 요청을 재시도하고, 선제 스케줄러는 `ttlMs`(새 액세스 토큰의 남은 수명)로 다음 회전
// 시점을 잡는다. 회전은 됐지만 응답 형식이 어긋나면 ok는 유지하되 ttlMs만 null이다.
export interface RefreshResult {
  ok: boolean;
  ttlMs: number | null;
}

let refreshing: Promise<RefreshResult> | null = null;

function refreshSession(): Promise<RefreshResult> {
  refreshing ??= (async () => {
    try {
      const res = await fetchOrThrow('/auth/refresh', { method: 'POST' });
      if (!res.ok) return { ok: false, ttlMs: null };
      // 쿠키 흐름의 갱신 응답은 { user, accessTokenTtlMs }(토큰은 쿠키로만).
      try {
        const { accessTokenTtlMs } = decodeSessionUser(await jsonBodyOf(res));
        return { ok: true, ttlMs: accessTokenTtlMs };
      } catch {
        return { ok: true, ttlMs: null };
      }
    } catch {
      return { ok: false, ttlMs: null };
    } finally {
      // 다음 만료 때 다시 시도할 수 있도록 비운다.
      refreshing = null;
    }
  })();
  return refreshing;
}

// 401이면 갱신 후 1회 재시도. 갱신 경로 자체는 재시도하지 않는다(무한 루프 방지).
//
// 단, 모든 401에 갱신을 시도하지는 않는다. 자격증명이 없는 첫 방문이나 이미 폐기된
// 세션은 갱신해도 똑같이 실패하므로, 요청만 한 번 더 나가고 /auth/refresh의
// 레이트리밋을 깎는다. "갱신하면 살아나는 401"인지는 서버만 알 수 있고(HttpOnly 쿠키를
// JS가 못 읽는다) 서버가 SESSION_EXPIRED로 알려준다 — 그때만 갱신한다.
async function fetchWithRefresh(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetchOrThrow(path, init);
  if (res.status !== 401 || path === '/auth/refresh') return res;
  // body는 한 번만 읽을 수 있다 — 코드 확인은 사본으로 하고 원본은 호출부에 그대로 넘긴다.
  const code = await errorCodeOf(res.clone());
  if (code !== AUTH_ERROR_CODES.SESSION_EXPIRED) return res;
  if (!(await refreshSession()).ok) return res;
  return fetchOrThrow(path, init);
}

// 오류 응답 body에서 서버 오류 코드를 꺼낸다(형식이 다르면 기본 코드).
async function errorCodeOf(res: Response): Promise<string> {
  try {
    const body = await jsonBodyOf(res);
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      const code = body.error;
      if (typeof code === 'string' && code) return code;
    }
  } catch {
    /* non-JSON body */
  }
  return CLIENT_ERROR_CODES.REQUEST_FAILED;
}

// 성공 body를 경계에서 디코딩한다 — as 단언 없이, 계약과 다르면 INVALID_RESPONSE.
async function requestJson<T>(
  path: string,
  decode: (v: JsonValue) => T,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchWithRefresh(path, init);
  if (!res.ok) throw new ApiError(res.status, await errorCodeOf(res));
  try {
    return decode(await jsonBodyOf(res));
  } catch {
    throw new ApiError(res.status, CLIENT_ERROR_CODES.INVALID_RESPONSE);
  }
}

// body를 기대하지 않는 요청(204 등).
async function requestEmpty(path: string, init?: RequestInit): Promise<void> {
  const res = await fetchWithRefresh(path, init);
  if (!res.ok) throw new ApiError(res.status, await errorCodeOf(res));
}

export const api = {
  // 응답에 토큰이 없다 — 세션은 서버가 심은 HttpOnly 쿠키에만 있다.
  demoLogin: () =>
    requestJson('/auth/demo', decodeSessionUser, { method: 'POST' }),
  // 소셜 로그인은 fetch가 아니라 브라우저 이동(전체 페이지 또는 popup)으로 시작한다.
  // flow는 서버가 서명된 state에 실어 콜백까지 가져가고, 결과 전달 방식을 결정한다.
  socialLoginUrl: (provider: SocialProvider, flow: SocialFlow) =>
    `${API_URL}/auth/${provider}?flow=${flow}`,
  // 쿠키 세션의 유효성은 서버만 알 수 있다(JS가 HttpOnly 쿠키를 못 읽는다). 응답에는
  // 사용자와 액세스 토큰 수명(accessTokenTtlMs)이 담긴다 — 후자로 선제 갱신을 스케줄한다.
  me: () => requestJson('/auth/me', decodeSessionUser),
  // 서버가 쿠키를 지워야 로그아웃이 성립한다.
  logout: () => requestEmpty('/auth/logout', { method: 'POST' }),
  // 세션을 선제적으로 회전(idle 창 연장)한다. 반응형 401 경로와 같은 single-flight를
  // 공유하므로, 동시에 겹쳐 불려도 실제 /auth/refresh는 한 번만 나간다.
  refreshSession: () => refreshSession(),
  // 내 활성 세션 목록. 서버가 "지금 이 요청의 세션"을 isCurrent로 표시해 준다
  // (세션 id는 HttpOnly 쿠키 안에만 있어 클라이언트가 자기 세션을 알 방법이 없다).
  sessions: () => requestJson('/auth/sessions', decodeSessionList),
  // 다른 기기의 세션 하나를 원격 폐기. 소유자 범위는 서버가 확인한다.
  revokeSession: (id: string) =>
    requestEmpty(`/auth/sessions/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
    }),
  // 내 모든 세션 폐기(현재 세션 포함) — 이후 쿠키는 무효가 된다.
  revokeAllSessions: () =>
    requestEmpty('/auth/sessions/revoke-all', { method: 'POST' }),
};
