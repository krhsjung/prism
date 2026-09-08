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
  // 액세스 토큰이 만료되기까지 남은 시간(ms) — `SessionUser`가 담는 것과 같은 값이다.
  //
  // 네이티브 클라이언트가 **선제 갱신을 언제 걸지** 정하는 데 쓴다. 앱은 토큰을 열어
  // 보지 않으므로(그럴 이유도 없다) 만료 시각을 알 방법이 이것뿐이고, 이 값이 없으면
  // 로그인 직후부터 다음 `/auth/me`까지는 스케줄을 걸 수 없다.
  // 토큰·비밀이 아니라 수명값이라 body에 실어도 잃을 것이 없다.
  accessTokenTtlMs: number;
}

// 세션을 만든 기기의 **종류**. 정해진 갈래 + 모름뿐이고, 그 이상은 담지 않는다.
//
// 목록에서 "어느 기기의 세션인가"를 알아보려면 단서가 필요하다. 알아볼 수 있는 만큼은
// 브랜드까지 좁히되(iPhone·iPad·Galaxy·Pixel), 모르면 넓은 쪽으로 둔다 — 없는 정보를
// 지어내지 않는 것이 이 목록의 규칙이다.
//
// **갈래가 늘어도 저장하는 성질은 그대로다.** User-Agent 원문도 IP도 저장하지 않고,
// 로그인 시점에 이 enum 하나로 줄여서만 남긴다(plan/dashboard.md §5). 'iPhone'은 수억
// 대가 공유하는 값이라 그 자체로 누군가를 가리키지 않는다 — 식별로 이어지는 것은 모델·
// 버전·IP처럼 **좁은** 값이고, 그것들은 여기서 접혀 사라진다.
export const DEVICE_KINDS = [
  'iphone',
  'ipad',
  'galaxy',
  'pixel',
  'android',
  'mac',
  'windows',
  'desktop',
  'unknown',
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

// 내 세션 하나의 요약(GET /auth/sessions). 기기 종류 외에 기기를 특정할 수 있는 값은
// 담지 않는다 — User-Agent 원문이나 IP를 저장하면 개인정보 미저장 원칙이 깨진다.
export interface SessionInfo {
  id: string;
  startedAt: string;
  expiresAt: string;
  device: DeviceKind;
  // 이 세션을 **푸시로 깨울 수 있는가.** 등록 토큰이 아니라 파생 불리언만 내려간다 —
  // 목록에는 남의 기기 행도 있고, 토큰은 **설치 단위**라 세션보다 오래 산다. 응답에
  // 실으면 devtools·HAR·스크린샷에 사본이 남고 그것들은 세션 만료를 따라가지 않는다
  // (plan/push.md §5-3).
  //
  // 보안 장치가 아니라 **UI 편의**다: 이 값이 없으면 눌러도 아무 일이 없는 대상이
  // 목록에 섞이고 사용자가 이유를 알 수 없다.
  pushRegistered: boolean;
}

// 서버가 "지금 이 요청의 세션"을 표시해 돌려준다 — 클라이언트가 자기 세션 id를
// 알 방법이 없기 때문이다(세션 id는 HttpOnly 쿠키 안의 토큰에만 있다).
export interface SessionListItem extends SessionInfo {
  isCurrent: boolean;
  // 이 세션이 **지금 소켓을 붙들고 있는가.** 세션의 유효성이 아니라 연결의 유무다 —
  // 백그라운드로 내린 앱은 유효한 세션이지만 연결은 없다.
  //
  // ⚠️ 값을 그대로 화면에 옮기지 않는다. 소켓 서비스가 죽으면 presence가 통째로 비어
  // "아무도 안 붙음"과 구별되지 않으므로, 클라이언트는 **자기 소켓이 ready일 때만**
  // 이 값을 믿고 아니면 예전 2상태(Current/Active)로 후퇴한다.
  isConnected: boolean;
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
    // isCurrent와 달리 **없어도 거부하지 않는다.** 이 필드가 생기기 전 서버 응답과
    // 섞이는 순간(롤링 배포)에 목록 전체가 실패하면 안 된다 — device를 unknown으로
    // 접는 것과 같은 규칙이다. 배지 하나 때문에 카드가 통째로 오류가 되는 쪽이 손해가 크다.
    isConnected: obj.isConnected === true,
    // isConnected와 **같은 규칙**으로 접는다 — 이 필드가 생기기 전 서버 응답과 섞여도
    // 목록 전체가 실패하면 안 된다.
    pushRegistered: obj.pushRegistered === true,
    device: decodeDeviceKind(obj.device),
  };
}

