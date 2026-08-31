import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  RING_TIMEOUT_MS,
  SessionsRepository,
  type CallClientMessage,
  type CallEndReason,
  type CallServerMessage,
  type DeviceKind,
  type SessionRef,
} from '@app/common';
import { PrismConfigService } from '@app/config';
import type { SocketConnection } from './connection';
import { ConnectionRegistry } from './connection-registry';

// 끝난 통화를 기억해 두는 시간.
//
// `resume`이 `expired`에 **누가 걸었는지**를 실어 주려면 통화가 끝난 뒤에도 잠깐은
// 남아 있어야 한다 — 빈 화면 대신 무슨 일이었는지 그리게 하는 것이 그 메시지의 존재
// 이유다(plan/webrtc.md §6). 창을 넘겨 물으면 기기 종류를 지어내지 않고 제목만 그린다.
//
// **부재중 기록이 아니다.** 프로세스 메모리에만 있고 파드가 내려가면 사라진다 —
// 저장을 만들면 그 저장은 세션보다 오래 산다(§9-10).
const ENDED_RETENTION_MS = 5 * 60_000;

type CallPhase = 'ringing' | 'active' | 'ended';

// 통화의 한쪽. **세션이 당사자이고 연결은 창구다.**
//
// 세션 하나가 탭 여럿으로 소켓을 여러 개 열 수 있어서(presence의 member가
// `<sessionId>:<connectionId>`인 것과 같은 사실이다) 소유권은 세션으로 보고 배달은
// 연결로 한다. 둘을 뭉치면 벨을 함께 받은 다른 탭이 answer를 하나 더 보낸다.
interface CallParty {
  sessionId: string;
  device: DeviceKind;
  // 받는 쪽은 `accept`가 오기 전까지 창구가 없다 — 벨은 그 세션의 **모든** 연결에
  // 울리고, 먼저 받은 연결이 창구가 된다.
  connection: SocketConnection | null;
}

interface Call {
  id: string;
  userId: string;
  caller: CallParty;
  callee: CallParty;
  phase: CallPhase;
  // 벨이 울리는 동안은 상한(RING_TIMEOUT_MS), 끝난 뒤에는 보존 창이다.
  timer: NodeJS.Timeout | null;
}

const refOf = (party: CallParty): SessionRef => ({
  id: party.sessionId,
  device: party.device,
});

