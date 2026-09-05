import {
  loadAuthConfig,
  loadHttpConfig,
  loadIceConfig,
  loadPostgresConfig,
} from './app-config';

// env 파싱 계약을 고정한다 — 순수 함수라 process.env 조작 없이 인자로 테스트한다.
describe('loadPostgresConfig', () => {
  // replica 토폴로지로 좁혀서 replicaUrls에 접근하는 헬퍼.
  const replicaUrls = (env: Record<string, string>) => {
    const cfg = loadPostgresConfig(env);
    if (cfg.mode !== 'replica') throw new Error('expected replica topology');
    return cfg.replicaUrls;
  };

  it('기본값: single · 로컬 URL · 타임아웃 5s/10s · required=false', () => {
    const cfg = loadPostgresConfig({});
    expect(cfg.mode).toBe('single');
    expect(cfg.masterUrl).toBe('postgres://prism@localhost:5432/prism');
    expect(cfg.connectTimeoutMs).toBe(5_000);
    expect(cfg.queryTimeoutMs).toBe(10_000);
    expect(cfg.required).toBe(false);
  });

  it('타임아웃 env 오버라이드', () => {
    const cfg = loadPostgresConfig({
      PRISM_DB_CONNECT_TIMEOUT_MS: '2000',
      PRISM_DB_QUERY_TIMEOUT_MS: '3000',
    });
    expect(cfg.connectTimeoutMs).toBe(2_000);
    expect(cfg.queryTimeoutMs).toBe(3_000);
  });

  it('replica URL이 있으면 replica 토폴로지로 추론한다 (IPv6 포함)', () => {
    const env = {
      PRISM_DATABASE_URL: 'postgres://app:pw@primary:5432/db',
      PRISM_DATABASE_REPLICA_URLS:
        'postgres://app:pw@standby:5433/db, postgresql://app@[::1]:5434/db',
    };
    const cfg = loadPostgresConfig(env);
    expect(cfg.mode).toBe('replica');
    expect(cfg.masterUrl).toBe('postgres://app:pw@primary:5432/db');
    expect(replicaUrls(env)).toEqual([
      'postgres://app:pw@standby:5433/db',
      'postgresql://app@[::1]:5434/db',
    ]);
  });

  it('replica URL이 없으면(빈 값 포함) single', () => {
    expect(
      loadPostgresConfig({ PRISM_DATABASE_REPLICA_URLS: ' , ' }).mode,
    ).toBe('single');
  });

  it('URL이 아니면 fail-fast', () => {
    expect(() =>
      loadPostgresConfig({ PRISM_DATABASE_URL: 'primary:5432' }),
    ).toThrow(/Invalid PRISM_DATABASE_URL/);
  });

  it('postgres(ql) 스킴이 아니면 fail-fast', () => {
    expect(() =>
      loadPostgresConfig({ PRISM_DATABASE_URL: 'mysql://app@primary:3306/db' }),
    ).toThrow(/Invalid PRISM_DATABASE_URL/);
  });

  it('replica 목록의 잘못된 항목도 fail-fast (오류 메시지에 URL 원문 미노출)', () => {
    const bad = () =>
      loadPostgresConfig({
        PRISM_DATABASE_REPLICA_URLS:
          'postgres://app:secret-pw@ok:5433/db,not-a-url',
      });
    expect(bad).toThrow(/Invalid PRISM_DATABASE_REPLICA_URLS/);
    expect(bad).not.toThrow(/secret-pw/);
  });
});

