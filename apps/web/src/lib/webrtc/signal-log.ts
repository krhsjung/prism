import type {
  CallClientMessage,
  CallServerMessage,
} from '../contracts.gen';

// 시그널링 로그 — **원소는 §6 계약의 메시지 그대로다.**
//
// 로그를 위한 이벤트를 새로 만들지 않는다: 만드는 순간 계약이 두 벌이 되고, 화면이
// 서버에 없는 것을 약속하게 된다(plan/webrtc.md §6).
//
// 레벨(DEBUG/INFO/WARN/ERROR)을 두지 않고 **방향**으로 가르는 것도 결정이다. 원소가
// 열 몇 가지뿐이라 네 레벨로 나누면 필터 UI가 원소 수보다 커지고, 시그널링에서 실제로
// 헷갈리는 축은 "누가 offer를 냈나" 곧 방향이다(§4).
//
// ⚠️ **본문은 담지 않는다.** SDP와 후보 문자열은 종류와 크기까지만 적는다(§7) —
// 로그는 사용자가 `Copy log`로 통째로 붙여넣는 물건이라, 담은 것이 곧 새어 나갈 수
// 있는 것이다.

/** 화면에 남기는 줄 수. 통화 하나의 시그널링은 수십 줄이라 넉넉하다. */
export const SIGNAL_LOG_LIMIT = 200;

export interface SignalLogEntry {
  /** 목록 key. 같은 밀리초에 두 줄이 생겨도 갈린다. */
  id: number;
  atMs: number;
  direction: 'sent' | 'received';
  type: CallClientMessage['type'] | CallServerMessage['type'];
  /** 오류 줄만 색을 쓴다(§4). */
  isError: boolean;
  /** 크기·코드처럼 본문이 아닌 것. */
  detail?: string;
}

let nextId = 0;

export function signalEntry(
  direction: 'sent' | 'received',
  message: CallClientMessage | CallServerMessage,
  atMs: number,
): SignalLogEntry {
  return {
    id: nextId++,
    atMs,
    direction,
    type: message.type,
    isError: message.type === 'callError',
    detail: detailOf(message),
  };
}

/** 상한을 넘으면 **오래된 쪽부터** 버린다 — 지금 무슨 일이 나는지가 늘 아래에 있다. */
export function appendSignal(
  entries: readonly SignalLogEntry[],
  entry: SignalLogEntry,
): SignalLogEntry[] {
  const next = [...entries, entry];
  return next.length > SIGNAL_LOG_LIMIT
    ? next.slice(next.length - SIGNAL_LOG_LIMIT)
    : next;
}

/** `Copy log`가 붙여넣는 텍스트. 사용자가 누를 때만 만들어지고 자동 전송은 없다(§7). */
export function formatSignalLog(entries: readonly SignalLogEntry[]): string {
  return entries
    .map((entry) => {
      const at = new Date(entry.atMs).toISOString().slice(11, 23);
      const arrow = entry.direction === 'sent' ? '→' : '←';
      return `${at} ${arrow} ${entry.type}${entry.detail ? ` ${entry.detail}` : ''}`;
    })
    .join('\n');
}

function detailOf(
  message: CallClientMessage | CallServerMessage,
): string | undefined {
  switch (message.type) {
    case 'offer':
    case 'answer':
      return byteSize(message.sdp);
    case 'ice':
      return byteSize(message.candidate.candidate);
    case 'ended':
      return message.reason;
    case 'callError':
      return message.code;
    default:
      return undefined;
  }
}

// 바이트로 적는 이유: SDP는 UTF-8에서 문자 수와 바이트 수가 갈리고, 계약의 상한도
// 문자 기준이라 둘을 섞으면 "상한에 걸렸는데 화면은 여유가 있다고 말하는" 상태가 된다.
function byteSize(value: string): string {
  const bytes = new TextEncoder().encode(value).length;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}
