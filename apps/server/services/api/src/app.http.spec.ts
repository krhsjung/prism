import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismConfigService } from '@app/config';
import { SessionsRepository, type User } from '@app/common';
import {
  JwtAuthGuard,
  SessionAuthenticator,
  SessionTokenService,
} from '@app/session';
import { AppController } from './app.controller';

const user: User = {
  id: 'u-1',
  provider: 'demo',
  displayName: 'Demo User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// 이 서비스에 나중에 들어올 도메인 엔드포인트를 대신한다 — **아무 표시도 붙이지 않은**
// 평범한 라우트다. 이게 인증 없이 뚫리면 protected-by-default가 성립하지 않은 것이다.
@Controller('things')
class FutureDomainController {
  @Get()
  list(): { items: string[] } {
    return { items: [] };
  }
}

// 전역 가드가 실제로 걸려 있는지는 HTTP로만 증명된다 — 모듈 메타데이터를 읽는 것으로는
// "라우트에 적용됐는가"를 알 수 없다.
describe('api 서비스 인증 경계', () => {
  let app: INestApplication;
  let sessions: { findValid: jest.Mock };
  let tokens: SessionTokenService;

  beforeEach(async () => {
    sessions = { findValid: jest.fn(() => Promise.resolve(user)) };

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { algorithm: 'HS256', expiresIn: '1h' },
        }),
      ],
      controllers: [AppController, FutureDomainController],
      providers: [
        SessionTokenService,
        SessionAuthenticator,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: SessionsRepository, useValue: sessions },
        {
          provide: PrismConfigService,
          useValue: {
            isProduction: false,
            cookiePolicy: { isProduction: false, namespace: '' },
          } as object as PrismConfigService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    tokens = app.get(SessionTokenService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = () =>
    request(app.getHttpServer() as object as Parameters<typeof request>[0]);

  // 이 서비스의 핵심 성질 — 새 엔드포인트는 **아무것도 하지 않아도** 보호된다.
  // 가드를 라우트마다 붙이는 방식이었다면 이 요청이 200으로 통과했을 것이다.
  it('표시 없는 새 라우트는 자격증명 없이 401', async () => {
    await server().get('/things').expect(401, { error: 'UNAUTHORIZED' });
  });

  it('유효한 세션 쿠키가 있으면 통과한다', async () => {
    const token = tokens.signSession(user.id, 'sess-1');
    await server()
      .get('/things')
      .set('Cookie', `prism_session=${token}`)
      .expect(200, { items: [] });
  });

  // 서명이 유효해도 세션이 없으면(로그아웃·폐기) 인증되지 않는다 — auth 서비스와 같은 규칙이
  // 적용되는지 확인한다(검증 로직이 갈리면 한쪽에서만 폐기가 반영된다).
  it('세션이 폐기됐으면 서명이 유효해도 401', async () => {
    sessions.findValid.mockResolvedValue(null);
    const token = tokens.signSession(user.id, 'gone');
    await server()
      .get('/things')
      .set('Cookie', `prism_session=${token}`)
      .expect(401, { error: 'UNAUTHORIZED' });
  });

  // 만료는 갱신으로 살아나는 유일한 실패라 코드가 달라야 한다(웹이 이걸 보고 refresh한다).
  // auth 서비스와 같은 코드 체계를 쓰는지 여기서 확인한다 — 갈리면 웹의 갱신 판단이 깨진다.
  it('만료된 액세스 토큰은 SESSION_EXPIRED로 알린다', async () => {
    const expired = app
      .get(JwtService)
      .sign({ sub: user.id, jti: 'sess-1' }, { expiresIn: '-1s' });
    await server()
      .get('/things')
      .set('Cookie', `prism_session=${expired}`)
      .expect(401, { error: 'SESSION_EXPIRED' });
  });

  // 프로브 경로만 @Public()으로 열려 있다 — 공개가 코드에 드러난다.
  it('@Public()이 붙은 healthz는 자격증명 없이 통과한다', async () => {
    await server().get('/healthz').expect(200, { status: 'ok' });
  });
});