describe('loadAuthConfig', () => {
  const STRONG = 'k'.repeat(32);

  it('production에서 JWT 시크릿 미설정이면 fail-fast', () => {
    expect(() => loadAuthConfig({ NODE_ENV: 'production' })).toThrow(
      /Missing required environment variables in production: PRISM_JWT_SECRET_KEY/,
    );
    expect(
      loadAuthConfig({ NODE_ENV: 'production', PRISM_JWT_SECRET_KEY: STRONG })
        .jwtSecret,
    ).toBe(STRONG);
  });

  it('production에서 32바이트 미만 시크릿은 fail-fast', () => {
    expect(() =>
      loadAuthConfig({ NODE_ENV: 'production', PRISM_JWT_SECRET_KEY: 'short' }),
    ).toThrow(/at least 32 bytes/);
    // 개발에선 길이 제한 없음(편의).
    expect(loadAuthConfig({ PRISM_JWT_SECRET_KEY: 'short' }).jwtSecret).toBe(
      'short',
    );
  });

  it('개발에선 dev 폴백 허용', () => {
    expect(loadAuthConfig({}).jwtSecret).toBe('dev-insecure-secret-change-me');
  });

  it("demoEnabled는 'false'일 때만 꺼진다", () => {
    expect(loadAuthConfig({}).demoEnabled).toBe(true);
    expect(
      loadAuthConfig({ PRISM_AUTH_DEMO_ENABLED: 'false' }).demoEnabled,
    ).toBe(false);
  });

  // ──────────────── 쿠키 네임스페이스 ────────────────

  // 기본이 빈 문자열이어야 한다 — 값이 붙는 순간 쿠키 이름이 바뀌고 전원 로그아웃된다.
  it('쿠키 네임스페이스는 기본이 없음', () => {
    expect(loadAuthConfig({}).cookieNamespace).toBe('');
    expect(
      loadAuthConfig({ PRISM_COOKIE_NAMESPACE: '  ' }).cookieNamespace,
    ).toBe('');
  });

  it('쿠키 네임스페이스를 설정하면 그대로 쓴다', () => {
    expect(
      loadAuthConfig({ PRISM_COOKIE_NAMESPACE: 'admin' }).cookieNamespace,
    ).toBe('admin');
  });

  // 쿠키 이름에 그대로 들어가는 값이라 `;`·`=`가 섞이면 Set-Cookie 헤더가 쪼개진다.
  it('쿠키 이름에 못 쓰는 문자는 fail-fast', () => {
    for (const bad of ['ad min', 'admin;x', 'Admin', 'admin=1']) {
      expect(() => loadAuthConfig({ PRISM_COOKIE_NAMESPACE: bad })).toThrow(
        /Invalid PRISM_COOKIE_NAMESPACE/,
      );
    }
  });

  // ──────────────── 세션 수명 ────────────────

  it('기본 수명: 액세스 15분 · 리프레시 12시간', () => {
    const cfg = loadAuthConfig({});
    expect(cfg.accessTokenTtlMs).toBe(15 * 60 * 1000);
    expect(cfg.refreshTokenTtlMs).toBe(12 * 60 * 60 * 1000);
  });

  // 단위 없는 숫자는 초로 읽는다(JWT expiresIn 관례) — `900`과 `15m`이 같은 값이다.
  it('수명 표기: 단위 없으면 초, 접미사가 있으면 그 단위', () => {
    expect(
      loadAuthConfig({ PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN: '900' })
        .accessTokenTtlMs,
    ).toBe(15 * 60 * 1000);
    expect(
      loadAuthConfig({ PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN: '15m' })
        .accessTokenTtlMs,
    ).toBe(15 * 60 * 1000);
    expect(
      loadAuthConfig({ PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN: '7d' })
        .refreshTokenTtlMs,
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });

  // 오타를 기본값으로 흡수하면 "설정했는데 안 먹는" 상태가 운영에서 드러나지 않는다.
  it('형식이 아닌 수명 표기는 fail-fast', () => {
    expect(() =>
      loadAuthConfig({ PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN: '15min' }),
    ).toThrow(/Invalid PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN/);
    expect(() =>
      loadAuthConfig({ PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN: 'forever' }),
    ).toThrow(/Invalid PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN/);
  });

  it('0 이하의 수명은 fail-fast (로그인 즉시 끊기는 설정)', () => {
    expect(() =>
      loadAuthConfig({ PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN: '0' }),
    ).toThrow(/must be greater than zero/);
  });

  // 액세스가 리프레시보다 길면 세션(=리프레시 창)이 끝난 뒤에도 액세스 토큰만으로
  // 통과하는 구간이 생긴다 — 갱신이라는 개념 자체가 성립하지 않는다.
  it('액세스 수명이 리프레시 수명을 넘으면 fail-fast', () => {
    expect(() =>
      loadAuthConfig({
        PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN: '2d',
        PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN: '1d',
      }),
    ).toThrow(/must not exceed/);
    // 같은 값은 허용한다(갱신 없이 한 번만 쓰는 구성).
    expect(() =>
      loadAuthConfig({
        PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN: '1d',
        PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN: '1d',
      }),
    ).not.toThrow();
  });
});

describe('loadHttpConfig', () => {
  it('corsOrigins: 쉼표 분리 + trim + 빈 항목 제거, 미설정이면 undefined', () => {
    expect(loadHttpConfig({}).corsOrigins).toBeUndefined();
    expect(
      loadHttpConfig({
        PRISM_CORS_ORIGIN: ' https://a.com , https://b.com ,, ',
      }).corsOrigins,
    ).toEqual(['https://a.com', 'https://b.com']);
  });

  it('기본값: 포트 3000 · 웹 URL localhost:5173', () => {
    const cfg = loadHttpConfig({});
    expect(cfg.authPort).toBe(3000);
    expect(cfg.webAppUrl).toBe('http://localhost:5173');
  });

  it('production에선 CORS·웹 URL 미설정이 fail-fast (fail-open 방지)', () => {
    expect(() => loadHttpConfig({ NODE_ENV: 'production' })).toThrow(
      /PRISM_CORS_ORIGIN/,
    );
    expect(() =>
      loadHttpConfig({
        NODE_ENV: 'production',
        PRISM_CORS_ORIGIN: 'https://a.com',
      }),
    ).toThrow(/PRISM_WEB_APP_URL/);
    expect(
      loadHttpConfig({
        NODE_ENV: 'production',
        PRISM_CORS_ORIGIN: 'https://a.com',
        PRISM_WEB_APP_URL: 'https://a.com',
      }).webAppUrl,
    ).toBe('https://a.com');
  });
});

// ICE 서버는 `accepted`와 함께 소켓이 내려준다 — **값의 원천은 env뿐이고** 레포에는
// 호스트도 자격증명도 없다(plan/webrtc.md §7).
describe('loadIceConfig', () => {
  const turn = {
    PRISM_TURN_URLS: 'turn:turn.example:3478',
    PRISM_TURN_SECRET: 'shared-secret',
  };

  it('기본값: 공개 STUN 하나 · TURN 없음', () => {
    const cfg = loadIceConfig({});
    expect(cfg.stunUrls).toHaveLength(1);
    expect(cfg.turn).toBeNull();
  });

  it('콤마 목록을 다듬어 읽는다', () => {
    expect(
      loadIceConfig({
        PRISM_STUN_URLS: ' stun:a.example:3478 , stuns:b.example:5349 ,, ',
      }).stunUrls,
    ).toEqual(['stun:a.example:3478', 'stuns:b.example:5349']);
  });

  // 클라이언트에게 나가는 것은 이 비밀이 아니라 이것으로 서명한 시한부 자격증명이다
  // (config.service.ts의 iceServersFor).
  it('TURN은 URL과 공유 비밀이 함께 있으면 구성된다', () => {
    expect(loadIceConfig(turn).turn).toEqual({
      urls: ['turn:turn.example:3478'],
      secret: 'shared-secret',
      ttlMs: 12 * 60 * 60 * 1000,
    });
  });

  it('자격증명 수명은 env로 줄일 수 있다', () => {
    expect(loadIceConfig({ ...turn, PRISM_TURN_TTL: '10m' }).turn?.ttlMs).toBe(
      600_000,
    );
  });

  // 일부만 온 설정을 조용히 STUN-only로 되돌리지 않는다 — TURN을 켰다고 믿는 채
  // **대칭 NAT에서만** 실패하는 상태가 되고, 그건 운영에서 가장 늦게 드러난다.
  it('TURN 설정이 일부만 오면 부팅에서 막는다', () => {
    for (const key of Object.keys(turn)) {
      const partial = { ...turn, [key]: '' };
      expect(() => loadIceConfig(partial)).toThrow(/must be set together/);
    }
  });

  // 스킴 오타는 클라이언트가 조용히 무시해 "설정했는데 계속 직접 연결"이 된다.
  it('스킴이 어긋난 URL은 부팅에서 막는다', () => {
    expect(() =>
      loadIceConfig({ PRISM_STUN_URLS: 'https://stun.example' }),
    ).toThrow(/PRISM_STUN_URLS/);
    expect(() => loadIceConfig({ ...turn, PRISM_TURN_URLS: 'stun:a' })).toThrow(
      /PRISM_TURN_URLS/,
    );
  });
});
