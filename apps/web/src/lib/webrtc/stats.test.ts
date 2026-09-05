import { describe, expect, it } from 'vitest';
import { StatsSampler, pathOf } from './stats';

// `getStats()`가 돌려주는 것은 id로 서로를 가리키는 평평한 맵이다 — Map이 그 모양을
// 그대로 만족한다(forEach 하나만 쓴다).
function report(entries: Record<string, object>): RTCStatsReport {
  // Map이 리포트의 모양(forEach)을 그대로 만족한다 — 우리가 쓰는 것은 그것뿐이다.
  return new Map(Object.entries(entries)) as object as RTCStatsReport;
}

function peerWith(...reports: RTCStatsReport[]): RTCPeerConnection {
  let index = 0;
  return {
    iceConnectionState: 'connected',
    getStats: () => Promise.resolve(reports[index++] ?? reports[reports.length - 1]),
  } as object as RTCPeerConnection;
}

const pair = (over: object = {}) => ({
  id: 'pair',
  type: 'candidate-pair',
  state: 'succeeded',
  nominated: true,
  localCandidateId: 'local',
  remoteCandidateId: 'remote',
  currentRoundTripTime: 0.024,
  timestamp: 1_000,
  bytesSent: 0,
  bytesReceived: 0,
  ...over,
});

describe('경로 판정', () => {
  // 릴레이가 한쪽만 있어도 미디어는 릴레이를 지난다.
  it('한쪽이라도 relay면 relay다', () => {
    expect(pathOf({ type: 'host' }, { type: 'relay' })).toBe('relay');
    expect(pathOf({ type: 'relay' }, { type: 'srflx' })).toBe('relay');
  });

  it('srflx·prflx는 STUN 경유다', () => {
    expect(pathOf({ type: 'srflx' }, { type: 'host' })).toBe('reflexive');
    expect(pathOf({ type: 'prflx' }, { type: 'host' })).toBe('reflexive');
  });

  it('둘 다 host면 직접이다', () => {
    expect(pathOf({ type: 'host' }, { type: 'host' })).toBe('direct');
  });

  // 값이 없으면 무엇이든 지어내지 않는다 — 화면은 그때 `—`를 그린다.
  it('후보가 없으면 판정하지 않는다', () => {
    expect(pathOf(undefined, undefined)).toBeUndefined();
  });
});

describe('지표 읽기', () => {
  it('후보 쌍에서 RTT와 경로를, 후보에서 타입·전송을 읽는다', async () => {
    const stats = await new StatsSampler().read(
      peerWith(
        report({
          pair: pair(),
          local: { id: 'local', type: 'local-candidate', candidateType: 'srflx', protocol: 'udp' },
          remote: { id: 'remote', type: 'remote-candidate', candidateType: 'relay', protocol: 'udp' },
        }),
      ),
    );

    expect(stats.rttMs).toBe(24);
    expect(stats.path).toBe('relay');
    expect(stats.local).toEqual({ type: 'srflx', protocol: 'udp' });
    expect(stats.iceState).toBe('connected');
  });

  // 비트레이트는 **누적 바이트의 차이**라 표본 하나로는 나오지 않는다.
  it('첫 표본에는 비트레이트가 없다', async () => {
    const stats = await new StatsSampler().read(
      peerWith(report({ pair: pair({ bytesSent: 1_000 }) })),
    );

    expect(stats.sendingKbps).toBeUndefined();
    expect(stats.receivingKbps).toBeUndefined();
  });

  it('두 번째 표본부터 차이로 비트레이트를 낸다', async () => {
    const sampler = new StatsSampler();
    const pc = peerWith(
      report({ pair: pair({ timestamp: 1_000, bytesSent: 0, bytesReceived: 0 }) }),
      report({ pair: pair({ timestamp: 2_000, bytesSent: 125_000, bytesReceived: 12_500 }) }),
    );

    await sampler.read(pc);
    const stats = await sampler.read(pc);

    // 1초에 125,000 B = 1,000,000 bit = 1,000 kbps.
    expect(stats.sendingKbps).toBe(1_000);
    expect(stats.receivingKbps).toBe(100);
  });

  it('다시 붙으면 이전 표본을 잊는다', async () => {
    const sampler = new StatsSampler();
    const pc = peerWith(
      report({ pair: pair({ timestamp: 1_000 }) }),
      report({ pair: pair({ timestamp: 2_000, bytesSent: 125_000 }) }),
    );

    await sampler.read(pc);
    sampler.reset();
    const stats = await sampler.read(pc);

    expect(stats.sendingKbps).toBeUndefined();
  });

  it('영상 지표와 손실률을 inbound-rtp에서 읽는다', async () => {
    const stats = await new StatsSampler().read(
      peerWith(
        report({
          video: {
            id: 'video',
            type: 'inbound-rtp',
            kind: 'video',
            jitter: 0.004,
            packetsLost: 5,
            packetsReceived: 995,
            frameWidth: 1280,
            frameHeight: 720,
            framesPerSecond: 29.6,
          },
        }),
      ),
    );

    expect(stats.jitterMs).toBe(4);
    expect(stats.packetLossPct).toBe(0.5);
    expect(stats.video).toEqual({ width: 1280, height: 720, fps: 30 });
  });

  // Safari는 리포트의 일부 필드를 주지 않는다. 없는 숫자를 0으로 그리면 화면이
  // "패킷 손실 0%"라고 **거짓말을 한다**.
  it('없는 값은 0이 아니라 없는 채로 둔다', async () => {
    const stats = await new StatsSampler().read(
      peerWith(report({ video: { id: 'video', type: 'inbound-rtp', kind: 'video' } })),
    );

    expect(stats.jitterMs).toBeUndefined();
    expect(stats.packetLossPct).toBeUndefined();
    expect(stats.video).toBeUndefined();
  });

  // Firefox는 실패한 쌍도 succeeded로 남긴다 — 지금 쓰이는 것은 nominated 쪽이다.
  it('지명되지 않은 후보 쌍은 무시한다', async () => {
    const stats = await new StatsSampler().read(
      peerWith(report({ pair: pair({ nominated: false }) })),
    );

    expect(stats.rttMs).toBeUndefined();
    expect(stats.path).toBeUndefined();
  });

  it('DTLS 상태는 transport에서 읽는다', async () => {
    const stats = await new StatsSampler().read(
      peerWith(report({ t: { id: 't', type: 'transport', dtlsState: 'connected' } })),
    );

    expect(stats.dtlsState).toBe('connected');
  });
});
