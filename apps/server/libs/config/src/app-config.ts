import type { PostgresConfig } from '@app/database';
import type { RedisConfig } from '@app/redis';
import type {
  AppleOAuthOptions,
  GoogleOAuthOptions,
  KakaoOAuthOptions,
} from './oauth-options';

// env 파싱을 전부 순수 함수로 모은다 — 입력은 env 스냅샷, 출력은 불변 설정 객체.
// PrismConfigService가 부팅 시 loadAppConfig를 1회 호출하므로, 모든 형식 오류는
// 부팅 순간 한 지점에서 fail-fast한다. 테스트는 process.env 없이 인자로 수행한다.

export type Env = Record<string, string | undefined>;

export interface HttpConfig {
  // auth는 3000, api는 3001, socket은 3002로 독립 실행 —
  // 웹의 기본 호출 대상(:3000)은 auth다.
  authPort: number;
  apiPort: number;
  socketPort: number;
  // 쉼표 구분 허용 origin 목록. 미설정이면 undefined(호출부에서 전체 허용 판단).
  corsOrigins: string[] | undefined;
  // 로그인 완료 후 브라우저를 돌려보낼 웹 앱 주소.
  webAppUrl: string;
  // 네이티브 웹-redirect(flow=native) 로그인이 일회용 코드를 돌려보낼 앱 콜백 —
  // 커스텀 스킴 주소. 앱이 ASWebAuthenticationSession 등으로 이 스킴을 캡처한다.
  nativeAuthCallbackUrl: string;
}

export interface AuthConfig {
  jwtSecret: string;
  demoEnabled: boolean;
  // 쿠키 이름에 끼워 넣는 앱 구분자(빈 문자열이면 없음 — 기본).
  //
  // __Host- 접두어는 호스트 단위 격리까지만 해준다. 호스트가 갈리는 배포에서는 그것으로
  // 충분하지만, **한 호스트에 앱을 둘 이상 얹으면** 같은 이름의 쿠키를 함께 쓰게 되어
  // 서로의 세션을 덮는다. 그때 이 값으로 이름을 가른다.
  cookieNamespace: string;
  // 액세스 토큰의 수명. 짧을수록 탈취된 토큰의 사용 가능 시간이 줄지만, 그만큼 갱신이
  // 잦아진다(요청 수 = 세션 길이 / 이 값).
  accessTokenTtlMs: number;
  // 리프레시 자격증명의 수명 = 세션의 sliding idle 만료. 갱신할 때마다 다시 채워지므로
  // "이만큼 활동이 없으면 끊긴다"는 뜻이다. 세션 쿠키의 maxAge도 이 값을 쓴다 —
  // 만료된 액세스 토큰이라도 실려 와야 서버가 갱신을 안내할 수 있기 때문이다.
  refreshTokenTtlMs: number;
}

// STUN/TURN. 목록은 `accepted`와 함께 소켓이 내려주고, **값은 전부 env에서 온다** —
// 호스트도 자격증명도 레포에 두지 않는다(plan/webrtc.md §7).
export interface IceConfig {
  stunUrls: string[];
  // TURN은 셋이 **함께 있거나 함께 없다** — 하나만 설정된 상태를 타입으로 없앤다.
  // (PostgresConfig가 "replica인데 standby 없음"을 표현 불가로 만든 것과 같은 모양이다)
  //
  // `credential`은 오타가 아니다 — 이 값은 브라우저의 `RTCIceServer.credential`로 그대로
  // 나간다. env는 우리 규칙(`_PASSWORD`)을, 이 필드는 웹 표준 이름을 따르고, 둘이 만나는
  // 자리는 `loadIceConfig`의 마지막 줄 하나뿐이다.
  turn: { urls: string[]; username: string; credential: string } | null;
}

// 쿠키 이름을 정하는 두 축을 **한 값으로 묶는다.** 따로 다니는 인자였다면 한쪽만
// 갱신된 호출부가 생기고, 그 순간 심는 이름과 읽는 이름이 갈린다 — 타입이 그걸 막는다.
// (설정에서 파생되는 값이라 여기 두고, @app/session이 타입으로만 가져다 쓴다 —
//  의존 방향을 session → config 한쪽으로 유지하려는 것)
export interface CookiePolicy {
  isProduction: boolean;
  // 빈 문자열이면 접미사 없음(기본).
  namespace: string;
}

export interface AppConfig {
  production: boolean;
  http: HttpConfig;
  auth: AuthConfig;
  postgres: PostgresConfig;
  redis: RedisConfig;
  ice: IceConfig;
  google: GoogleOAuthOptions;
  apple: AppleOAuthOptions;
  kakao: KakaoOAuthOptions;
}

