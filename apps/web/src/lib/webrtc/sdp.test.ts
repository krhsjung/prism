import { describe, expect, it } from 'vitest';
import { fingerprintsOf, sameConnection } from './sdp';

// offer를 받는 쪽은 이 답 하나로 "이어 붙일까, 새로 세울까"를 가른다 — 틀리면 ICE restart가
// 새 연결에 들어가 통화가 끊기거나, 정책 전환의 새 offer가 옛 연결에 들어간다.

const chrome = (fp: string) =>
  [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    `a=fingerprint:sha-256 ${fp}`,
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    `a=fingerprint:sha-256 ${fp}`,
  ].join('\r\n');

const firefox = (fp: string) =>
  ['v=0', `a=fingerprint:sha-256 ${fp}`, 'm=audio 9 UDP/TLS/RTP/SAVPF 111'].join(
    '\n',
  );

describe('sdp — 연결의 신원', () => {
  it('m-section마다 실린 같은 지문은 하나로 읽는다', () => {
    expect(fingerprintsOf(chrome('AA:BB'))).toEqual(['sha-256 aa:bb']);
  });

  it('같은 연결의 재-offer(ICE restart)는 같은 연결로 본다', () => {
    expect(sameConnection(chrome('AA:BB'), chrome('AA:BB'))).toBe(true);
  });

  // Firefox는 세션 수준에 한 번, Chrome은 m-section마다 — 값이 같으면 같은 연결이다.
  it('지문을 어디에 적었든 값이 같으면 같은 연결이다', () => {
    expect(sameConnection(chrome('AA:BB'), firefox('aa:bb'))).toBe(true);
  });

  it('새로 세운 연결의 offer는 지문이 달라 다른 연결로 본다', () => {
    expect(sameConnection(chrome('AA:BB'), chrome('CC:DD'))).toBe(false);
  });

  // 모르는 것을 "같다"로 접으면 낯선 offer를 살아 있는 연결에 붙인다.
  it('지문이 없으면 같다고 하지 않는다', () => {
    expect(sameConnection('v=0', 'v=0')).toBe(false);
    expect(sameConnection('v=0', chrome('AA:BB'))).toBe(false);
  });
});