// 통화의 주인. **서버가 쥐는 것은 `callId ↔ 두 세션`뿐이고 미디어는 지나지 않는다**
// (plan/webrtc.md §5).
//
// ⚠️ **여기서 presence를 만지지 않는다.** 클라 → 서버 방향이 열려도 `isConnected`는
// 여전히 소켓의 **존재만** 보고 정해진다 — 시그널링 메시지를 살아 있다는 증거로 쓰면
// 반쯤 죽은 소켓이 계속 Active로 남는다. 이 파일이 PresenceRepository를 의존하지
// 않는 것이 그 규칙의 코드 쪽 표현이다.
//
// 상태는 프로세스 메모리다 — `ConnectionRegistry`와 **같은 자리에서 같은 승격**을
// 한다(파드를 늘리면 @app/redis pub/sub).
@Injectable()
export class CallGateway implements OnModuleDestroy {
  private readonly calls = new Map<string, Call>();
  // 세션 → 진행 중인 통화. "한 세션은 한 통화만"을 **서버가** 강제하는 자리다.
  private readonly bySession = new Map<string, string>();

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly sessions: SessionsRepository,
    private readonly config: PrismConfigService,
  ) {}

  async handle(
    connection: SocketConnection,
    message: CallClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case 'call':
        await this.start(connection, message.to);
        return;
      case 'accept':
        this.accept(connection, message.callId);
        return;
      case 'decline':
        this.decline(connection, message.callId);
        return;
      case 'cancel':
        this.cancel(connection, message.callId);
        return;
      case 'hangup':
        this.hangup(connection, message.callId);
        return;
      case 'offer':
      case 'answer':
      case 'ice':
        this.relay(connection, message);
        return;
      case 'resume':
        this.resume(connection, message.callId);
        return;
    }
  }

  // 소켓이 사라졌다. **창구였던 연결만** 통화를 끝낸다.
  //
  // 벨이 울리는 중인 받는 쪽의 소켓이 끊기는 것은 끝이 아니다 — 앱이 다시 붙어
  // `resume`으로 돌아올 수 있는 자리이고, 그 창을 재는 것이 45초 타이머다.
  // 여기서 끊어 버리면 `resume`이 존재할 이유가 없어진다.
  //
  // **세션 폐기도 같은 문으로 들어온다** — 스윕이 폐기된 세션의 소켓을 닫으면
  // (SessionPresenceGateway.tick) 그 close가 여기로 온다. 두 경로가 한 결말이다.
  close(connection: SocketConnection): void {
    for (const call of [...this.calls.values()]) {
      if (call.phase === 'ended') continue;
      const bound =
        call.caller.connection === connection ||
        call.callee.connection === connection;
      if (bound) this.end(call, 'peer-gone');
    }
  }

  // 거는 쪽이 상대를 지목했다.
  //
  // 확인 순서가 중요하다: **자기 자신 → 소유권 → 동시 통화 → 도달 가능**. 도달
  // 가능 여부를 먼저 답하면 남의 세션 id를 넣어 존재를 떠보는 경로가 열린다.
  private async start(connection: SocketConnection, to: string): Promise<void> {
    // 자기 자신은 소켓으로 부르지 않는다 — 루프백은 클라이언트 안에서 끝난다(§4).
    // 여기서 릴레이하면 벨과 받는 화면이 한 탭에 겹치고 서버에 자기-릴레이 분기가 생긴다.
    if (to === connection.sessionId) {
      connection.send({ type: 'callError', code: 'self' });
      return;
    }

    // 목록 조회 한 번이 **소유권 확인과 기기 종류 조회를 겸한다** — 화면이 쓰는
    // GET /auth/sessions와 같은 원천이라, 목록에 없는 것은 걸 수도 없다.
    const owned = await this.sessions.listForUser(connection.userId);
    const callee = owned.find((session) => session.id === to);
    const caller = owned.find((session) => session.id === connection.sessionId);
    // **없는 세션과 남의 세션을 구별해 주지 않는다**(§6). 내 세션이 방금 폐기된
    // 경우도 같은 코드로 접는다 — 스윕이 곧 이 소켓을 끊는다.
    if (!callee || !caller) {
      connection.send({ type: 'callError', code: 'unknown-session' });
      return;
    }

    // 한 세션은 한 통화만. 거는 쪽이 이미 통화 중인 경우도 같은 코드다 — 상한을
    // 넘긴 것이 사실이고, 클라이언트가 화면 전환 없이 알림 한 줄로 받는다(§3.2).
    if (this.bySession.has(caller.id) || this.bySession.has(callee.id)) {
      connection.send({ type: 'callError', code: 'busy' });
      return;
    }

    const ring = this.registry.connectionsOfSession(
      connection.userId,
      callee.id,
    );
    if (ring.length === 0) {
      // 소켓이 없다. **푸시로 깨우는 경로는 push 슬라이스와 함께 붙는다**(§8-11) —
      // 그때까지 소켓 없는 기기는 걸 수 없고, 화면은 그 줄을 `Notifications off`로
      // 그린다(문구는 이미 i18n에 있다).
      connection.send({ type: 'callError', code: 'unreachable' });
      return;
    }

    // **callId는 서버가 발급한다**(추측 불가 난수). 클라가 만든 id를 믿으면 남의
    // 통화에 ice를 흘려 넣을 수 있다(§6).
    const call: Call = {
      id: randomUUID(),
      userId: connection.userId,
      caller: { sessionId: caller.id, device: caller.device, connection },
      callee: { sessionId: callee.id, device: callee.device, connection: null },
      phase: 'ringing',
      timer: null,
    };
    this.calls.set(call.id, call);
    this.bySession.set(call.caller.sessionId, call.id);
    this.bySession.set(call.callee.sessionId, call.id);
    // **타이머는 서버만 갖는다** — 클라가 재면 시계가 두 벌이 되고 어긋난다(§6).
    call.timer = this.arm(RING_TIMEOUT_MS, () => this.end(call, 'timeout'));

    const from = refOf(call.caller);
    for (const target of ring) {
      target.send({ type: 'incoming', callId: call.id, from });
    }
    // 거는 쪽에는 **이 연결에만** 간다 — 창구가 이미 정해져 있다.
    connection.send({ type: 'ringing', callId: call.id });
  }

  private accept(connection: SocketConnection, callId: string): void {
    const call = this.ringingFor(connection, callId);
    if (!call) return;
    this.disarm(call);
    call.phase = 'active';
    // 먼저 받은 연결이 창구가 된다. 벨을 함께 받았던 다른 탭은 이 통화의 창구가 아니다.
    call.callee.connection = connection;

    // ICE 서버는 여기서 처음 내려간다 — 통화가 성립하기 전에는 TURN 자격증명을
    // 줄 이유가 없다.
    const accepted: CallServerMessage = {
      type: 'accepted',
      callId: call.id,
      iceServers: this.config.iceServers,
    };
    // 양쪽에 간다. **이것을 받은 거는 쪽이 offer를 낸다** — 역할이 방향에서 나오므로
    // glare가 구조적으로 없다(§6).
    call.caller.connection?.send(accepted);
    connection.send(accepted);
  }

  private decline(connection: SocketConnection, callId: string): void {
    const call = this.ringingFor(connection, callId);
    if (!call) return;
    // 거절은 종료와 다른 결말이라 `ended`가 아니라 `declined`다 — 화면이 오류가 아닌
    // 알림 한 줄(Info)로 받는다(§3.2).
    this.finish(call, { type: 'declined', callId: call.id });
  }

  // 거는 쪽이 벨을 접는다. 붙은 뒤로는 `hangup`의 자리다.
  private cancel(connection: SocketConnection, callId: string): void {
    const call = this.calls.get(callId);
    if (!call || call.phase !== 'ringing') return;
    if (!this.partyOf(call, connection)) return;
    if (call.caller.sessionId !== connection.sessionId) return;
    this.end(call, 'hangup');
  }

  // 어느 쪽이든 끝낼 수 있고, 벨이 울리는 중에도 끝낼 수 있다 — "이 통화를 끝내라"의
  // 보편 동사다.
  private hangup(connection: SocketConnection, callId: string): void {
    const call = this.calls.get(callId);
    if (!call || call.phase === 'ended') return;
    if (!this.partyOf(call, connection)) return;
    this.end(call, 'hangup');
  }

  // SDP·ICE는 그대로 넘긴다. **서버는 내용을 보지 않는다** — 크기와 형식은 경계의
  // 디코더가 이미 봤고, 여기서 하는 확인은 "보낸 연결이 이 통화의 창구인가" 하나다.
  //
  // 방향(누가 offer를 내는가)은 강제하지 않는다. 역할은 프로토콜의 모양에서 나오고
  // (`accepted`를 받은 쪽이 낸다), 두 창구가 **같은 사용자의 기기**라 서버가 순서를
  // 감시해서 얻을 것이 없다. ICE restart의 재-offer(§8-9)도 이 자리를 그대로 쓴다.
  private relay(
    connection: SocketConnection,
    message: Extract<CallClientMessage, { type: 'offer' | 'answer' | 'ice' }>,
  ): void {
    const call = this.calls.get(message.callId);
    if (!call || call.phase !== 'active') return;
    this.peerOf(call, connection)?.send(message);
  }

  // 늦게 온 기기의 유일한 질문 — 이 통화가 아직 살아 있나.
  //
  // 살아 있으면 벨을 다시 울리고, 아니면 `expired`다. **통화가 없어졌는지와 애초에
  // 남의 통화였는지를 구별해 주지 않는다**(§6) — 모르는 id도, 남의 id도, 끝난 id도
  // 같은 메시지로 답한다. 다른 것은 `from`뿐인데 그건 내가 당사자였을 때만 실리므로
  // 묻는 쪽이 이미 알고 있던 사실이다.
  private resume(connection: SocketConnection, callId: string): void {
    const call = this.calls.get(callId);
    const mine =
      call?.userId === connection.userId &&
      call?.callee.sessionId === connection.sessionId;
    if (call && mine && call.phase === 'ringing') {
      connection.send({ type: 'incoming', callId, from: refOf(call.caller) });
      return;
    }
    const from = call && mine ? refOf(call.caller) : undefined;
    connection.send(
      from ? { type: 'expired', callId, from } : { type: 'expired', callId },
    );
  }

  // 벨이 울리는 중인 **내가 받는** 통화인가.
  //
  // 당사자가 아니면 아무 말도 하지 않는다 — 존재 여부를 답하는 순간 남의 callId를
  // 떠보는 경로가 열린다(unknown-session과 같은 이유).
  private ringingFor(
    connection: SocketConnection,
    callId: string,
  ): Call | null {
    const call = this.calls.get(callId);
    if (!call || call.phase !== 'ringing') return null;
    if (call.userId !== connection.userId) return null;
    if (call.callee.sessionId !== connection.sessionId) return null;
    return call;
  }

  // 이 연결이 대변하는 당사자. **세션으로** 본다 — 벨을 함께 받은 다른 탭도 당사자다.
  private partyOf(call: Call, connection: SocketConnection): CallParty | null {
    if (call.userId !== connection.userId) return null;
    if (call.caller.sessionId === connection.sessionId) return call.caller;
    if (call.callee.sessionId === connection.sessionId) return call.callee;
    return null;
  }

  // 이 연결의 상대편 창구. **연결로** 본다 — 벨을 함께 받았던 다른 탭은 창구가
  // 아니므로 여기서 걸러지고, 그래서 answer가 두 번 가지 않는다.
  private peerOf(
    call: Call,
    connection: SocketConnection,
  ): SocketConnection | null {
    if (call.caller.connection === connection) return call.callee.connection;
    if (call.callee.connection === connection) return call.caller.connection;
    return null;
  }

  private end(call: Call, reason: CallEndReason): void {
    this.finish(call, { type: 'ended', callId: call.id, reason });
  }

  // 통화를 끝내고 양쪽에 알린다.
  //
  // 알림은 **두 세션의 모든 연결**로 간다. 벨을 함께 받았던 탭이 끝난 통화의 모달을
  // 붙들고 있으면 안 되기 때문이고, 자기 통화가 아닌 연결은 모르는 callId를 그냥
  // 버린다. `CallEndReason`이 받는 사람의 사정이 아니라 **통화의 성질**로 쓰여 있어
  // 같은 문장을 그대로 여럿에게 보낼 수 있다.
  private finish(call: Call, notice: CallServerMessage): void {
    if (call.phase === 'ended') return;
    this.disarm(call);
    call.phase = 'ended';
    call.caller.connection = null;
    call.callee.connection = null;
    this.release(call.caller.sessionId, call.id);
    this.release(call.callee.sessionId, call.id);

    for (const sessionId of [call.caller.sessionId, call.callee.sessionId]) {
      for (const target of this.registry.connectionsOfSession(
        call.userId,
        sessionId,
      )) {
        target.send(notice);
      }
    }

    // 끝난 뒤에도 잠깐 남는다 — `resume`이 `expired`에 `from`을 실으려면 필요하다.
    call.timer = this.arm(ENDED_RETENTION_MS, () => this.calls.delete(call.id));
  }

  // 다른 통화가 이미 그 세션을 차지했을 수 있다(끝난 직후 되걸기) — 내 id일 때만 푼다.
  private release(sessionId: string, callId: string): void {
    if (this.bySession.get(sessionId) === callId) {
      this.bySession.delete(sessionId);
    }
  }

  private arm(delayMs: number, run: () => void): NodeJS.Timeout {
    const timer = setTimeout(run, delayMs);
    // 타이머 하나 때문에 프로세스가 안 죽는 일이 없게 한다(presence 스윕과 같은 규칙).
    timer.unref?.();
    return timer;
  }

  private disarm(call: Call): void {
    if (call.timer) clearTimeout(call.timer);
    call.timer = null;
  }

  // 파드가 내려간다. 아직 열려 있는 소켓에는 끝을 알리고, 보존 창은 걷어낸다 —
  // 살아남을 통화가 없는데 타이머만 남기면 종료가 늦어진다.
  onModuleDestroy(): void {
    for (const call of [...this.calls.values()]) {
      this.end(call, 'peer-gone');
      this.disarm(call);
    }
    this.calls.clear();
    this.bySession.clear();
  }
}