const str = (env: Env, key: string, fallback = ''): string =>
  env[key] ?? fallback;

// 토큰 수명 표기 — 단위 없는 숫자는 **초**로 읽고(JWT `expiresIn` 관례), 접미사가 있으면
// 그 단위로 읽는다. `900`과 `15m`이 같은 값이다.
//
// 잘못된 표기를 조용히 기본값으로 되돌리지 않는다. `15min`이나 `1 h` 같은 오타가
// 기본값으로 흡수되면 "설정했는데 안 먹는" 상태가 운영에서 드러나지 않는다.
const DURATION_UNITS_MS: { [unit: string]: number } = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseDurationMs(
  env: Env,
  key: string,
  fallbackMs: number,
): number {
  const raw = str(env, key).trim();
  if (!raw) return fallbackMs;

  const matched = /^(\d+)(ms|s|m|h|d)?$/.exec(raw);
  const amount = matched?.[1];
  if (!amount) {
    throw new Error(
      `Invalid ${key}: expected a duration like 900, 15m, 12h, or 7d`,
    );
  }
  const unitMs = DURATION_UNITS_MS[matched?.[2] ?? 's'] ?? 1000;
  const ms = Number(amount) * unitMs;
  // 0은 "즉시 만료"라 로그인하자마자 끊기는 설정이다 — 오타일 가능성이 훨씬 높다.
  if (ms <= 0) throw new Error(`Invalid ${key}: must be greater than zero`);
  return ms;
}

export function loadHttpConfig(env: Env): HttpConfig {
  const corsRaw = str(env, 'PRISM_CORS_ORIGIN');
  const webAppUrl = str(env, 'PRISM_WEB_APP_URL');
  // 운영에서 미설정은 fail-open(CORS 전체 허용 · localhost redirect)이 되므로 부팅 실패.
  if (env.NODE_ENV === 'production') {
    if (!corsRaw)
      throw new Error('PRISM_CORS_ORIGIN must be set in production');
    if (!webAppUrl) {
      throw new Error('PRISM_WEB_APP_URL must be set in production');
    }
  }
  return {
    authPort: Number(str(env, 'PRISM_AUTH_PORT')) || 3000,
    apiPort: Number(str(env, 'PRISM_API_PORT')) || 3001,
    socketPort: Number(str(env, 'PRISM_SOCKET_PORT')) || 3002,
    corsOrigins: corsRaw
      ? corsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    webAppUrl: webAppUrl || 'http://localhost:5173',
    nativeAuthCallbackUrl:
      str(env, 'PRISM_NATIVE_AUTH_CALLBACK') || 'prism://auth/callback',
  };
}

// 운영 환경에선 위험한 기본값 폴백을 막기 위해 필수 시크릿을 부팅 시 검증한다.
// (jwtSecret은 미설정 시 dev 폴백이 있어, 프로덕션에선 반드시 주입돼야 한다)
export function loadAuthConfig(env: Env): AuthConfig {
  if (env.NODE_ENV === 'production') {
    const secret = str(env, 'PRISM_JWT_SECRET_KEY');
    if (!secret) {
      throw new Error(
        'Missing required environment variables in production: PRISM_JWT_SECRET_KEY',
      );
    }
    // HS256 키는 최소 32바이트(256비트) — 짧은 키는 토큰 노출 시 오프라인 추측에 취약하다.
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error(
        'PRISM_JWT_SECRET_KEY must be at least 32 bytes in production',
      );
    }
  }
  const accessTokenTtlMs = parseDurationMs(
    env,
    'PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN',
    15 * 60 * 1000,
  );
  const refreshTokenTtlMs = parseDurationMs(
    env,
    'PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN',
    12 * 60 * 60 * 1000,
  );
  // 액세스가 리프레시보다 오래 살면 갱신이라는 개념 자체가 성립하지 않는다 —
  // 세션(=리프레시 창)이 끝난 뒤에도 액세스 토큰만으로 통과하는 구간이 생긴다.
  if (accessTokenTtlMs > refreshTokenTtlMs) {
    throw new Error(
      'PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN must not exceed PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN',
    );
  }

  return {
    jwtSecret: str(
      env,
      'PRISM_JWT_SECRET_KEY',
      'dev-insecure-secret-change-me',
    ),
    demoEnabled: str(env, 'PRISM_AUTH_DEMO_ENABLED') !== 'false',
    cookieNamespace: parseCookieNamespace(env),
    accessTokenTtlMs,
    refreshTokenTtlMs,
  };
}