// 모르는 값은 거부하지 않고 `unknown`으로 접는다 — 기기 종류는 화면의 라벨일 뿐이라,
// 나중에 갈래가 하나 늘었다고 예전 클라이언트에서 목록 전체가 실패하면 손해가 더 크다.
export function decodeDeviceKind(v: JsonValue | undefined): DeviceKind {
  return DEVICE_KINDS.find((kind) => kind === v) ?? 'unknown';
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
// native: 네이티브 앱이 시스템 웹 세션(ASWebAuthenticationSession 등)으로 여는 웹 OAuth.
// 콜백은 쿠키/웹 페이지가 아니라 커스텀 스킴으로 **일회용 코드**를 앱에 돌려주고, 앱이
// 그 코드를 토큰으로 교환한다(POST /auth/native/exchange). 쿠키를 안 쓰는 네이티브가
// 웹 redirect 흐름으로도 Bearer 세션을 받게 하는 경로다.
export const SOCIAL_FLOWS = ['redirect', 'popup', 'native'] as const;
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

// ── 세션 소켓(presence) 프로토콜 ──
//
// socket 서비스가 여는 WebSocket. 대시보드의 "지금 붙어 있는가"(SessionListItem.isConnected)를
// 실시간으로 알리는 것이 유일한 용도다.
//
// **이 소켓은 데이터를 나르지 않는다. 신호만 나른다.**
// 목록을 실어 보내면 편할 것 같지만, 그러면 클라이언트가 세션 목록을 얻는 경로가 둘이 된다.
// 그런데 스탬핑·공유 회전·stale 응답 거부·중앙화된 "세션 종료" 공지는 **HTTP 경로에만**
// 붙어 있다(plan/auth.md §6.3). 소켓이 목록을 직접 주입하면 그 넷을 전부 우회하고,
// 특히 **세션 N이 연 소켓이 세션 N+1의 화면에 목록을 밀어 넣는** 경로가 열린다.
// 신호만 나르고 목록은 늘 GET /auth/sessions로 다시 가져오면 그 문제가 존재할 수 없다.
export const SOCKET_PATH = '/socket';

export const SOCKET_SERVER_MESSAGE_TYPES = [
  'ready',
  'sessionsChanged',
  'heartbeat',
  'error',
] as const;
export type SocketServerMessageType =
  (typeof SOCKET_SERVER_MESSAGE_TYPES)[number];

// 서버 → 클라.
//
// presence는 서버가 **소켓의 존재만** 보고 판단한다 — 클라이언트가 "나 살아 있다"고
// 주장하게 두면 반쯤 죽은 소켓이 계속 Active로 남는다. 그 규칙은 그대로이고,
// 아래 `SessionClientMessage`도 그것을 주장하지 않는다(재검증을 청할 뿐이다).
export type SocketServerMessage =
  // 인증을 통과했다. 클라이언트가 isConnected를 **믿어도 되는 시점**의 신호다 —
  // ready 전에는 소켓 서비스가 살아 있는지 알 수 없어 빈 presence가 "아무도 안 붙음"과
  // 구별되지 않는다(그래서 그때까지는 두 갈래로 후퇴한다).
  //
  // ⚠️ **목록을 가져오라는 신호가 아니다.** 연결 직후 서버가 보내는 sessionsChanged가
  // 방금 붙은 이 연결에게도 오므로, 양쪽이 다 가져오면 조회가 두 번 나간다.
  // 재연결 때도 같다 — 뒤따르는 sessionsChanged 하나가 곧 새로고침이 된다.
  | { type: 'ready' }
  // 이 사용자의 연결 구성이 바뀌었다(누가 붙었거나·끊겼거나·폐기됐다). 다시 가져와라.
  // 페이로드가 없으므로 멱등하고 순서 문제가 없다.
  | { type: 'sessionsChanged' }
  // 살아 있다는 신호(PRESENCE_RENEW_MS 주기). 브라우저 JS는 프로토콜 ping/pong을
  // 보내지도 관찰하지도 못해서, 이것이 없으면 웹이 죽은 서버를 몇 시간이고 붙들고 있는다.
  // 클라이언트는 일정 시간 침묵을 죽음으로 보고 재연결한다.
  | { type: 'heartbeat' }
  // 직후 close(1008)이 따라온다. 코드는 HTTP와 **같은** AUTH_ERROR_CODES다 —
  // 클라이언트가 이미 "갱신하면 살아나는가"(SESSION_EXPIRED) 분기를 갖고 있다.
  | { type: 'error'; code: AuthErrorCode };

export function decodeSocketServerMessage(
  v: JsonValue | undefined,
): SocketServerMessage {
  const obj = decodeObject(v, 'SocketServerMessage');
  const type = SOCKET_SERVER_MESSAGE_TYPES.find((t) => t === obj.type);
  // 모르는 type은 거부한다 — DeviceKind와 달리 이것은 화면 라벨이 아니라 **동작**이라,
  // 접어서 아무 갈래로 보내면 하지 말아야 할 일을 한다.
  if (!type) throw new Error('SocketServerMessage.type: unknown type');
  if (type !== 'error') return { type };
  const code = Object.values(AUTH_ERROR_CODES).find((c) => c === obj.code);
  if (!code) throw new Error('SocketServerMessage.code: unknown error code');
  return { type, code };
}

export const SESSION_CLIENT_MESSAGE_TYPES = ['sessionsRevoked'] as const;
export type SessionClientMessageType =
  (typeof SESSION_CLIENT_MESSAGE_TYPES)[number];

/**
 * 클라 → 서버(세션).
 *
 * **presence를 주장하지 않는다.** 그 방향을 열지 않았던 이유는 그대로 유효하다 —
 * 살아 있다는 주장을 믿으면 반쯤 죽은 소켓이 Active로 남는다. 이것은 주장이 아니라
 * **재검증 요청**이고, 서버는 이 말을 믿는 대신 세션 저장소를 자기가 다시 읽는다.
 * 그래서 이 메시지에는 아무 권한도 실려 있지 않다(무엇을 폐기했는지조차 말하지 않는다).
 */
export type SessionClientMessage =
  // 방금 이 사용자의 세션을 폐기했다(HTTP로). 지금 다시 확인해 달라 —
  // 폐기된 소켓은 끊고, 나머지에게는 `sessionsChanged`를 보내라.
  //
  // 없어도 스윕(PRESENCE_RENEW_MS)이 결국 같은 일을 하지만, 해제한 사람은 상대 기기가
  // **즉시** 쫓겨나기를 기대한다. 소켓이 이미 붙어 있으니 서비스 간 채널을 새로 놓는
  // 대신 그 소켓으로 깨운다.
  { type: 'sessionsRevoked' };

// ── 통화 시그널링 프로토콜 ──
//
// 위 presence와 **같은 소켓**을 쓰지만 계약은 갈라 둔다. 이 저장소에서 클라 → 서버
// 방향이 여기서 처음 열리는데, 지금까지 단방향이었던 이유는 그대로 유효하기 때문이다:
// `isConnected`는 여전히 **소켓의 존재만** 보고 정해지고, 아래 메시지들은 살아 있다는
// 증거로 쓰이지 않는다(plan/webrtc.md §5). 그래서 이름을 둘로 나눈다 —
// `SocketServerMessage`(presence, 위)와 `CallClientMessage`/`CallServerMessage`(통화).
//
// **미디어는 이 소켓을 지나지 않는다.** 서버가 나르는 것은 상대를 찾는 신호와 SDP·ICE
// 문자열뿐이고, 연결이 서면 그 뒤로는 P2P다. 녹화도 저장도 없다.

// 벨의 상한. **서버 상수이고 클라이언트는 재지 않는다** — 양쪽이 재면 시계가 두 벌이
// 되고 언젠가 어긋난다. 지나면 서버가 양쪽에 ended{'timeout'}을 보내고 통화를 지운다.
//
// 45초는 **소켓 경로에 맞춘 값**이다(상대 앱이 이미 열려 있는 경우). 푸시로 깨우는
// 경로를 이 창에 맞추려고 늘리지 않는다 — 늘리면 거는 쪽이 빈 화면을 더 오래 본다.
export const RING_TIMEOUT_MS = 45_000;

// 릴레이가 나르는 문자열의 상한(plan/webrtc.md §7). 서버는 SDP를 해석하지 않으므로
// 길이와 형식이 여기서 볼 수 있는 전부이고, 상한이 없으면 소켓이 임의 크기 릴레이가 된다.
// 실제 offer/answer는 코덱이 많아도 5~10 kB 대이고, 후보 한 줄은 200자 안쪽이다.
export const MAX_SDP_LENGTH = 16_384;
export const MAX_ICE_CANDIDATE_LENGTH = 1_024;
export const MAX_SDP_MID_LENGTH = 64;
// 세션 id(uuid)가 들어올 자리의 상한. 넉넉하되 무제한은 아니다 — 프레임 상한까지 채운
// 문자열을 목록과 비교하게 둘 이유가 없다.
export const MAX_SESSION_ID_LENGTH = 128;

// 클라이언트가 RTCPeerConnection에 그대로 넘기는 ICE 서버 하나.
//
// 목록은 `accepted`와 함께 소켓이 내려준다 — 값은 전부 env에서 오고 레포에는 호스트도
// 자격증명도 없다(§7). 화면에도 띄우지 않는다.
export interface IceServer {
  urls: string[];
  // TURN에만 있다. STUN은 자격증명을 쓰지 않는다.
  username?: string;
  credential?: string;
}

// 상대를 가리키는 값은 **기기 종류뿐**이다 — 화면이 필요로 하는 전부이고, 그 이상은
// 담지 않는다(SessionInfo가 User-Agent 원문도 IP도 담지 않는 것과 같은 선).
export interface SessionRef {
  id: string;
  device: DeviceKind;
}

// 후보 하나. 브라우저의 `RTCIceCandidateInit`을 그대로 옮긴 모양이라 클라이언트는
// `event.candidate.toJSON()`을 그대로 실어 보낼 수 있다.
export interface IceCandidate {
  candidate: string;
  // **후보 문자열만으로는 붙일 수 없다.** `addIceCandidate`는 sdpMid와 sdpMLineIndex가
  // 둘 다 없으면 거부하고, 브라우저는 둘 중 적어도 하나를 채워 준다. 서버는 릴레이라
  // 어느 쪽인지 고르지 않고 온 것을 그대로 넘긴다.
  sdpMid?: string;
  sdpMLineIndex?: number;
}

export const CALL_CLIENT_MESSAGE_TYPES = [
  'call',
  'accept',
  'decline',
  'cancel',
  'offer',
  'answer',
  'ice',
  'hangup',
  'resume',
] as const;
export type CallClientMessageType = (typeof CALL_CLIENT_MESSAGE_TYPES)[number];

// 클라 → 서버. **callId는 담아도 발급하지는 않는다** — 서버가 준 것을 되돌려줄 뿐이다.
export type CallClientMessage =
  // 대상 세션 id. 내 세션이 아니면 서버가 unknown-session으로 거절한다.
  | { type: 'call'; to: string }
  | { type: 'accept'; callId: string }
  | { type: 'decline'; callId: string }
  // 거는 쪽이 벨을 접는다. 붙은 뒤로는 hangup의 자리다.
  | { type: 'cancel'; callId: string }
  | { type: 'offer'; callId: string; sdp: string }
  | { type: 'answer'; callId: string; sdp: string }
  | { type: 'ice'; callId: string; candidate: IceCandidate }
  | { type: 'hangup'; callId: string }
  // 알림으로 열었다 — 이 통화가 아직 살아 있나. 소켓이 붙자마자 묻는다.
  | { type: 'resume'; callId: string };

export const CALL_SERVER_MESSAGE_TYPES = [
  'incoming',
  'ringing',
  'notified',
  'accepted',
  'claimed',
  'declined',
  'offer',
  'answer',
  'ice',
  'ended',
  'expired',
  'callError',
] as const;
export type CallServerMessageType = (typeof CALL_SERVER_MESSAGE_TYPES)[number];

// 통화가 끝난 이유. **통화의 성질이지 받는 사람의 사정이 아니다** — 같은 문장이 양쪽에
// 그대로 참이어야 벨을 함께 받았던 다른 탭에도 같은 메시지를 보낼 수 있다.
//  - hangup:    사람이 끊었다(거는 쪽의 취소 · 어느 쪽의 종료)
//  - peer-gone: 당사자의 소켓이 사라졌다
//  - timeout:   RING_TIMEOUT_MS가 지났다
export const CALL_END_REASONS = ['hangup', 'peer-gone', 'timeout'] as const;
export type CallEndReason = (typeof CALL_END_REASONS)[number];

// 통화를 시작할 수 없는 이유. **없는 세션과 남의 세션을 구별해 주지 않는다**
// (unknown-session 하나로 접는다) — 남의 세션 id를 넣어 존재를 떠보는 경로를 열지
// 않기 위해서다.
export const CALL_ERROR_CODES = [
  'unreachable',
  'busy',
  'unknown-session',
  'self',
] as const;
export type CallErrorCode = (typeof CALL_ERROR_CODES)[number];

// 서버 → 클라(위 presence 메시지와 같은 소켓으로 내려온다).
export type CallServerMessage =
  // 받는 쪽에 벨. 그 세션의 **모든** 연결에 간다 — 사용자가 어느 탭에 있는지 모른다.
  | { type: 'incoming'; callId: string; from: SessionRef }
  // 거는 쪽 — 상대에게 전달됐다.
  | { type: 'ringing'; callId: string }
  // 거는 쪽 — 상대에게 **소켓이 없어 푸시로 알렸다.**
  //
  // `ringing`과 갈라 두는 이유는 기다리는 성격이 다르기 때문이다: 알림이 뜨고 사람이
  // 기기를 집어 앱을 여는 시간이 창 안에 들어간다. 같은 `Ringing`으로 뭉뚱그리면 느린
  // 쪽이 고장으로 읽힌다(plan/webrtc.md §4). **창을 늘리지도 않는다** — 정상 결말은
  // `Call expired` + 되걸기다(§8-10). 푸시는 "기기를 울린다"가 아니라 "걸었다는 사실을
  // 알린다"이다.
  //
  // 상대가 나중에 앱을 열어도 거는 쪽은 `accepted`까지 이 상태로 남는다 — 기기가
  // 열렸을 뿐 아무도 받지 않았고, 서버는 `call` 하나에 답을 한 번만 한다.
  | { type: 'notified'; callId: string }
  // 양쪽에 간다. **이것을 받은 거는 쪽이 offer를 낸다** — 역할이 방향에서 나오므로
  // glare가 구조적으로 없다.
  | { type: 'accepted'; callId: string; iceServers: IceServer[] }
  // 벨을 **함께 받았지만 지지 않은** 연결에 간다 — 다른 탭·기기가 먼저 받았다.
  //
  // 이것이 없으면 그 창들이 통화 내내 벨을 붙들고 있다. `accepted`는 이긴 연결에만
  // 가고(창구가 하나여야 answer가 둘 나가지 않는다), `ended`는 통화가 끝나야 오므로
  // 그때까지 아무도 그 창을 닫아 주지 않는다. **끝이 아니라 "내 차례가 아니었다"라서
  // 알림도 남기지 않는다** — 다른 기기에서 받은 전화가 조용히 사라지는 것과 같다.
  | { type: 'claimed'; callId: string }
  | { type: 'declined'; callId: string }
  | { type: 'offer'; callId: string; sdp: string }
  | { type: 'answer'; callId: string; sdp: string }
  | { type: 'ice'; callId: string; candidate: IceCandidate }
  | { type: 'ended'; callId: string; reason: CallEndReason }
  // 알림을 늦게 열었다. 빈 화면 대신 무슨 일이었는지 그리라고 from을 함께 준다.
  //
  // ⚠️ **from은 없을 수 있다.** 서버가 그 통화를 더는 기억하지 못하거나(보존 창이 지났다)
  // 애초에 내 통화가 아니었으면 기기 종류를 지어내지 않는다 — 그 두 경우의 답이 같아야
  // 남의 callId를 떠보는 경로가 열리지 않는다. 화면은 그때 제목만 그린다.
  | { type: 'expired'; callId: string; from?: SessionRef }
  // callId가 없다 — `call`이 아직 통화를 얻지 못한 자리에서만 난다.
  | { type: 'callError'; code: CallErrorCode };

// 한 소켓으로 내려오는 것 전부. **두 계약을 합치는 것이 아니라 합집합만 둔다** —
// 디코더는 여전히 각자이고, 클라이언트는 type으로 어느 쪽인지 가른다.
export type SocketDownstreamMessage = SocketServerMessage | CallServerMessage;

// 겹치는 type 이름이 없어(presence는 `error`, 통화는 `callError`) 판별이 모호하지 않다.
// 클라 → 서버로 올라가는 모든 것. 내려오는 `SocketDownstreamMessage`와 대칭이다 —
// 두 도메인(세션·통화)이 **한 소켓을 나눠 쓰되 계약은 갈라져 있다**.
export type SocketUpstreamMessage = SessionClientMessage | CallClientMessage;

export function decodeSocketUpstreamMessage(
  v: JsonValue | undefined,
): SocketUpstreamMessage {
  const obj = decodeObject(v, 'SocketUpstreamMessage');
  return SESSION_CLIENT_MESSAGE_TYPES.some((t) => t === obj.type)
    ? decodeSessionClientMessage(obj)
    : decodeCallClientMessage(obj);
}

export function decodeSessionClientMessage(
  v: JsonValue | undefined,
): SessionClientMessage {
  const obj = decodeObject(v, 'SessionClientMessage');
  if (obj.type !== 'sessionsRevoked') {
    throw new Error('SessionClientMessage.type: unknown type');
  }
  return { type: 'sessionsRevoked' };
}

export function decodeSocketDownstreamMessage(
  v: JsonValue | undefined,
): SocketDownstreamMessage {
  const obj = decodeObject(v, 'SocketDownstreamMessage');
  return CALL_SERVER_MESSAGE_TYPES.some((t) => t === obj.type)
    ? decodeCallServerMessage(obj)
    : decodeSocketServerMessage(obj);
}

// 서버가 소켓으로 들어온 프레임을 들여오는 통로. 형식이 어긋나면 throw이고, 호출부는
// **연결을 끊지 않고 그 메시지만 버린다** — 클라이언트가 우리 메시지를 다루는 규칙과 같다.
export function decodeCallClientMessage(
  v: JsonValue | undefined,
): CallClientMessage {
  const obj = decodeObject(v, 'CallClientMessage');
  const type = CALL_CLIENT_MESSAGE_TYPES.find((t) => t === obj.type);
  // 모르는 type은 거부한다 — DeviceKind와 달리 이것은 화면 라벨이 아니라 **동작**이다.
  if (!type) throw new Error('CallClientMessage.type: unknown type');
  if (type === 'call') {
    // 세션 id 하나가 들어올 자리다 — 다른 문자열과 같은 규칙으로 길이를 잰다.
    return {
      type,
      to: decodeBoundedString(
        obj.to,
        'CallClientMessage.to',
        MAX_SESSION_ID_LENGTH,
      ),
    };
  }
  const callId = decodeString(obj.callId, 'CallClientMessage.callId');
  switch (type) {
    case 'offer':
    case 'answer':
      return { type, callId, sdp: decodeSdp(obj.sdp) };
    case 'ice':
      return { type, callId, candidate: decodeIceCandidate(obj.candidate) };
    default:
      return { type, callId };
  }
}

export function decodeCallServerMessage(
  v: JsonValue | undefined,
): CallServerMessage {
  const obj = decodeObject(v, 'CallServerMessage');
  const type = CALL_SERVER_MESSAGE_TYPES.find((t) => t === obj.type);
  if (!type) throw new Error('CallServerMessage.type: unknown type');
  if (type === 'callError') {
    const code = CALL_ERROR_CODES.find((c) => c === obj.code);
    if (!code) throw new Error('CallServerMessage.code: unknown error code');
    return { type, code };
  }
  const callId = decodeString(obj.callId, 'CallServerMessage.callId');
  switch (type) {
    case 'incoming':
      return { type, callId, from: decodeSessionRef(obj.from) };
    case 'accepted':
      return { type, callId, iceServers: decodeIceServers(obj.iceServers) };
    case 'offer':
    case 'answer':
      return { type, callId, sdp: decodeSdp(obj.sdp) };
    case 'ice':
      return { type, callId, candidate: decodeIceCandidate(obj.candidate) };
    case 'ended': {
      const reason = CALL_END_REASONS.find((r) => r === obj.reason);
      if (!reason) throw new Error('CallServerMessage.reason: unknown reason');
      return { type, callId, reason };
    }
    case 'expired':
      return obj.from === undefined
        ? { type, callId }
        : { type, callId, from: decodeSessionRef(obj.from) };
    default:
      return { type, callId };
  }
}

export function decodeSessionRef(v: JsonValue | undefined): SessionRef {
  const obj = decodeObject(v, 'SessionRef');
  return {
    id: decodeString(obj.id, 'SessionRef.id'),
    device: decodeDeviceKind(obj.device),
  };
}

export function decodeIceServers(v: JsonValue | undefined): IceServer[] {
  if (!Array.isArray(v)) throw new Error('IceServer[]: expected array');
  return v.map(decodeIceServer);
}

export function decodeIceServer(v: JsonValue | undefined): IceServer {
  const obj = decodeObject(v, 'IceServer');
  const urls = obj.urls;
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('IceServer.urls: expected non-empty array');
  }
  const server: IceServer = {
    urls: urls.map((url, at) => decodeString(url, `IceServer.urls[${at}]`)),
  };
  // 자격증명은 TURN에만 있다 — 없는 것이 정상이고, 있으면 형식을 본다.
  if (obj.username !== undefined) {
    server.username = decodeString(obj.username, 'IceServer.username');
  }
  if (obj.credential !== undefined) {
    server.credential = decodeString(obj.credential, 'IceServer.credential');
  }
  return server;
}

