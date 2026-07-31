// 서버·웹 공유 API 계약 — 진실의 원천(single source of truth).
// 타입·순수 상수·디코더(순수 함수)만 둔다(프레임워크·라이브러리 의존 금지 — 웹이 그대로 컴파일한다).
// 수정 후 `pnpm sync:contracts`로 웹 사본(apps/web/src/lib/contracts.gen.ts)을 재생성할 것.
// 동기화가 어긋나면 contracts.spec.ts(drift 테스트)가 실패한다.

export const AUTH_PROVIDERS = ['google', 'apple', 'demo'] as const;
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

// 로그인 응답(데모 POST /auth/demo · Apple native POST /auth/apple/native).
export interface AuthSession {
  accessToken: string;
  user: User;
}

// ── 오류 코드 (전부 여기서 관리 — 값 원천은 아래 상수 두 개뿐) ──

// 서버가 redirect 쿼리(?error=…) 또는 오류 응답({error:…})으로 전달하는 코드.
export const AUTH_ERROR_CODES = {
  SIGNIN_FAILED: 'SIGNIN_FAILED',
  DEMO_DISABLED: 'DEMO_DISABLED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
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
    user: decodeUser(obj.user),
  };
}
