import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { AUTH_ERROR_CODES, type SocketServerMessage } from '@app/common';
import { PrismConfigService } from '@app/config';
import { SessionAuthenticator, sessionTokenOf } from '@app/session';
import type { SocketConnection } from './connection';
import { SessionPresenceGateway } from './session-presence.gateway';
import { authorizeUpgrade } from './upgrade';

// WebSocket 1008 = policy violation. 인증 실패로 우리가 끊을 때 쓴다.
const CLOSE_POLICY_VIOLATION = 1008;

// `ws`를 아는 **유일한** 파일. 위쪽(게이트웨이)은 SocketConnection 인터페이스만 본다.
//
// @nestjs/websockets + WsAdapter를 쓰지 않은 이유:
//  1) WsAdapter는 `{event, data}` 봉투로 디스패치하는데 우리 계약은 `type` 판별 유니온 +
//     손으로 쓴 디코더다 — 프레임워크의 유일한 기여를 되돌려야 한다.
//  2) 업그레이드 **전** 훅이 없다. handleConnection은 101 이후라 Origin/경로 거절이
//     HTTP 상태가 아니라 close 코드가 되고, 허용되지 않은 출처와 101을 주고받게 된다.
//  3) 방·ack·DTO 파이프를 하나도 쓰지 않으면서 의존성만 는다.
// (cookie-parser 대신 cookieOf를, zod 대신 자체 디코더를 쓴 것과 같은 판단이다)
@Injectable()
export class PrismSocketServer {
  private readonly logger = new Logger(PrismSocketServer.name);
  // noServer: 업그레이드를 **우리가** 받아 검사한 뒤에만 넘긴다.
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(
    private readonly config: PrismConfigService,
    private readonly authenticator: SessionAuthenticator,
    private readonly gateway: SessionPresenceGateway,
  ) {}

  attach(server: Server): void {
    server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head);
    });
    this.gateway.start();
  }

  private handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const decision = authorizeUpgrade(
      req.url,
      { origin: req.headers.origin },
      (origin) => this.config.isAllowedOrigin(origin),
    );
    if (!decision.allow) {
      // 101 이전에 HTTP로 답한다 — 접근 로그와 curl에 그대로 남아 진단이 쉽다.
      const text = decision.status === 403 ? 'Forbidden' : 'Not Found';
      socket.write(`HTTP/1.1 ${decision.status} ${text}\r\n\r\n`);
      socket.destroy();
      this.logger.debug(`upgrade rejected (${decision.reason})`);
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.accept(ws, req);
    });
  }

  // 인증은 **101 이후**에 한다 — 브라우저 WebSocket API가 실패한 핸드셰이크의 HTTP
  // 상태를 전혀 노출하지 않기 때문이다(1006뿐). 웹의 액세스 토큰은 15분인데 소켓은 몇
  // 시간을 살아서, 유휴 뒤 재연결은 거의 늘 만료 상태에서 시작한다 — 구분이 없으면
  // "갱신하면 살아난다"와 "소켓 파드가 죽었다"를 클라이언트가 영영 못 가른다.
  private async accept(ws: WebSocket, req: IncomingMessage): Promise<void> {
    // 101은 됐는데 아무 말도 하지 않는 소켓이 남아 있지 않게 한다.
    const deadline = setTimeout(() => {
      ws.close(CLOSE_POLICY_VIOLATION);
    }, this.gateway.authDeadlineMs);

    try {
      // 웹은 HttpOnly 쿠키, 네이티브는 Bearer — HTTP와 **같은** 규칙으로 찾는다.
      // (sessionTokenOf가 헤더 두 개만 보는 구조적 타입을 받아 IncomingMessage가 그대로 맞는다)
      const token = sessionTokenOf(req, this.config.cookiePolicy);
      const result = await this.authenticator.authenticate(token);
      if (!result.ok) {
        this.send(ws, { type: 'error', code: result.code });
        ws.close(CLOSE_POLICY_VIOLATION);
        return;
      }

      const connection = this.connectionFor(
        ws,
        result.user.id,
        result.sessionId,
      );
      // 인증 사이에 클라이언트가 떠났을 수 있다 — presence에 등록하고 나서 알면 늦다.
      if (ws.readyState !== WebSocket.OPEN) return;

      ws.on('close', () => void this.gateway.close(connection));
      ws.on('error', () => void this.gateway.close(connection));
      await this.gateway.open(connection);
    } catch (error) {
      this.logger.warn(`socket accept failed: ${String(error)}`);
      this.send(ws, { type: 'error', code: AUTH_ERROR_CODES.UNAUTHORIZED });
      ws.close(CLOSE_POLICY_VIOLATION);
    } finally {
      clearTimeout(deadline);
    }
  }

  private connectionFor(
    ws: WebSocket,
    userId: string,
    sessionId: string,
  ): SocketConnection {
    // 한 세션이 소켓을 여럿 열 수 있어(탭 여러 개) 연결마다 고유 id를 준다 —
    // presence의 member가 `<sessionId>:<connectionId>`다.
    const id = randomUUID();
    // 직전 스윕의 ping에 pong이 돌아왔는가. 반쯤 죽은 TCP는 이것으로만 잡힌다.
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });

    return {
      id,
      userId,
      sessionId,
      send: (message) => this.send(ws, message),
      close: () => ws.close(CLOSE_POLICY_VIOLATION),
      probe: () => {
        if (!alive) {
          // 정상 close 핸드셰이크를 기다리지 않는다 — 상대는 이미 없다.
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      },
    };
  }

  private send(ws: WebSocket, message: SocketServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }
}
