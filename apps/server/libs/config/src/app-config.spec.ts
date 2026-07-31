import {
  loadAuthConfig,
  loadHttpConfig,
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
