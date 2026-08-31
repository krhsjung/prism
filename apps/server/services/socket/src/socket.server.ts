import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  AUTH_ERROR_CODES,
  MAX_SDP_LENGTH,
  decodeCallClientMessage,
  parseJsonValue,
  type CallClientMessage,
  type SocketDownstreamMessage,
} from '@app/common';
import { PrismConfigService } from '@app/config';
import { SessionAuthenticator, sessionTokenOf } from '@app/session';
import { CallGateway } from './call.gateway';
import type { SocketConnection } from './connection';
import { SessionPresenceGateway } from './session-presence.gateway';
import { authorizeUpgrade } from './upgrade';

// WebSocket 1008 = policy violation. 인증 실패로 우리가 끊을 때 쓴다.
const CLOSE_POLICY_VIOLATION = 1008;

// 프레임 하나의 상한. 계약이 정한 SDP 상한(문자)에 JSON 이스케이프와 봉투를 얹어도
// 남는 크기이고, 넘는 프레임은 우리가 파싱하기 전에 `ws`가 끊는다 —
// 시그널링을 임의 크기 릴레이로 쓰지 못하게 하는 첫 번째 문이다(plan/webrtc.md §7).
const MAX_FRAME_BYTES = 4 * MAX_SDP_LENGTH;

// `ws`가 넘겨주는 프레임을 문자열로. 조각난 텍스트 프레임은 Buffer 배열로 온다.
const textOf = (data: RawData): string => {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
};

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
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });

  constructor(
    private readonly config: PrismConfigService,
    private readonly authenticator: SessionAuthenticator,
    private readonly gateway: SessionPresenceGateway,
    private readonly calls: CallGateway,
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

      ws.on('message', (data: RawData, isBinary: boolean) => {
        // 계약은 JSON 텍스트뿐이다 — 바이너리 프레임은 우리 것이 아니다.
        if (!isBinary) void this.dispatch(connection, textOf(data));
      });
      ws.on('close', () => this.disconnect(connection));
      ws.on('error', () => this.disconnect(connection));
      await this.gateway.open(connection);
    } catch (error) {
      this.logger.warn(`socket accept failed: ${String(error)}`);
      this.send(ws, { type: 'error', code: AUTH_ERROR_CODES.UNAUTHORIZED });
      ws.close(CLOSE_POLICY_VIOLATION);
    } finally {
      clearTimeout(deadline);
    }
  }

  // 클라 → 서버 방향. **presence는 여기를 보지 않는다** — 시그널링 메시지를 살아
  // 있다는 증거로 쓰면 반쯤 죽은 소켓이 계속 Active로 남는다(plan/webrtc.md §5).
  // 이 메서드가 만지는 것은 CallGateway뿐이고 PresenceRepository는 지나지 않는다.
  private async dispatch(
    connection: SocketConnection,
    text: string,
  ): Promise<void> {
    let message: CallClientMessage;
    try {
      message = decodeCallClientMessage(parseJsonValue(text));
    } catch (error) {
      // 계약에 없는 메시지는 **버리되 연결은 끊지 않는다** — 클라이언트가 우리
      // 메시지를 다루는 규칙과 같다(형식이 어긋났다고 끊을 이유는 없다).
      this.logger.debug(`ignored client message: ${String(error)}`);
      return;
    }
    try {
      await this.calls.handle(connection, message);
    } catch (error) {
      // 한 메시지의 실패가 소켓을 무너뜨리지 않게 한다 — 세션 조회(Redis)가
      // 실패하는 경우가 여기로 온다.
      this.logger.warn(
        `call message failed (${message.type}): ${String(error)}`,
      );
    }
  }

  // 소켓이 사라졌다. 통화를 먼저 정리한다 — presence를 지우는 쪽은 Redis 왕복이 있고,
  // 그 사이에 상대가 끊긴 창구로 SDP를 보내고 있을 이유가 없다.
  private disconnect(connection: SocketConnection): void {
    this.calls.close(connection);
    void this.gateway.close(connection);
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

  private send(ws: WebSocket, message: SocketDownstreamMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }
}
