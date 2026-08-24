import {
  AUTH_ERROR_CODES,
  CLIENT_ERROR_CODES,
  decodeSessionList,
  decodeSessionUser,
  type SessionUser,
  jsonBodyOf,
  type JsonValue,
  type SocialFlow,
  type SocialProvider,
} from './contracts.gen';
import { log, routeTemplate } from './log';

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
  const method = init?.method ?? 'GET';
  const route = routeTemplate(path);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
      // 세션은 HttpOnly 쿠키다 — JS가 토큰을 들고 다니지 않으므로 쿠키를 실어 보낸다.
      // (로컬은 웹:5173 ↔ API:3000으로 교차 출처라 이 옵션이 없으면 쿠키가 빠진다)
      credentials: 'include',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // 메서드·라우트 템플릿·상태만 남긴다(원시 경로·쿼리·바디는 넣지 않는다).
    log.net('http', { method, route, status: res.status });
    return res;
  } catch {
    // 타임아웃(TimeoutError)도 네트워크 문제로 묶는다.
    log.net('http_error', { method, route, code: CLIENT_ERROR_CODES.NETWORK_ERROR });
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
  // 서버가 갱신을 **확정 거부**했는가(폐기·변조). 네트워크·5xx 같은 일시적 실패와
  // 구분한다 — 일시적 실패로 로그인 화면으로 쫓아내면 오프라인이 곧 로그아웃이 된다.
  rejected: boolean;
}

// 액세스 토큰이 만료되기까지 이만큼 남았으면 **보내기 전에** 회전한다.
// 왕복 한 번을 덮을 정도면 충분하다 — 못 덮어도 반응형 401 경로가 받아 내므로
// 이 값은 정확성이 아니라 최적화다.
const TOKEN_REFRESH_MARGIN_MS = 5_000;

// 액세스 토큰의 만료 시각(epoch ms). 0이면 모른다.
//
// 토큰은 HttpOnly 쿠키라 JS가 exp를 읽을 수 없다 — 서버가 응답에 실어 주는
// accessTokenTtlMs를 받은 그 순간에 시각으로 바꿔 둔다.
let accessTokenExpiresAt = 0;

// 세션이 끝났다 — 다음 요청이 낡은 만료 시각을 보고 헛 회전하지 않게 잊는다.
function forgetAccessToken(): void {
  accessTokenExpiresAt = 0;
}

function isNearExpiry(): boolean {
  if (accessTokenExpiresAt === 0) return false;
  return accessTokenExpiresAt - Date.now() <= TOKEN_REFRESH_MARGIN_MS;
}

// 로그인·세션 확인 응답도 수명을 실어 온다 — 디코딩하는 그 자리에서 시각으로 바꾼다.
// (회전 응답은 refreshSession이 직접 찍는다)
function decodeAndNoteSession(v: JsonValue): SessionUser {
  const session = decodeSessionUser(v);
  accessTokenExpiresAt = Date.now() + session.accessTokenTtlMs;
  return session;
}

let refreshing: Promise<RefreshResult> | null = null;

function refreshSession(): Promise<RefreshResult> {
  refreshing ??= (async () => {
    try {
      const res = await fetchOrThrow('/auth/refresh', { method: 'POST' });
      if (!res.ok) {
        log.auth('refresh', { outcome: 'rejected', status: res.status });
        // 401·403은 리프레시 자격증명 자체가 죽었다는 뜻이다 — 되살릴 수 있는 세션이
        // 아니다. 5xx는 서버 사정일 뿐이라 세션을 끊지 않는다.
        const rejected = res.status === 401 || res.status === 403;
        // 확정 거부면 이 세션의 토큰은 다시 살아나지 않는다.
        if (rejected) forgetAccessToken();
        return { ok: false, ttlMs: null, rejected };
      }
      // 쿠키 흐름의 갱신 응답은 { user, accessTokenTtlMs }(토큰은 쿠키로만).
      try {
        const { accessTokenTtlMs } = decodeSessionUser(await jsonBodyOf(res));
        accessTokenExpiresAt = Date.now() + accessTokenTtlMs;
        log.auth('refresh', { outcome: 'rotated' });
        return { ok: true, ttlMs: accessTokenTtlMs, rejected: false };
      } catch {
        log.auth('refresh', { outcome: 'rotated_undecodable' });
        return { ok: true, ttlMs: null, rejected: false };
      }
    } catch {
      log.auth('refresh', { outcome: 'network_error' });
      return { ok: false, ttlMs: null, rejected: false };
    } finally {
      // 다음 만료 때 다시 시도할 수 있도록 비운다.
      refreshing = null;
    }
  })();
  return refreshing;
}