export function decodeIceCandidate(v: JsonValue | undefined): IceCandidate {
  const obj = decodeObject(v, 'IceCandidate');
  const candidate: IceCandidate = {
    candidate: decodeBoundedString(
      obj.candidate,
      'IceCandidate.candidate',
      MAX_ICE_CANDIDATE_LENGTH,
    ),
  };
  // 브라우저가 채우지 못한 쪽은 null로 온다(RTCIceCandidate.toJSON) — 없는 것과 같이 본다.
  if (obj.sdpMid !== undefined && obj.sdpMid !== null) {
    candidate.sdpMid = decodeBoundedString(
      obj.sdpMid,
      'IceCandidate.sdpMid',
      MAX_SDP_MID_LENGTH,
    );
  }
  if (obj.sdpMLineIndex !== undefined && obj.sdpMLineIndex !== null) {
    candidate.sdpMLineIndex = decodeIndex(
      obj.sdpMLineIndex,
      'IceCandidate.sdpMLineIndex',
    );
  }
  return candidate;
}

function decodeSdp(v: JsonValue | undefined): string {
  return decodeBoundedString(v, 'CallMessage.sdp', MAX_SDP_LENGTH);
}

// 릴레이가 나르는 문자열은 전부 길이를 재고 들여온다(§7).
function decodeBoundedString(
  v: JsonValue | undefined,
  label: string,
  max: number,
): string {
  const value = decodeString(v, label);
  if (value.length > max) {
    throw new Error(`${label}: exceeds ${max} characters`);
  }
  return value;
}

