// GENERATED FILE — DO NOT EDIT.
// 원본: apps/server/libs/common/src/types/contracts.ts
// 재생성: apps/server에서 `pnpm sync:contracts`

// 서버·웹 공유 API 계약 — 진실의 원천(single source of truth).
// 타입·순수 상수·디코더(순수 함수)만 둔다(프레임워크·라이브러리 의존 금지 — 웹이 그대로 컴파일한다).
// 수정 후 `pnpm sync:contracts`로 웹 사본(apps/web/src/lib/contracts.gen.ts)을 재생성할 것.
// 동기화가 어긋나면 contracts.spec.ts(drift 테스트)가 실패한다.

export const AUTH_PROVIDERS = ['google', 'apple', 'kakao', 'demo'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

// OAuth가 실제로 다루는 provider(데모 제외). AuthProvider에서 파생해 중복 union을 막는다.
export type SocialProvider = Exclude<AuthProvider, 'demo'>;

// 런타임 검증용 목록 — AUTH_PROVIDERS에서 파생하므로 provider 추가 시 자동 동기화된다.
export const SOCIAL_PROVIDERS: readonly SocialProvider[] =
  AUTH_PROVIDERS.filter((p): p is SocialProvider => p !== 'demo');

// 클라이언트에 반환되는 사용자 모델. 개인정보 미저장 정책에 따라 email은 없고,
// displayName은 DB가 아니라 세션(JWT)에서만 채워진다. (plan/auth.md 참고)
export interface User {
  id: string;
  provider: AuthProvider;
  displayName: string;
  createdAt: string;
}

// 네이티브(iOS/Android) 로그인 응답 — POST /auth/apple/native,
// 그리고 자격증명을 body로 보낸 POST /auth/refresh.
//
// **쿠키 흐름에는 쓰지 않는다.** 쿠키로 인증되는 요청이 토큰까지 body로 돌려주면
// HttpOnly가 무의미해지므로, 그런 경로는 SessionUser를 반환한다.
// 네이티브는 쿠키 저장소가 부자연스러워 Bearer를 유지하고, 안전한 저장소
// (Keychain/EncryptedSharedPreferences)에 보관한다. (plan/auth.md 세션 정책)
export interface AuthSession {
  accessToken: string;
  // 액세스 토큰이 만료됐을 때 세션을 이어가는 자격증명(1회용 — 쓰면 회전된다).
  // 웹은 이 값을 만지지 않는다: 서버가 HttpOnly 쿠키로 심는다. 네이티브는 안전한
  // 저장소(Keychain/EncryptedSharedPreferences)에 보관하고 POST /auth/refresh에 쓴다.
  refreshToken: string;
  user: User;
}

// 내 세션 하나의 요약(GET /auth/sessions). 기기·위치를 알 수 있는 값은 담지 않는다 —
// 목록을 보기 좋게 만들자고 User-Agent나 IP를 저장하면 개인정보 미저장 원칙이 깨진다.
export interface SessionInfo {
  id: string;
  startedAt: string;
  expiresAt: string;
}

// 서버가 "지금 이 요청의 세션"을 표시해 돌려준다 — 클라이언트가 자기 세션 id를
// 알 방법이 없기 때문이다(세션 id는 HttpOnly 쿠키 안의 토큰에만 있다).
export interface SessionListItem extends SessionInfo {
  isCurrent: boolean;
}

export function decodeSessionListItem(
  v: JsonValue | undefined,
): SessionListItem {
  const obj = decodeObject(v, 'SessionListItem');
  if (typeof obj.isCurrent !== 'boolean') {
    throw new Error('SessionListItem.isCurrent: expected boolean');
  }
  return {
    id: decodeString(obj.id, 'SessionListItem.id'),
    startedAt: decodeString(obj.startedAt, 'SessionListItem.startedAt'),
    expiresAt: decodeString(obj.expiresAt, 'SessionListItem.expiresAt'),
    isCurrent: obj.isCurrent,
  };
}

export function decodeSessionList(v: JsonValue): SessionListItem[] {
  if (!Array.isArray(v)) throw new Error('SessionList: expected array');
  return v.map(decodeSessionListItem);
}

// 쿠키 흐름(웹)의 로그인·갱신 응답.
//
// **토큰을 담지 않는다.** 세션 쿠키를 HttpOnly로 만든 이유가 "브라우저 JS가 토큰을
// 만질 수 없게" 하는 것인데, 같은 값을 body로도 돌려주면 XSS가 fetch 한 번으로
// 7일짜리 자격증명을 가져갈 수 있어 방어가 무의미해진다.
// (웹 클라이언트가 body를 안 읽는다는 것은 방어가 아니다 — 다른 스크립트가 읽는다)
export interface SessionUser {
  user: User;
  // 액세스 토큰이 만료되기까지 남은 시간(ms). 토큰·비밀이 아니라 수명값일 뿐이라
  // body에 실어도 HttpOnly 방어와 무관하다. 웹이 "언제 선제적으로 세션을 회전(갱신)할지"
  // 스케줄하는 데 쓴다 — HttpOnly 쿠키라 클라이언트가 토큰의 exp를 직접 읽을 수 없다.
  accessTokenTtlMs: number;
}

export function decodeSessionUser(v: JsonValue): SessionUser {
  const obj = decodeObject(v, 'SessionUser');
  return {
    user: decodeUser(obj.user),
    accessTokenTtlMs: decodePositiveInt(
      obj.accessTokenTtlMs,
      'SessionUser.accessTokenTtlMs',
    ),
  };
}

// ── 소셜 로그인 흐름 ──

// redirect: 전체 페이지 이동 후 웹 콜백 라우트로 복귀(모바일 브라우저 기본).
// popup: 별도 창에서 진행하고 결과만 opener로 postMessage(데스크톱 기본 — 로그인 화면의
// 입력/상태가 보존되고, 뒤로 가기 복원 문제 자체가 생기지 않는다).
export const SOCIAL_FLOWS = ['redirect', 'popup'] as const;
export type SocialFlow = (typeof SOCIAL_FLOWS)[number];

// popup 흐름의 결과를 opener로 전달하는 메시지. 서버가 만든 콜백 페이지가 postMessage로
// 보내고, 웹은 origin과 이 type을 함께 확인한 뒤에만 수용한다.
export const OAUTH_MESSAGE_TYPE = 'prism:oauth';

export interface OAuthPopupMessage {
  type: typeof OAUTH_MESSAGE_TYPE;
  ok: boolean;
  // ok=false일 때만: AUTH_ERROR_CODES 값. 사용자가 취소한 경우엔 없다(조용히 복귀).
  error?: string;
}

// postMessage로 들어온 임의의 값에서 우리 메시지만 골라낸다(형식이 다르면 null).
// 같은 origin이라도 다른 스크립트가 메시지를 보낼 수 있어 형태 검증이 필요하다.
export function decodeOAuthPopupMessage(
  v: JsonValue | undefined,
): OAuthPopupMessage | null {
  if (v === undefined || v === null || typeof v !== 'object') return null;
  if (Array.isArray(v)) return null;
  if (v.type !== OAUTH_MESSAGE_TYPE || typeof v.ok !== 'boolean') return null;
  return {
    type: OAUTH_MESSAGE_TYPE,
    ok: v.ok,
    error: typeof v.error === 'string' && v.error ? v.error : undefined,
  };
}

// ── 오류 코드 (전부 여기서 관리 — 값 원천은 아래 상수 두 개뿐) ──

// 서버가 redirect 쿼리(?error=…) 또는 오류 응답({error:…})으로 전달하는 코드.
export const AUTH_ERROR_CODES = {
  SIGNIN_FAILED: 'SIGNIN_FAILED',
  DEMO_DISABLED: 'DEMO_DISABLED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  // 자격증명은 실려 왔지만 액세스 토큰의 수명이 끝났다 — **갱신하면 살아나는** 401.
  //
  // UNAUTHORIZED와 나누는 이유는 클라이언트가 "지금 갱신을 시도할 가치가 있는가"를
  // 알 방법이 이것뿐이기 때문이다. 세션은 HttpOnly 쿠키라 JS가 들여다볼 수 없으므로,
  // 구분이 없으면 한 번도 로그인한 적 없는 첫 방문조차 반드시 실패할 /auth/refresh를
  // 한 번 더 부르게 되고(왕복 2회) 그 호출이 갱신 레이트리밋까지 깎는다.
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  // 쿠키가 실릴 수 있는 상태 변경 요청이 허용되지 않은 출처에서 왔다(CSRF 차단).
  // 정상 클라이언트는 볼 일이 없다 — 뜨면 CORS 허용 목록 설정을 의심할 것.
  FORBIDDEN_ORIGIN: 'FORBIDDEN_ORIGIN',
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

// 클라이언트(웹/모바일)가 로컬에서 만드는 코드 — 서버는 절대 발신하지 않는다.
export const CLIENT_ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR', // fetch 자체 실패(오프라인·서버 다운 등)
  REQUEST_FAILED: 'REQUEST_FAILED', // 오류 응답인데 body에 코드가 없을 때의 기본값
  INVALID_RESPONSE: 'INVALID_RESPONSE', // 성공 응답이지만 body가 계약 형식이 아닐 때
} as const;

export type ClientErrorCode =
  (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES];

// 클라이언트 오류 처리 분기가 다루는 전체 코드 공간.
export type ApiErrorCode = AuthErrorCode | ClientErrorCode;

// ── 경계 디코딩 (parse, don't validate) ──
// 외부(네트워크)에서 파싱된 JSON을 계약 타입으로 "구성"한다. 형식이 어긋나면 throw —
// as 단언 없이, unknown/any 없이 미검증 상태를 JsonValue로 표현한다.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// JSON.parse / res.json()의 any를 JsonValue 경계로 들여오는 유일한 통로.
// (함수 참조에 타입을 선언해 any가 코드에 나타나지 않는다. 이후 접근은 전부 디코더를 거친다)
export const parseJsonValue: (text: string) => JsonValue = JSON.parse;

export function jsonBodyOf(res: Response): Promise<JsonValue> {
  return res.json();
}

// 인자에 undefined를 허용하는 이유: 객체 인덱스 접근(obj.key)이 부재 키에서 undefined를
// 주므로(noUncheckedIndexedAccess), "키 없음"도 형식 오류로 한 곳에서 처리한다.
export function decodeObject(
  v: JsonValue | undefined,
  label: string,
): { [key: string]: JsonValue } {
  if (
    v === undefined ||
    v === null ||
    typeof v !== 'object' ||
    Array.isArray(v)
  ) {
    throw new Error(`${label}: expected object`);
  }
  return v;
}

// 계약의 문자열 필드(id·토큰·타임스탬프 등)는 전부 비어 있으면 무의미하다 — 빈 값도 형식 오류.
export function decodeString(v: JsonValue | undefined, label: string): string {
  if (typeof v !== 'string' || v === '') {
    throw new Error(`${label}: expected non-empty string`);
  }
  return v;
}

// 계약의 수명·개수 필드(ms TTL 등) — 양의 **정수**만 유효하다.
// 음수·0·NaN·Infinity는 물론, 소수와 안전 정수 범위(2^53-1) 밖의 값도 형식 오류다:
// 그런 값은 네이티브(Swift `Int`)가 그대로 받지 못해 플랫폼마다 해석이 갈린다.
// `Number.isSafeInteger`가 유한·정수·안전범위를 한 번에 검사한다.
export function decodePositiveInt(
  v: JsonValue | undefined,
  label: string,
): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
    throw new Error(`${label}: expected positive integer`);
  }
  return v;
}

export function decodeUser(v: JsonValue | undefined): User {
  const obj = decodeObject(v, 'User');
  const provider = AUTH_PROVIDERS.find((p) => p === obj.provider);
  if (!provider) throw new Error('User.provider: unknown provider');
  return {
    id: decodeString(obj.id, 'User.id'),
    provider,
    displayName: decodeString(obj.displayName, 'User.displayName'),
    createdAt: decodeString(obj.createdAt, 'User.createdAt'),
  };
}

export function decodeAuthSession(v: JsonValue): AuthSession {
  const obj = decodeObject(v, 'AuthSession');
  return {
    accessToken: decodeString(obj.accessToken, 'AuthSession.accessToken'),
    refreshToken: decodeString(obj.refreshToken, 'AuthSession.refreshToken'),
    user: decodeUser(obj.user),
  };
}