// 세션의 뒷일을 **스스로 쥔** 경로. 확정 실패를 여기서 알리지 않는다 — AuthProvider가
// 그 응답으로 이미 상태를 정리한다.
//
// `/auth/me`를 빼는 이유가 하나 더 있다: **자격증명이 없는 첫 방문도 401**이다. 그것을
// "다른 기기에서 해제됨"으로 알리면 처음 온 사람에게 엉뚱한 안내가 뜬다.
const SESSION_OWNED_PATHS = new Set(['/auth/refresh', '/auth/me', '/auth/logout']);

// 401의 뒷일을 맡을 세션의 주인. 조립하는 곳(AuthProvider)에서 꽂는다 — api 모듈이
// 인증 상태를 직접 알면 고리가 된다.
export interface SessionAuthority {
  /**
   * 지금 세션의 표식. 요청을 **보내는 시점**에 찍어 두고 401의 뒷일까지 그대로 들고 간다.
   *
   * 응답이 돌아오기 전에 로그아웃하고 다시 로그인하면 그 401은 **끝난 세션**의 것이다.
   * 웹은 쿠키가 자동으로 실려 나가 네이티브처럼 토큰을 비교할 수조차 없으니, 옛 요청이
   * 새 세션을 회전시키거나 끊는 것을 막는 수단은 이 표식뿐이다.
   */
  mark(): number;

  /** 서버가 **확정한** 인증 실패. 그 표식의 세션이 아직 현재일 때만 정리한다. */
  reject(mark: number): void;
}

let authority: SessionAuthority | null = null;

export function setSessionAuthority(next: SessionAuthority | null): void {
  authority = next;
}

// 갱신으로는 살아나지 않는 401인가 — 폐기·변조. 만료(SESSION_EXPIRED)와 다르다.
function isDefinitiveAuthFailure(code: string): boolean {
  return (
    code === AUTH_ERROR_CODES.UNAUTHORIZED ||
    code === AUTH_ERROR_CODES.INVALID_TOKEN
  );
}

