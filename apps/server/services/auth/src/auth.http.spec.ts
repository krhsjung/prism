import { INestApplication } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismConfigService } from '@app/config';
import { SessionsRepository, type AuthSession, type User } from '@app/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { WebOriginGuard } from './web-origin.guard';
import { AuthTokenService } from './session/auth-token.service';

// jose는 ESM 전용이라 jest(CJS)가 파싱하지 못한다 — 이 스펙은 AppleOAuthClient를
// 인스턴스화하지 않으므로(import 경유로만 닿음) 모듈 로드만 차단한다.
jest.mock('jose', () => ({}));

const WEB = 'https://web.test';

const ISO = '2026-01-01T00:00:00.000Z';

const user: User = {
  id: 'u-1',
  provider: 'demo',
  displayName: 'Demo User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// 단위 테스트는 컨트롤러 메서드를 직접 부르기 때문에 가드·직렬화·헤더가 전혀 실행되지 않는다.
// 여기서는 실제 HTTP 스택을 통과시켜 다음을 확인한다:
//  - 가드가 의도한 라우트에만 붙어 있는가(배선 자체)
//  - 브라우저가 실제로 받는 Set-Cookie 헤더가 맞는가
//  - 콜백 페이지의 보안 헤더가 실제 응답에 실리는가
describe('auth HTTP 경계', () => {
  let app: INestApplication;
  let sessions: { findValid: jest.Mock };
  let auth: {
    issueDemoSession: jest.Mock;
    revokeSession: jest.Mock;
    refreshSession: jest.Mock;
    listSessions: jest.Mock;
    revokeOwnedSession: jest.Mock;
    revokeAllSessions: jest.Mock;
  };
  let tokens: AuthTokenService;

  beforeEach(async () => {
    sessions = { findValid: jest.fn(() => Promise.resolve(user)) };
    auth = {
      issueDemoSession: jest.fn(
        (): Promise<AuthSession> =>
          Promise.resolve({
            accessToken: tokens.signSession(user.id, 'sess-1'),
            refreshToken: 'sess-1.secret-1',
            user,
          }),
      ),
      revokeSession: jest.fn(() => Promise.resolve()),
      listSessions: jest.fn(() =>
        Promise.resolve([
          { id: 'sess-1', startedAt: ISO, expiresAt: ISO },
          { id: 'sess-other', startedAt: ISO, expiresAt: ISO },
        ]),
      ),
      revokeOwnedSession: jest.fn(() => Promise.resolve(true)),
      revokeAllSessions: jest.fn(() => Promise.resolve(2)),
      refreshSession: jest.fn(() =>
        Promise.resolve({
          accessToken: tokens.signSession(user.id, 'sess-2'),
          refreshToken: 'sess-2.secret-2',
          user,
        }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { algorithm: 'HS256', expiresIn: '1h' },
        }),
        // 이 스펙은 레이트리밋이 관심사가 아니므로 한도를 넉넉히 둔다.
        ThrottlerModule.forRoot([{ name: 'test', ttl: 60_000, limit: 1000 }]),
      ],
      controllers: [AuthController],
      providers: [
        AuthTokenService,
        JwtAuthGuard,
        WebOriginGuard,
        { provide: AuthService, useValue: auth },
        { provide: SessionsRepository, useValue: sessions },
        {
          provide: PrismConfigService,
          useValue: {
            demoEnabled: true,
            webAppUrl: WEB,
            isProduction: false,
            socialConfigured: () => true,
            isAllowedOrigin: (origin: string) => origin === WEB,
          } as object as PrismConfigService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    tokens = app.get(AuthTokenService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // getHttpServer()의 반환 타입이 any라 경계에서 한 번만 좁힌다.
  // (as object as X — 프로젝트의 unknown/any 금지 방침에 맞춘 캐스팅)
  const server = () =>
    request(app.getHttpServer() as object as Parameters<typeof request>[0]);

  // ──────────────── 가드 배선 ────────────────

  it('demo: 허용된 출처는 통과하고 실제 Set-Cookie가 실린다', async () => {
    const res = await server()
      .post('/auth/demo')
      .set('Origin', WEB)
      .expect(201);

    // body에는 사용자만 — 토큰은 쿠키로만 간다.
    expect(res.body).toEqual({ user });

    const setCookie = res.get('Set-Cookie') ?? [];
    const session = setCookie.find((c) => c.startsWith('prism_session='));
    expect(session).toBeDefined();
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    expect(session).toContain('Path=/');
  });

  // WebOriginGuard가 실제로 이 라우트에 붙어 있는지는 HTTP로만 증명된다.
  it('demo: 허용되지 않은 출처는 403', async () => {
    await server()
      .post('/auth/demo')
      .set('Origin', 'https://evil.asuscomm.com')
      .expect(403, { error: 'FORBIDDEN_ORIGIN' });
    expect(auth.issueDemoSession).not.toHaveBeenCalled();
  });

  // 회귀 방지 — 예전에는 JwtAuthGuard가 붙어 401이었다. 그게 실제 교착을 만들었다:
  // 저장소를 비우거나 세션이 만료된 뒤 로그아웃을 누르면 401로 끊겨 Set-Cookie가 나가지
  // 않았고, JS는 HttpOnly 쿠키를 못 지우므로 로그아웃할 방법이 사라졌다.
  it('logout: 자격증명이 없어도 204로 쿠키를 정리한다', async () => {
    const res = await server()
      .post('/auth/logout')
      .set('Origin', WEB)
      .expect(204);

    expect(auth.revokeSession).not.toHaveBeenCalled();
    const expired = (res.get('Set-Cookie') ?? []).filter((c) =>
      c.includes('Expires=Thu, 01 Jan 1970'),
    );
    expect(expired.some((c) => c.startsWith('prism_session='))).toBe(true);
    expect(expired.some((c) => c.startsWith('prism_refresh='))).toBe(true);
  });

  // 사용자가 실제로 겪은 경로: Redis를 비운 뒤 로그아웃.
  // 세션 조회가 null이어도 쿠키는 반드시 만료돼야 한다.
  it('logout: 저장소에 세션이 없어도 쿠키를 만료시킨다', async () => {
    sessions.findValid.mockResolvedValue(null);
    const token = tokens.signSession(user.id, 'sess-gone');
    const res = await server()
      .post('/auth/logout')
      .set('Origin', WEB)
      .set('Cookie', `prism_session=${token}`)
      .expect(204);

    expect(auth.revokeSession).toHaveBeenCalledWith('sess-gone');
    const expired = (res.get('Set-Cookie') ?? []).filter((c) =>
      c.includes('Expires=Thu, 01 Jan 1970'),
    );
    expect(expired.some((c) => c.startsWith('prism_session='))).toBe(true);
    expect(expired.some((c) => c.startsWith('prism_refresh='))).toBe(true);
  });

  // 출처 검증은 그대로 살아 있어야 한다 — 가드를 하나 뗐다고 강제 로그아웃 CSRF까지
  // 열리면 안 된다.
  it('logout: 허용되지 않은 출처는 403', async () => {
    await server()
      .post('/auth/logout')
      .set('Origin', 'https://evil.asuscomm.com')
      .expect(403, { error: 'FORBIDDEN_ORIGIN' });
    expect(auth.revokeSession).not.toHaveBeenCalled();
  });

  it('logout: 세션을 폐기하고 쿠키를 만료시킨다', async () => {
    const token = tokens.signSession(user.id, 'sess-9');
    const res = await server()
      .post('/auth/logout')
      .set('Origin', WEB)
      .set('Cookie', `prism_session=${token}`)
      .expect(204);

    expect(auth.revokeSession).toHaveBeenCalledWith('sess-9');
    const cleared = (res.get('Set-Cookie') ?? []).find((c) =>
      c.startsWith('prism_session='),
    );
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
  });

  // 세션이 사라지면 서명이 유효해도 인증되지 않는다 — 즉시 폐기의 핵심.
  it('me: 세션이 없으면 401 (서명은 유효하더라도)', async () => {
    sessions.findValid.mockResolvedValue(null);
    const token = tokens.signSession(user.id, 'gone');
    await server()
      .get('/auth/me')
      .set('Cookie', `prism_session=${token}`)
      .expect(401, { error: 'UNAUTHORIZED' });
  });

  it('me: 쿠키 세션으로 사용자를 돌려준다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    await server()
      .get('/auth/me')
      .set('Cookie', `prism_session=${token}`)
      .expect(200, user);
  });

  it('me: Bearer(네이티브)로도 인증된다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    await server()
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, user);
  });

  // Apple form_post는 교차 사이트 POST가 프로토콜상 정상이라 출처 가드에서 면제돼야 한다.
  // 여기에 가드가 붙으면 Apple 로그인이 통째로 깨진다.
  it('apple/callback: 외부 출처라도 403이 아니다(가드 면제)', async () => {
    const res = await server()
      .post('/auth/apple/callback')
      .set('Origin', 'https://appleid.apple.com')
      .send({ state: 'garbage' });
    expect(res.status).not.toBe(403);
  });

  // ──────────────── 리프레시 ────────────────

  it('demo 로그인은 액세스·리프레시 쿠키를 함께 심는다', async () => {
    const res = await server()
      .post('/auth/demo')
      .set('Origin', WEB)
      .expect(201);
    const cookies = res.get('Set-Cookie') ?? [];

    expect(cookies.some((c) => c.startsWith('prism_session='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('prism_refresh='))).toBe(true);
    // 리프레시 자격증명도 JS가 만질 수 없어야 한다.
    const refresh = cookies.find((c) => c.startsWith('prism_refresh='));
    expect(refresh).toContain('HttpOnly');
  });

  it('refresh: 쿠키의 자격증명으로 갱신하고 새 쿠키를 내려준다(웹)', async () => {
    const res = await server()
      .post('/auth/refresh')
      .set('Origin', WEB)
      .set('Cookie', 'prism_refresh=sess-1.secret-1')
      .expect(200);

    expect(auth.refreshSession).toHaveBeenCalledWith('sess-1.secret-1');
    const cookies = res.get('Set-Cookie') ?? [];
    expect(cookies.find((c) => c.startsWith('prism_refresh='))).toContain(
      'sess-2.secret-2',
    );
  });

  it('refresh: body의 자격증명도 받는다(네이티브)', async () => {
    await server()
      .post('/auth/refresh')
      .send({ refreshToken: 'sess-9.secret-9' })
      .expect(200);
    expect(auth.refreshSession).toHaveBeenCalledWith('sess-9.secret-9');
  });

  it('refresh: 자격증명이 없으면 401', async () => {
    await server()
      .post('/auth/refresh')
      .set('Origin', WEB)
      .expect(401, { error: 'UNAUTHORIZED' });
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  // 회귀 방지 — 리뷰 3차. 실패의 흔한 원인은 "다른 탭이 먼저 회전했다"인데,
  // 쿠키는 탭 간 공유라 여기서 지우면 성공한 탭의 새 자격증명까지 날아간다.
  it('refresh: 실패해도 쿠키를 지우지 않는다(탭 간 경합 보호)', async () => {
    auth.refreshSession.mockResolvedValueOnce(null);
    const res = await server()
      .post('/auth/refresh')
      .set('Origin', WEB)
      .set('Cookie', 'prism_refresh=sess-1.stale')
      .expect(401);

    expect(res.get('Set-Cookie') ?? []).toHaveLength(0);
  });

  // 회귀 방지 — 리뷰 3차. 쿠키로 인증되는 갱신이 토큰까지 body로 돌려주면
  // XSS가 ambient 쿠키로 refresh를 호출해 7일짜리 자격증명을 빼갈 수 있다.
  it('refresh(쿠키): body에 토큰이 실리지 않는다', async () => {
    const res = await server()
      .post('/auth/refresh')
      .set('Origin', WEB)
      .set('Cookie', 'prism_refresh=sess-1.secret-1')
      .expect(200);

    expect(res.body).toEqual({ user });
    expect(JSON.stringify(res.body)).not.toContain('secret-2');
  });

  it('refresh(body): 네이티브에는 토큰을 돌려준다', async () => {
    const res = await server()
      .post('/auth/refresh')
      .send({ refreshToken: 'sess-9.secret-9' })
      .expect(200);

    // supertest의 body는 any — 프로젝트 방침대로 경계에서 한 번만 좁힌다.
    const body = res.body as object as {
      accessToken?: string;
      refreshToken?: string;
    };
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBe('sess-2.secret-2');
  });

  // 쿠키가 실리는 상태 변경 요청이라 출처 검증 대상이다.
  it('refresh: 허용되지 않은 출처는 403', async () => {
    await server()
      .post('/auth/refresh')
      .set('Origin', 'https://evil.asuscomm.com')
      .set('Cookie', 'prism_refresh=sess-1.secret-1')
      .expect(403, { error: 'FORBIDDEN_ORIGIN' });
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('logout: 액세스·리프레시 쿠키를 모두 만료시킨다', async () => {
    const token = tokens.signSession(user.id, 'sess-9');
    const res = await server()
      .post('/auth/logout')
      .set('Origin', WEB)
      .set('Cookie', `prism_session=${token}`)
      .expect(204);

    const expired = (res.get('Set-Cookie') ?? []).filter((c) =>
      c.includes('Expires=Thu, 01 Jan 1970'),
    );
    expect(expired.some((c) => c.startsWith('prism_session='))).toBe(true);
    expect(expired.some((c) => c.startsWith('prism_refresh='))).toBe(true);
  });

  // ──────────────── 세션 관리 ────────────────

  // 세션 id는 HttpOnly 쿠키 안에만 있어 클라이언트가 모른다 — 서버가 표시해 줘야 한다.
  it('sessions: 내 세션 목록에 현재 세션을 표시한다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    const res = await server()
      .get('/auth/sessions')
      .set('Cookie', `prism_session=${token}`)
      .expect(200);

    expect(auth.listSessions).toHaveBeenCalledWith(user.id);
    const body = res.body as object as { id: string; isCurrent: boolean }[];
    expect(body.find((s) => s.id === 'sess-1')?.isCurrent).toBe(true);
    expect(body.find((s) => s.id === 'sess-other')?.isCurrent).toBe(false);
  });

  // 회귀 방지: @Get(':provider')가 뒤에 선언돼 있어 순서가 바뀌면
  // /auth/sessions가 provider로 흡수되어 OAuth 실패 리다이렉트가 된다.
  it('sessions: :provider 라우트에 흡수되지 않는다', async () => {
    await server().get('/auth/sessions').expect(401); // 302(리다이렉트)가 아니어야 한다
  });

  it('sessions: 인증이 필요하다', async () => {
    await server().get('/auth/sessions').expect(401);
    expect(auth.listSessions).not.toHaveBeenCalled();
  });

  it('revoke: 내 세션을 폐기한다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    await server()
      .post('/auth/sessions/sess-other/revoke')
      .set('Origin', WEB)
      .set('Cookie', `prism_session=${token}`)
      .expect(204);

    expect(auth.revokeOwnedSession).toHaveBeenCalledWith(user.id, 'sess-other');
  });

  // 남의 세션 id를 넣어도 지워지면 안 된다. 존재 여부도 흘리지 않는다(404 통일).
  it('revoke: 내 것이 아니면 404', async () => {
    auth.revokeOwnedSession.mockResolvedValueOnce(false);
    const token = tokens.signSession(user.id, 'sess-1');
    await server()
      .post('/auth/sessions/someone-elses/revoke')
      .set('Origin', WEB)
      .set('Cookie', `prism_session=${token}`)
      .expect(404);
  });

  it('revoke: 지금 쓰는 세션을 지우면 쿠키도 정리한다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    const res = await server()
      .post('/auth/sessions/sess-1/revoke')
      .set('Origin', WEB)
      .set('Cookie', `prism_session=${token}`)
      .expect(204);

    expect(
      (res.get('Set-Cookie') ?? []).some((c) =>
        c.includes('Expires=Thu, 01 Jan 1970'),
      ),
    ).toBe(true);
  });

  it('revoke: 다른 세션을 지울 때는 내 쿠키를 건드리지 않는다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    const res = await server()
      .post('/auth/sessions/sess-other/revoke')
      .set('Origin', WEB)
      .set('Cookie', `prism_session=${token}`)
      .expect(204);

    expect(res.get('Set-Cookie') ?? []).toHaveLength(0);
  });

  it('revoke-all: 전체 폐기 후 쿠키를 정리한다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    const res = await server()
      .post('/auth/sessions/revoke-all')
      .set('Origin', WEB)
      .set('Cookie', `prism_session=${token}`)
      .expect(204);

    expect(auth.revokeAllSessions).toHaveBeenCalledWith(user.id);
    expect(
      (res.get('Set-Cookie') ?? []).some((c) =>
        c.includes('Expires=Thu, 01 Jan 1970'),
      ),
    ).toBe(true);
  });

  // revoke-all은 정적 경로다 — :id에 먹히면 'revoke-all'이라는 세션을 지우려 든다.
  it('revoke-all: :id 라우트에 먹히지 않는다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    await server()
      .post('/auth/sessions/revoke-all')
      .set('Origin', WEB)
      .set('Cookie', `prism_session=${token}`)
      .expect(204);
    expect(auth.revokeOwnedSession).not.toHaveBeenCalled();
  });

  it('세션 변경은 출처 검증 대상이다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    await server()
      .post('/auth/sessions/revoke-all')
      .set('Origin', 'https://evil.asuscomm.com')
      .set('Cookie', `prism_session=${token}`)
      .expect(403);
  });

  // ──────────────── 콜백 페이지 보안 헤더 ────────────────

  it('popup 콜백 페이지의 보안 헤더가 실제 응답에 실린다', async () => {
    const res = await server()
      .get('/auth/google/callback')
      .query({ state: 'garbage', code: 'x' })
      .expect(200);

    const csp = res.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // 로그인 결과는 캐시·히스토리에 남기지 않는다.
    expect(res.get('Cache-Control')).toContain('no-store');

    // 실행 가능한 스크립트는 nonce가 붙은 하나뿐이어야 한다.
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? '';
    expect(res.text).toContain(`<script nonce="${nonce}">`);
    expect(res.text.match(/<script/g) ?? []).toHaveLength(1);
  });

  // ──────────────── Apple native ────────────────

  it('apple/native: nonce가 없으면 401 (재생 방지)', async () => {
    await server()
      .post('/auth/apple/native')
      .send({ identityToken: 'tok' })
      .expect(401, { error: 'INVALID_TOKEN' });
  });
});