// m-line 번호 — decodePositiveInt와 달리 **0이 유효한 값**이다(첫 번째 m-line).
function decodeIndex(v: JsonValue | undefined, label: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    throw new Error(`${label}: expected non-negative integer`);
  }
  return v;
}

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
    accessTokenTtlMs: decodePositiveInt(
      obj.accessTokenTtlMs,
      'AuthSession.accessTokenTtlMs',
    ),
  };
}

// ──────────────────── 푸시 (plan/push.md) ────────────────────

// 알림을 여는 클라이언트가 읽는 data 키. 세 플랫폼이 같은 문자열을 손으로 베끼면
// 언젠가 하나만 어긋나므로 계약에 둔다.
export const PUSH_DATA_KEYS = {
  KIND: 'kind',
  CALL_ID: 'callId',
  DEVICE: 'device',
  // 알림을 눌렀을 때 열 곳. 웹은 `webpush.fcm_options.link`가 따로 나르지만,
  // 네이티브는 이 값을 읽어 앱이 연다.
  LINK: 'link',
  // 이 알림이 그릴 버튼 조합(`PUSH_ACTION_SETS`).
  ACTIONS: 'actions',
  // 알림에 붙일 그림. `notification.image`로도 가지만 **웹은 이쪽을 읽는다** —
  // 서비스 워커가 알림을 직접 그리므로, FCM이 공통 필드를 웹 페이로드로 어떻게
  // 펼치는지에 기대지 않고 우리가 넣은 자리에서 꺼낸다(링크와 같은 이유).
  IMAGE: 'image',
} as const;