// 세션의 주인에게 "이 세션은 끝났다"고 알린다. 뒷일을 스스로 쥔 경로는 알리지 않는다
// (위 SESSION_OWNED_PATHS 참고).
function notifyRejected(path: string, mark: number | null): void {
  forgetAccessToken();
  if (mark === null || SESSION_OWNED_PATHS.has(path)) return;
  authority?.reject(mark);
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
  // 만료가 임박했으면 **보내기 전에** 회전한다.
  //
  // 타이머로 미리 돌지 않는 이유: 요청이 없는 동안에도 세션을 밀면 idle 타임아웃이
  // 무의미해진다 — 탭만 열어두면 absolute 상한까지 살아 있게 된다. 요청이 있을 때만
  // 보므로 유휴 상태에서는 아무 트래픽도 나가지 않고, 그러면서도 만료된 요청을 보내
  // 401을 받고 되돌리는 왕복을 아낀다.
  //
  // 실패해도 그대로 보낸다 — 정말 만료였다면 아래 반응형 경로가 받아 낸다.
  // 여기는 정확성이 아니라 최적화다. (single-flight라 겹쳐 불려도 요청은 한 번이다)
  if (!SESSION_OWNED_PATHS.has(path) && isNearExpiry()) {
    await refreshSession();
  }
  // 표식은 **보내기 전에** 찍는다 — 응답이 돌아왔을 때 그사이 세션이 갈렸는지는
  // 이 값으로만 알 수 있다. 위 회전을 기다리는 동안에도 세션은 갈릴 수 있으므로
  // 찍는 것은 회전 **뒤**다.
  const mark = authority?.mark() ?? null;
  const res = await fetchOrThrow(path, init);
  // 갱신 경로 자체만 재시도에서 뺀다 — 여기서 갱신하면 무한 루프가 된다.
  if (res.status !== 401 || path === '/auth/refresh') return res;
  // body는 한 번만 읽을 수 있다 — 코드 확인은 사본으로 하고 원본은 호출부에 그대로 넘긴다.
  const code = await errorCodeOf(res.clone());
  // 그사이 세션이 갈렸다면 이 401은 **남의 것**이다 — 새 세션을 회전시키지도, 끊지도
  // 않는다(로그아웃 직후 다시 로그인하면 실제로 그렇게 겹친다).
  //
  // 주인이 아직 안 꽂혔다면(mark === null) 표식으로 가릴 것이 없다 — 그때는 갱신·재시도만
  // 하고 알리지는 않는다. 여기서 막아 버리면 앱이 뜨는 첫 `/auth/me`가 갱신 기회를 잃는다.
  if (mark !== null && mark !== authority?.mark()) return res;

  if (code === AUTH_ERROR_CODES.SESSION_EXPIRED) {
    const rotated = await refreshSession();
    // 회전을 기다리는 사이에도 세션은 갈릴 수 있다 — 여기서 다시 보지 않으면 옛 요청이
    // **새 세션의 쿠키로** 재시도된다.
    if (mark !== null && mark !== authority?.mark()) return res;
    if (!rotated.ok) {
      // 갱신이 확정 거부됐다면 되살릴 수 있는 세션이 아니다 — 화면이 "불러오지
      // 못했습니다"를 띄우고 마는 대신 세션의 주인이 정리하게 알린다.
      if (rotated.rejected) notifyRejected(path, mark);
      return res;
    }
    const retried = await fetchOrThrow(path, init);
    // 방금 회전한 자격증명까지 거부됐다면 되살릴 수 있는 세션이 아니다.
    if (
      retried.status === 401 &&
      isDefinitiveAuthFailure(await errorCodeOf(retried.clone()))
    ) {
      notifyRejected(path, mark);
    }
    return retried;
  }
  // 갱신으로는 살아나지 않는 401 — 다른 기기에서 이 세션을 해제한 경우가 대표적이다.
  if (isDefinitiveAuthFailure(code)) notifyRejected(path, mark);
  return res;
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
    requestJson('/auth/demo', decodeAndNoteSession, { method: 'POST' }),
  // 소셜 로그인은 fetch가 아니라 브라우저 이동(전체 페이지 또는 popup)으로 시작한다.
  // flow는 서버가 서명된 state에 실어 콜백까지 가져가고, 결과 전달 방식을 결정한다.
  socialLoginUrl: (provider: SocialProvider, flow: SocialFlow) =>
    `${API_URL}/auth/${provider}?flow=${flow}`,
  // 쿠키 세션의 유효성은 서버만 알 수 있다(JS가 HttpOnly 쿠키를 못 읽는다). 응답에는
  // 사용자와 액세스 토큰 수명(accessTokenTtlMs)이 담긴다 — 후자로 선제 갱신을 스케줄한다.
  me: () => requestJson('/auth/me', decodeAndNoteSession),
  // 서버가 쿠키를 지워야 로그아웃이 성립한다.
  logout: () =>
    requestEmpty('/auth/logout', { method: 'POST' }).finally(forgetAccessToken),
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
