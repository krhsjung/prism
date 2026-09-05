import { describe, expect, it } from 'vitest';
import {
  SIGNAL_LOG_LIMIT,
  appendSignal,
  formatSignalLog,
  signalEntry,
  type SignalLogEntry,
} from './signal-log';

const at = 1_767_225_600_000; // 2026-01-01T00:00:00.000Z

describe('시그널링 로그', () => {
  it('보낸 것과 받은 것을 방향으로 가른다', () => {
    const sent = signalEntry('sent', { type: 'call', to: 'session-1' }, at);
    const received = signalEntry('received', { type: 'ringing', callId: 'c1' }, at);

    expect(sent.direction).toBe('sent');
    expect(received.direction).toBe('received');
    // 레벨은 두지 않는다 — 원소가 계약의 메시지뿐이라 필터가 원소보다 커진다(§4).
    expect(sent).not.toHaveProperty('level');
  });

  // 로그는 사용자가 통째로 붙여넣는 물건이다 — 담은 것이 곧 새어 나갈 수 있는 것이다(§7).
  it('SDP 본문을 담지 않고 크기만 적는다', () => {
    const sdp = 'v=0\r\n'.repeat(400);
    const entry = signalEntry('sent', { type: 'offer', callId: 'c1', sdp }, at);

    expect(entry.detail).toBe('2.0 kB');
    expect(JSON.stringify(entry)).not.toContain('v=0');
  });

  it('후보 문자열도 크기만 적는다', () => {
    const entry = signalEntry(
      'received',
      {
        type: 'ice',
        callId: 'c1',
        candidate: { candidate: 'candidate:1 1 udp 2 192.168.0.2 5000 typ host' },
      },
      at,
    );

    expect(entry.detail).toBe('45 B');
    expect(JSON.stringify(entry)).not.toContain('192.168');
  });

  it('오류 줄만 오류로 표시한다 — 색은 거기에만 쓴다', () => {
    const error = signalEntry('received', { type: 'callError', code: 'busy' }, at);
    const ended = signalEntry('received', { type: 'ended', callId: 'c1', reason: 'hangup' }, at);

    expect(error.isError).toBe(true);
    expect(error.detail).toBe('busy');
    expect(ended.isError).toBe(false);
    expect(ended.detail).toBe('hangup');
  });

  // 상한이 없으면 긴 통화에서 줄이 끝없이 쌓인다. 버리는 쪽은 **오래된 쪽**이다 —
  // 지금 무슨 일이 나는지가 늘 아래에 있어야 한다.
  it('상한을 넘으면 오래된 줄부터 버린다', () => {
    let entries: SignalLogEntry[] = [];
    for (let i = 0; i < SIGNAL_LOG_LIMIT + 10; i++) {
      entries = appendSignal(
        entries,
        signalEntry('sent', { type: 'ice', callId: 'c1', candidate: { candidate: `${i}` } }, at),
      );
    }

    expect(entries).toHaveLength(SIGNAL_LOG_LIMIT);
    expect(entries[0]?.detail).toBe('2 B'); // 10번째 줄(`10`)이 첫 줄이 됐다
  });

  it('붙여넣기용 텍스트는 시각·방향·종류를 한 줄로 만든다', () => {
    const entries = [
      signalEntry('sent', { type: 'call', to: 'session-1' }, at),
      signalEntry('received', { type: 'callError', code: 'busy' }, at),
    ];

    expect(formatSignalLog(entries)).toBe(
      '00:00:00.000 → call\n00:00:00.000 ← callError busy',
    );
  });
});