// 쿠키 이름에 그대로 들어가는 값이라 문법상 안전한 문자만 받는다.
// (`;`나 `=`가 섞이면 Set-Cookie 헤더가 쪼개져 이름이 엉뚱하게 잘린다)
function parseCookieNamespace(env: Env): string {
  const raw = str(env, 'PRISM_COOKIE_NAMESPACE').trim();
  if (!raw) return '';
  if (!/^[a-z0-9-]+$/.test(raw)) {
    throw new Error(
      'Invalid PRISM_COOKIE_NAMESPACE: expected lowercase letters, digits, or hyphens',
    );
  }
  return raw;
}

// 표준 접속 URL(12-factor DATABASE_URL)로 지정한다 — postgres://user[:pw]@host[:port]/db.
// PRISM_DATABASE_REPLICA_URLS(콤마 목록)가 있으면 replica 토폴로지, 없으면 single —
// "replica인데 standby 없음" 상태가 env 차원에서 표현 불가능하다.
export function loadPostgresConfig(env: Env): PostgresConfig {
  const masterUrl = pgUrl(
    'PRISM_DATABASE_URL',
    str(env, 'PRISM_DATABASE_URL', 'postgres://prism@localhost:5432/prism'),
  );
  const replicaUrls = str(env, 'PRISM_DATABASE_REPLICA_URLS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => pgUrl('PRISM_DATABASE_REPLICA_URLS', url));

  // PRISM_DB_REQUIRED=true면 master 연결 실패 시 부팅 실패(기본 false: 로그만).
  // 타임아웃: 네트워크 장애 시 연결/쿼리가 무한 대기하지 않도록 상한 주입.
  const shared = {
    required: str(env, 'PRISM_DB_REQUIRED') === 'true',
    connectTimeoutMs: Number(str(env, 'PRISM_DB_CONNECT_TIMEOUT_MS')) || 5_000,
    queryTimeoutMs: Number(str(env, 'PRISM_DB_QUERY_TIMEOUT_MS')) || 10_000,
  };

  // head 부재 = replica URL 없음 → single (destructuring으로 최소 1개를 타입 증명).
  const [head, ...tail] = replicaUrls;
  if (!head) {
    return { mode: 'single', masterUrl, ...shared };
  }
  return {
    mode: 'replica',
    masterUrl,
    replicaUrls: [head, ...tail],
    ...shared,
  };
}

// postgres(ql):// URL 검증 — 형식 오류는 부팅 시 fail-fast.
// 오류 메시지에 URL 원문을 넣지 않는다(비밀번호 노출 방지).
function pgUrl(source: string, raw: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = undefined;
  }
  const valid =
    parsed &&
    (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
    parsed.hostname;
  if (!valid) {
    throw new Error(
      `Invalid ${source}: expected postgres://user[:password]@host[:port]/db`,
    );
  }
  return raw;
}

// 세션 저장소. 표준 접속 URL(redis://user:password@host:port)로 지정한다.
// 세션이 여기에만 있으므로 운영에서는 연결 실패를 부팅 실패로 올린다 —
// 연결 없이 뜨면 모든 인증이 실패하는데 Pod는 살아 있는 상태가 된다.
export function loadRedisConfig(env: Env): RedisConfig {
  const raw = str(env, 'PRISM_REDIS_URL', 'redis://localhost:6379');
  if (env.NODE_ENV === 'production' && !str(env, 'PRISM_REDIS_URL')) {
    throw new Error('PRISM_REDIS_URL must be set in production');
  }
  return {
    url: redisUrl(raw),
    required: str(env, 'PRISM_REDIS_REQUIRED', 'true') !== 'false',
    connectTimeoutMs:
      Number(str(env, 'PRISM_REDIS_CONNECT_TIMEOUT_MS')) || 5_000,
    commandTimeoutMs:
      Number(str(env, 'PRISM_REDIS_COMMAND_TIMEOUT_MS')) || 3_000,
  };
}

// redis(s):// URL 검증 — 형식 오류는 부팅 시 fail-fast.
// 오류 메시지에 URL 원문을 넣지 않는다(비밀번호 노출 방지).
function redisUrl(raw: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = undefined;
  }
  const valid =
    parsed &&
    (parsed.protocol === 'redis:' || parsed.protocol === 'rediss:') &&
    parsed.hostname;
  if (!valid) {
    throw new Error(
      'Invalid PRISM_REDIS_URL: expected redis://[user:password@]host[:port]',
    );
  }
  return raw;
}

