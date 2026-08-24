import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { WebSocket } from 'ws';
import { FakeRedis } from '@app/redis/testing/fake-redis';
import { REDIS } from '@app/redis';
import {
  PresenceRepository,
  SessionsRepository,
  parseJsonValue,
  decodeSocketServerMessage,
  type SocketServerMessage,
  type User,
} from '@app/common';
import { PrismConfigService } from '@app/config';
import {
  JwtAuthGuard,
  SessionAuthenticator,
  SessionTokenService,
} from '@app/session';
import { AppController } from './app.controller';
import { ConnectionRegistry } from './connection-registry';
import { PrismSocketServer } from './socket.server';
import { SessionPresenceGateway } from './session-presence.gateway';

const user: User = {
  id: 'u-1',
  provider: 'google',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const ALLOWED = 'https://prism.example';

// 실제 경계 테스트 — supertest는 WebSocket을 못 하므로 앱을 포트 0에 띄우고 진짜 `ws`
// 클라이언트로 붙는다(*.http.spec.ts 관례의 WS판).
//
// 여기서만 확인할 수 있는 것들이다: 업그레이드가 101 이전에 HTTP로 거절되는가,
// 쿠키와 Bearer가 **같은 규칙**으로 읽히는가, 인증 실패가 코드를 실어 보내고 닫는가.
describe('세션 소켓 경계', () => {
  let app: INestApplication;
  let sessions: { findValid: jest.Mock };
  let tokens: SessionTokenService;
  let url: string;

  beforeEach(async () => {
    sessions = { findValid: jest.fn(() => Promise.resolve(user)) };

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { algorithm: 'HS256', expiresIn: '1h' },
        }),
      ],
      controllers: [AppController],
      providers: [
        SessionTokenService,
        SessionAuthenticator,
        ConnectionRegistry,
        SessionPresenceGateway,
        PrismSocketServer,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: SessionsRepository, useValue: sessions },
        { provide: REDIS, useValue: new FakeRedis() },
        PresenceRepository,
        {
          provide: PrismConfigService,
          useValue: {
            isProduction: false,
            cookiePolicy: { isProduction: false, namespace: '' },
            isAllowedOrigin: (origin: string) => origin === ALLOWED,
          } as object as PrismConfigService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    tokens = app.get(SessionTokenService);
    await app.init();

    const server = app.getHttpServer() as Server;
    app.get(PrismSocketServer).attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    url = `ws://localhost:${port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  const token = () => tokens.signSession(user.id, 's-1');

  // 첫 메시지를 기다린다. 실패도 메시지로 오므로(error 뒤 close) 둘 다 이 함수로 본다.
  const firstMessage = (ws: WebSocket) =>
    new Promise<SocketServerMessage>((resolve, reject) => {
      ws.once('message', (data: Buffer) =>
        resolve(decodeSocketServerMessage(parseJsonValue(data.toString()))),
      );
      ws.once('error', reject);
      ws.once('close', () => reject(new Error('closed before any message')));
    });

  const closed = (ws: WebSocket) =>
    new Promise<void>((resolve) => ws.once('close', () => resolve()));

  it('쿠키로 인증된다(웹 흐름)', async () => {
    const ws = new WebSocket(`${url}/socket`, {
      headers: { cookie: `prism_session=${token()}`, origin: ALLOWED },
    });
    await expect(firstMessage(ws)).resolves.toEqual({ type: 'ready' });
    ws.close();
  });

  // 브라우저 WebSocket은 헤더를 못 붙이지만 네이티브는 붙일 수 있다 — 같은 규칙으로 읽힌다.
  it('Bearer로 인증된다(네이티브 흐름)', async () => {
    const ws = new WebSocket(`${url}/socket`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    await expect(firstMessage(ws)).resolves.toEqual({ type: 'ready' });
    ws.close();
  });

  // 자격증명이 없는 것은 갱신해도 소용없다 — SESSION_EXPIRED가 아니어야 한다.
  it('토큰이 없으면 UNAUTHORIZED를 받고 닫힌다', async () => {
    const ws = new WebSocket(`${url}/socket`);
    await expect(firstMessage(ws)).resolves.toEqual({
      type: 'error',
      code: 'UNAUTHORIZED',
    });
    await closed(ws);
  });

  // 폐기된 세션은 서명이 멀쩡해도 인증이 아니다.
  it('폐기된 세션은 서명이 유효해도 거절된다', async () => {
    sessions.findValid.mockResolvedValue(null);
    const ws = new WebSocket(`${url}/socket`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    await expect(firstMessage(ws)).resolves.toEqual({
      type: 'error',
      code: 'UNAUTHORIZED',
    });
    await closed(ws);
  });

  // WebSocket은 CORS의 보호를 받지 않는다 — 서버가 막지 않으면 아무도 못 막는다.
  // 101 **이전에** HTTP로 거절되므로 클라이언트는 open을 보지 못한다.
  it('허용되지 않은 Origin은 업그레이드 자체가 거절된다', async () => {
    const ws = new WebSocket(`${url}/socket`, {
      headers: {
        cookie: `prism_session=${token()}`,
        origin: 'https://evil.example',
      },
    });
    const error = await new Promise<Error>((resolve) =>
      ws.once('error', resolve),
    );
    expect(error.message).toMatch(/403/);
  });

  it('우리 경로가 아닌 업그레이드는 404로 거절된다', async () => {
    const ws = new WebSocket(`${url}/nope`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    const error = await new Promise<Error>((resolve) =>
      ws.once('error', resolve),
    );
    expect(error.message).toMatch(/404/);
  });

  // 프로브 경로는 자격증명 없이 통과해야 한다 — 아니면 파드가 영영 Ready가 되지 않는다.
  it('프로브 경로는 인증 없이 열려 있다', async () => {
    const server = app.getHttpServer() as Server;
    const { port } = server.address() as AddressInfo;
    for (const path of ['/healthz', '/readyz']) {
      const res = await fetch(`http://localhost:${port}${path}`);
      expect(res.status).toBe(200);
    }
  });
});