// 알림의 갈래. `call`은 소켓 없는 기기를 깨우는 통화 알림(plan/webrtc.md §8-9),
// `demo`는 푸시 화면에서 사람이 직접 보내 보는 알림이다.
export const PUSH_KINDS = ['call', 'demo'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

// FCM 등록 토큰의 상한. 서버는 이 값을 **해석하지 않고** 길이만 본다 — SDP 상한을
// 두는 것과 같은 이유다(형식은 FCM이 판단한다).
export const MAX_PUSH_TOKEN_LENGTH = 4096;

// 푸시 화면에서 사람이 적는 문구의 상한. 잠금화면이 어차피 잘라 보여 주므로
// 더 길게 받아도 화면에 없는 것을 저장하는 셈이 된다.
export const MAX_PUSH_MESSAGE_LENGTH = 120;

// 알림 제목의 상한. 본문보다 짧다 — 잠금화면은 제목을 한 줄로 자른다.
export const MAX_PUSH_TITLE_LENGTH = 60;

// 전송 결과. **FCM이 알려 주는 것은 "받아들였다"까지다** — 기기에 떴는지, 사람이
// 봤는지는 우리가 알 수 없고, 화면이 그 이상을 말하면 없는 사실을 지어내게 된다
// (plan/push.md §7).
//
//  - accepted: FCM이 접수했다. 기기가 깨어 있으면 뜬다
//  - no-token: 내 세션이 맞지만 등록 토큰이 없다(권한 미허용·웹 푸시 미지원)
//  - rejected: FCM이 그 토큰을 거부했다(재설치·데이터 삭제로 회전된 토큰)
//  - accepted:  FCM이 접수했다. 기기가 깨어 있으면 뜬다
//  - no-token:  내 세션이 맞지만 등록 토큰이 없다(권한 미허용·웹 푸시 미지원)
//  - rejected:  FCM이 그 토큰을 거부했다(재설치·데이터 삭제로 회전된 토큰)
//  - duplicate: **같은 설치의 다른 세션이 이미 받았다**(아래 중복 제거). 실패가 아니라
//               "한 번만 보냈다"는 사실이라, 화면이 "셋을 골랐는데 알림이 둘"을 설명한다
//  - unknown:   내 세션이 아니거나 없는 세션이다. **둘을 구별해 주지 않는다** —
//               남의 세션 id를 넣어 존재를 떠보는 경로를 열지 않기 위해서다
export const PUSH_SEND_RESULTS = [
  'accepted',
  'no-token',
  'rejected',
  'duplicate',
  'unknown',
] as const;
export type PushSendResult = (typeof PUSH_SEND_RESULTS)[number];

// 대상 하나의 결말. **세션 단위로 답한다** — 화면이 고른 줄 옆에 그대로 그린다.
export interface PushSendOutcome {
  sessionId: string;
  result: PushSendResult;
}

export interface PushSendResponse {
  results: PushSendOutcome[];
}

export function decodePushSendResponse(v: JsonValue): PushSendResponse {
  const obj = decodeObject(v, 'PushSendResponse');
  const raw = obj.results;
  if (!Array.isArray(raw))
    throw new Error('PushSendResponse.results: expected array');
  return {
    results: raw.map((item) => {
      const entry = decodeObject(item, 'PushSendOutcome');
      const result = PUSH_SEND_RESULTS.find((r) => r === entry.result);
      if (!result) throw new Error('PushSendOutcome.result: unknown result');
      return {
        sessionId: decodeString(entry.sessionId, 'PushSendOutcome.sessionId'),
        result,
      };
    }),
  };
}

// 알림에 붙는 버튼 조합. **임의 목록이 아니라 정해진 조합이다.**
//
// iOS는 `UNNotificationCategory`를 **앱 시작 시 미리 등록**해야 하고, 등록된 조합만
// 쓸 수 있다 — 서버가 그때그때 만든 버튼 목록을 보낼 방법이 없다. 그래서 조합 자체를
// 계약이 정하고, 세 플랫폼이 같은 값을 각자의 방식으로 그린다.
//
// **버튼 문구는 서버가 보내지 않는다.** 클라이언트 i18n에 있다 — iOS는 등록 시점에
// 문구가 굳고(그때는 요청이 없다), 그 하나 때문에 서버 문구 마스터에 사본을 두면
// client.csv와 갈라진다(기기 라벨을 넣지 않은 것과 같은 이유).
export const PUSH_ACTION_SETS = ['none', 'open', 'open-dismiss'] as const;
export type PushActionSet = (typeof PUSH_ACTION_SETS)[number];

// 한 번에 고를 수 있는 대상 수. 세션 목록 자체가 작아 실제로는 닿지 않지만,
// 상한이 없으면 **한 요청이 알림 N개**가 되는 문을 열어 둔 셈이 된다.
export const MAX_PUSH_TARGETS = 20;

// 알림에 실을 수 있는 주소들. 서버는 이 값을 **가져오지 않는다** — 이미지는 FCM이,
// 링크는 기기가 연다. 그래서 서버 쪽 SSRF 표면이 없고, 여기서 보는 것은 형식뿐이다.
export const MAX_PUSH_URL_LENGTH = 2048;

// 푸시 화면이 보내는 요청. **토큰은 없다** — 대상은 세션 id로 가리키고 서버가 꺼낸다.
// 지금 세션에 등록 토큰을 붙이는 요청(`POST /auth/push/register`).
//
// **로그인 요청에는 더 이상 토큰을 싣지 않는다**(§5-2를 뒤집었다). 권한과 등록을 푸시
// 화면이 함께 처리하므로, 로그인 화면은 로그인만 한다.
export interface PushRegisterRequest {
  pushToken: string;
}

export interface PushRegisterResponse {
  // 그 세션이 아직 살아 있고 내 것이면 true. 아니면 false — 화면은 목록을 다시 부른다.
  registered: boolean;
}

export function decodePushRegisterResponse(v: JsonValue): PushRegisterResponse {
  const obj = decodeObject(v, 'PushRegisterResponse');
  return { registered: obj.registered === true };
}

export interface PushSendRequest {
  sessionIds: string[];
  message: string;
  // 비워 두면 **서버가 그린다** — 받는 기기의 언어로(`push.demo_title`). 적어 보내면
  // 그 글자가 그대로 간다: 사람이 적은 제목을 번역할 수는 없고, 본문이 이미 같은
  // 성질이다. 통화 알림의 제목은 이 경로를 지나지 않아 여전히 서버가 그린다.
  title?: string;
  imageUrl?: string;
  link?: string;
  actions?: PushActionSet;
}
