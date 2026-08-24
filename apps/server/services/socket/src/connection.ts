import type { SocketServerMessage } from '@app/common';

// 게이트웨이가 보는 연결 — `ws`가 아니라 이 인터페이스에만 의존한다.
//
// 경계를 이렇게 그으면 도메인 로직(누가 붙어 있나·누구에게 알릴까·언제 끊을까)을
// 소켓 없이 테스트할 수 있다. SessionsRepository가 RedisClient에만 의존하는 것과 같은 모양이다.
export interface SocketConnection {
  // 이 연결만의 식별자. presence의 member가 `<sessionId>:<connectionId>`라
  // 같은 세션이 연 다른 소켓과 구별된다(탭 여러 개).
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string;

  send(message: SocketServerMessage): void;
  // 이유를 실어 보낸 뒤 닫는다. WebSocket 1008 = policy violation.
  close(): void;
  // 프로토콜 ping을 보내고, 직전 ping에 pong이 없었으면 끊는다.
  // 반쯤 죽은 TCP(모바일 회선 전환 등)는 이것으로만 잡힌다.
  probe(): void;
}