// 공개 STUN 하나. TURN이 없어도 대부분의 NAT는 이것으로 뚫린다 —
// 대칭 NAT·엄격한 방화벽만 TURN을 필요로 한다(그래서 v1부터 넣기로 했다, §9-2).
const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';

export function loadIceConfig(env: Env): IceConfig {
  const stunUrls = iceUrls(env, 'PRISM_STUN_URLS', ['stun', 'stuns']);
  const turnUrls = iceUrls(env, 'PRISM_TURN_URLS', ['turn', 'turns']);
  const username = str(env, 'PRISM_TURN_USERNAME').trim();
  const password = str(env, 'PRISM_TURN_PASSWORD').trim();

  // 셋 중 일부만 온 설정을 조용히 STUN-only로 되돌리지 않는다 — TURN을 켰다고 믿는 채
  // **대칭 NAT에서만** 실패하는 상태가 되고, 그건 운영에서 가장 늦게 드러나는 종류다.
  const parts = [turnUrls.length > 0, Boolean(username), Boolean(password)];
  if (parts.some(Boolean) && !parts.every(Boolean)) {
    throw new Error(
      'PRISM_TURN_URLS, PRISM_TURN_USERNAME and PRISM_TURN_PASSWORD must be set together',
    );
  }

  const [head, ...tail] = turnUrls;
  return {
    stunUrls: stunUrls.length > 0 ? stunUrls : [DEFAULT_STUN_URL],
    turn: head ? { urls: [head, ...tail], username, credential: password } : null,
  };
}

// 콤마 구분 목록 + 스킴 검사. 오타(`stun.example:3478`)는 클라이언트가 조용히 무시해
// "TURN을 설정했는데 계속 직접 연결" 상태가 되므로, 부팅에서 잡는다.
function iceUrls(env: Env, key: string, schemes: string[]): string[] {
  const urls = str(env, key)
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  for (const url of urls) {
    if (!schemes.some((scheme) => url.startsWith(`${scheme}:`))) {
      throw new Error(
        `Invalid ${key}: expected ${schemes.map((s) => `${s}:`).join(' or ')} URLs`,
      );
    }
  }
  return urls;
}

export function loadGoogleOAuthConfig(env: Env): GoogleOAuthOptions {
  return {
    clientId: str(env, 'PRISM_GOOGLE_CLIENT_ID'),
    clientSecret: str(env, 'PRISM_GOOGLE_CLIENT_SECRET'),
    redirectUri: str(
      env,
      'PRISM_GOOGLE_REDIRECT_URI',
      'http://localhost:3000/auth/google/callback',
    ),
    // 콤마 구분 목록(공백 허용) → 빈 항목 제거.
    nativeAudiences: str(env, 'PRISM_GOOGLE_NATIVE_AUDIENCES')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
  };
}

export function loadKakaoOAuthConfig(env: Env): KakaoOAuthOptions {
  return {
    clientId: str(env, 'PRISM_KAKAO_CLIENT_ID'),
    // Kakao 콘솔에서 "client secret 사용"을 켠 경우에만 필요 — 꺼져 있으면 빈 값이다.
    clientSecret: str(env, 'PRISM_KAKAO_CLIENT_SECRET'),
    redirectUri: str(
      env,
      'PRISM_KAKAO_REDIRECT_URI',
      'http://localhost:3000/auth/kakao/callback',
    ),
    appId: str(env, 'PRISM_KAKAO_APP_ID') || undefined,
  };
}

export function loadAppleOAuthConfig(env: Env): AppleOAuthOptions {
  return {
    teamId: str(env, 'PRISM_APPLE_TEAM_ID'),
    clientId: str(env, 'PRISM_APPLE_CLIENT_ID'),
    keyId: str(env, 'PRISM_APPLE_KEY_ID'),
    privateKey: str(env, 'PRISM_APPLE_PRIVATE_KEY'),
    bundleId: str(env, 'PRISM_APPLE_BUNDLE_ID') || undefined,
    redirectUri: str(
      env,
      'PRISM_APPLE_REDIRECT_URI',
      'http://localhost:3000/auth/apple/callback',
    ),
  };
}

export function loadAppConfig(env: Env): AppConfig {
  return {
    production: env.NODE_ENV === 'production',
    http: loadHttpConfig(env),
    auth: loadAuthConfig(env),
    postgres: loadPostgresConfig(env),
    redis: loadRedisConfig(env),
    ice: loadIceConfig(env),
    google: loadGoogleOAuthConfig(env),
    apple: loadAppleOAuthConfig(env),
    kakao: loadKakaoOAuthConfig(env),
  };
}
