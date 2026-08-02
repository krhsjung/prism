import type { PostgresConfig } from '@app/database';
import type { RedisConfig } from '@app/redis';
import type { AppleOAuthOptions, GoogleOAuthOptions } from './oauth-options';

// env 파싱을 전부 순수 함수로 모은다 — 입력은 env 스냅샷, 출력은 불변 설정 객체.
// PrismConfigService가 부팅 시 loadAppConfig를 1회 호출하므로, 모든 형식 오류는
// 부팅 순간 한 지점에서 fail-fast한다. 테스트는 process.env 없이 인자로 수행한다.

export type Env = Record<string, string | undefined>;

export interface HttpConfig {
  // auth는 3000, api는 3001로 독립 실행 — 웹의 기본 호출 대상(:3000)은 auth다.
  authPort: number;
  apiPort: number;
  // 쉼표 구분 허용 origin 목록. 미설정이면 undefined(호출부에서 전체 허용 판단).
  corsOrigins: string[] | undefined;
  // 로그인 완료 후 브라우저를 돌려보낼 웹 앱 주소.
  webAppUrl: string;
}

export interface AuthConfig {
  jwtSecret: string;
  demoEnabled: boolean;
}

export interface AppConfig {
  production: boolean;
  http: HttpConfig;
  auth: AuthConfig;
  postgres: PostgresConfig;
  redis: RedisConfig;
  google: GoogleOAuthOptions;
  apple: AppleOAuthOptions;
}

const str = (env: Env, key: string, fallback = ''): string =>
  env[key] ?? fallback;

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
    corsOrigins: corsRaw
      ? corsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    webAppUrl: webAppUrl || 'http://localhost:5173',
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
  return {
    jwtSecret: str(
      env,
      'PRISM_JWT_SECRET_KEY',
      'dev-insecure-secret-change-me',
    ),
    demoEnabled: str(env, 'PRISM_AUTH_DEMO_ENABLED') !== 'false',
  };
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

export function loadGoogleOAuthConfig(env: Env): GoogleOAuthOptions {
  return {
    clientId: str(env, 'PRISM_GOOGLE_CLIENT_ID'),
    clientSecret: str(env, 'PRISM_GOOGLE_CLIENT_SECRET'),
    redirectUri: str(
      env,
      'PRISM_GOOGLE_REDIRECT_URI',
      'http://localhost:3000/auth/google/callback',
    ),
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
    google: loadGoogleOAuthConfig(env),
    apple: loadAppleOAuthConfig(env),
  };
}
