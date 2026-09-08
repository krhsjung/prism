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
  decodeSocketDownstreamMessage,
  decodeSocketServerMessage,
  type SessionInfo,
  type SocketDownstreamMessage,
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
import { CallGateway } from './call.gateway';
import { ConnectionRegistry } from './connection-registry';
import { PushSender } from '@app/push';
import { PrismSocketServer } from './socket.server';
import { SessionPresenceGateway } from './session-presence.gateway';

const user: User = {
  id: 'u-1',
  provider: 'google',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const ALLOWED = 'https://prism.example';

// 이 사용자의 세션 둘 — 통화의 소유권 확인이 읽는 목록이다(GET /auth/sessions와 같은 원천).
const owned: SessionInfo[] = [
  {
    id: 's-1',
    startedAt: '2026-08-28T00:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z',
    device: 'mac',
    pushRegistered: false,
  },
  {
    id: 's-2',
    startedAt: '2026-08-28T00:00:00.000Z',
    expiresAt: '2026-08-29T00:00:00.000Z',
    device: 'iphone',
    pushRegistered: false,
  },
];

// 실제 경계 테스트 — supertest는 WebSocket을 못 하므로 앱을 포트 0에 띄우고 진짜 `ws`
// 클라이언트로 붙는다(*.http.spec.ts 관례의 WS판).
//
// 여기서만 확인할 수 있는 것들이다: 업그레이드가 101 이전에 HTTP로 거절되는가,
// 쿠키와 Bearer가 **같은 규칙**으로 읽히는가, 인증 실패가 코드를 실어 보내고 닫는가.
describe('세션 소켓 경계', () => {
  let app: INestApplication;
  let sessions: {
    findValid: jest.Mock;
    findValidSession: jest.Mock;
    listForUser: jest.Mock;
  };
  let tokens: SessionTokenService;
  let url: string;

  beforeEach(async () => {
    sessions = {
      findValid: jest.fn(() => Promise.resolve(user)),
      findValidSession: jest.fn(() =>
        Promise.resolve({
          user,
          absoluteExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        }),
      ),
      listForUser: jest.fn(() => Promise.resolve(owned)),
    };

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
        CallGateway,
        PrismSocketServer,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: SessionsRepository, useValue: sessions },
        // 이 스위트는 소켓 경계(업그레이드 인증·Origin)를 본다 — 전송은 관심사가 아니다.
        {
          provide: PushSender,
          useValue: { send: jest.fn(() => Promise.resolve('accepted')) },
        },
        { provide: REDIS, useValue: new FakeRedis() },
        PresenceRepository,
        {
          provide: PrismConfigService,
          useValue: {
            isProduction: false,
            cookiePolicy: { isProduction: false, namespace: '' },
            isAllowedOrigin: (origin: string) => origin === ALLOWED,
            iceServersFor: () => [{ urls: ['stun:stun.example:3478'] }],
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

  // 붙어서 ready까지 받은 연결 하나.
  const open = async (sessionId: string): Promise<WebSocket> => {
    const ws = new WebSocket(`${url}/socket`, {
      headers: {
        authorization: `Bearer ${tokens.signSession(user.id, sessionId)}`,
      },
    });
    await expect(firstMessage(ws)).resolves.toEqual({ type: 'ready' });
    return ws;
  };

  // 기다리는 종류가 올 때까지 나머지(presence 신호)는 흘려보낸다.
  const waitFor = (ws: WebSocket, type: string) =>
    new Promise<SocketDownstreamMessage>((resolve, reject) => {
      const onMessage = (data: Buffer) => {
        const message = decodeSocketDownstreamMessage(
          parseJsonValue(data.toString()),
        );
        if (message.type !== type) return;
        ws.off('message', onMessage);
        resolve(message);
      };
      ws.on('message', onMessage);
      ws.once('error', reject);
    });

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
    sessions.findValidSession.mockResolvedValue(null);
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

  // **클라 → 서버 방향이 이 저장소에서 처음 열리는 자리다.** 계약·디코더·통화
  // 게이트웨이가 진짜 소켓 위에서 이어져 있는지는 이 층에서만 확인할 수 있다.
  it('한 세션이 다른 세션을 부르면 벨이 울린다', async () => {
    const caller = await open('s-1');
    const callee = await open('s-2');

    const ringing = waitFor(caller, 'ringing');
    const incoming = waitFor(callee, 'incoming');
    caller.send(JSON.stringify({ type: 'call', to: 's-2' }));

    const answer = await ringing;
    if (answer.type !== 'ringing') throw new Error('expected ringing');
    // callId는 **서버가** 발급한다 — 클라가 만든 id를 믿으면 남의 통화에 ice를
    // 흘려 넣을 수 있다. 양쪽이 같은 id를 받는 것이 그 증거다.
    expect(answer.callId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await incoming).toEqual({
      type: 'incoming',
      callId: answer.callId,
      from: { id: 's-1', device: 'mac' },
    });
    caller.close();
    callee.close();
  });

  // 형식이 어긋났다고 연결을 끊지 않는다 — 클라이언트가 우리 메시지를 다루는 규칙과
  // 같다. 뒤이은 정상 메시지가 답을 받는 것이 소켓이 살아 있다는 증거다.
  it('계약에 없는 프레임은 버리되 연결은 살려 둔다', async () => {
    const ws = await open('s-1');

    ws.send('not json at all');
    ws.send(JSON.stringify({ type: 'join', room: 'x' }));
    ws.send(JSON.stringify({ type: 'call', to: 's-2' }));

    // s-2는 소켓이 없다 — 푸시 경로는 아직 붙지 않았다(plan/push.md).
    expect(await waitFor(ws, 'callError')).toEqual({
      type: 'callError',
      code: 'unreachable',
    });
    ws.close();
  });

  // 프레임 **크기**만 막고 **개수**를 두지 않으면, 한 연결이 시그널링을 무한 반복해
  // 파드의 CPU와 Redis 왕복을 가져간다. `call`은 세션 목록 조회를 부르는 쪽이라 촘촘한
  // 상한을 따로 둔다 — 넘친 프레임은 **버리되 연결은 살려 둔다**.
  it('저장소를 건드리는 메시지는 창 안에서 개수가 막힌다', async () => {
    const ws = await open('s-1');
    const errors: SocketDownstreamMessage[] = [];
    ws.on('message', (data: Buffer) => {
      const message = decodeSocketDownstreamMessage(
        parseJsonValue(data.toString()),
      );
      if (message.type === 'callError') errors.push(message);
    });

    for (let at = 0; at < 15; at += 1) {
      ws.send(JSON.stringify({ type: 'call', to: 's-2' }));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(errors).toHaveLength(10);
    ws.close();
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
