// `getStats()`를 **여섯 지표와 한 경로**로 접는다.
//
// KVS 테스트 페이지는 리포트를 그대로 흘리지만(plan/webrtc.md §4), 덤프는 "많이
// 보여준다"가 아니라 "읽을 수 없다"에 가깝다. 여기서 고르는 것은 통화가 좋은지 나쁜지를
// 실제로 가르는 값들뿐이다.
//
// **없는 값은 0이 아니라 `undefined`다.** Safari는 리포트의 일부 필드를 주지 않는데,
// 없는 숫자를 0으로 그리면 화면이 "패킷 손실 0%"라고 **거짓말을 한다**.

/** 미디어가 어떤 경로로 흐르는가. 라벨은 `webrtc.ice_path_*`가 갖는다. */
export type IcePath = 'direct' | 'reflexive' | 'relay' | 'loopback';

/** 후보 한쪽. **주소는 담지 않는다** — 타입과 전송까지만 화면에 낸다(§7). */
export interface CandidateInfo {
  type: string;
  protocol?: string;
}

export interface CallStats {
  /** ms */
  rttMs?: number;
  /** ms */
  jitterMs?: number;
  /** 0–100 */
  packetLossPct?: number;
  /** kbps */
  sendingKbps?: number;
  /** kbps */
  receivingKbps?: number;
  video?: { width: number; height: number; fps?: number };
  path?: IcePath;
  local?: CandidateInfo;
  remote?: CandidateInfo;
  /** ICE의 진행 단계. 붙는 중인지 되찾는 중인지가 여기서 갈린다. */
  iceState?: RTCIceConnectionState;
  /** DTLS 핸드셰이크. **미디어가 암호화됐다는 증거가 이 한 줄이다.** */
  dtlsState?: string;
}

/** 후보 두 쪽에서 경로를 정한다. 릴레이가 한쪽만 있어도 미디어는 릴레이를 지난다. */
export function pathOf(
  local: CandidateInfo | undefined,
  remote: CandidateInfo | undefined,
): IcePath | undefined {
  const types = [local?.type, remote?.type].filter(Boolean);
  if (types.length === 0) return undefined;
  if (types.includes('relay')) return 'relay';
  if (types.includes('srflx') || types.includes('prflx')) return 'reflexive';
  return 'direct';
}

/** 이전 표본과의 차이가 있어야 나오는 값(비트레이트)을 위해 표본을 하나 기억한다. */
interface Sample {
  atMs: number;
  /**
   * 어느 쌍에서 온 값인가.
   *
   * **쌍이 바뀌면 누적 바이트를 이어 붙이면 안 된다** — 새 쌍의 누계는 0부터 다시
   * 세므로 빼면 음수가 나오고, 반대로 옛 쌍으로 되돌아가면 없던 트래픽이 생긴다.
   */
  pairId: string;
  bytesSent: number;
  bytesReceived: number;
}

/**
 * 한 `RTCPeerConnection`의 지표를 되풀이해 읽는다.
 *
 * 비트레이트는 **누적 바이트의 차이**라 표본 하나로는 나오지 않는다 — 첫 호출은
 * `sendingKbps`/`receivingKbps` 없이 돌아오고, 그때 화면은 `—`를 그린다.
 */
export class StatsSampler {
  private previous: Sample | null = null;

  reset(): void {
    this.previous = null;
  }

  async read(pc: RTCPeerConnection): Promise<CallStats> {
    const report = await pc.getStats();
    const stats: CallStats = { iceState: pc.iceConnectionState };

    // 리포트는 id로 서로를 가리키는 평평한 맵이다 — 후보 쌍을 먼저 찾고 거기서 양쪽
    // 후보를 되짚는다.
    let pair: RTCIceCandidatePairStats | undefined;
    let selectedPairId: string | undefined;
    const byId = new Map<string, RTCStats>();

    report.forEach((entry) => {
      byId.set(entry.id, entry);
      // transport는 **지금 쓰는 쌍**을 id로 짚어 준다. 이것이 있으면 추측할 필요가 없다.
      if (entry.type === 'transport') {
        const transport = entry as RTCStats & { selectedCandidatePairId?: string };
        if (transport.selectedCandidatePairId) {
          selectedPairId = transport.selectedCandidatePairId;
        }
      }
      if (entry.type === 'candidate-pair') {
        const candidatePair = entry as RTCIceCandidatePairStats;
        // `nominated`가 지금 쓰이는 쌍이다. Firefox는 실패한 쌍도 `succeeded`로
        // 남겨 두므로 둘 다 본다. transport가 짚어 주지 않을 때의 차선이다.
        if (candidatePair.state === 'succeeded' && candidatePair.nominated) {
          pair = candidatePair;
        }
      }
    });

    // ⚠️ **ICE restart를 하면 지명된 쌍이 여럿 남는다.** 실기기에서 잰 판에서는
    // `succeeded && nominated`가 셋이었고 그중 바이트가 느는 것은 하나뿐이었다. 훑다가
    // 마지막에 걸린 것을 쓰면 멈춘 쌍을 읽어 화면이 `0 kbps`를 그린다 — 비트레이트만이
    // 아니라 RTT·경로까지 같은 쌍에서 나오므로 지표 줄 전체가 낡는다.
    const selected = selectedPairId ? byId.get(selectedPairId) : undefined;
    if (selected && selected.type === 'candidate-pair') {
      pair = selected as RTCIceCandidatePairStats;
    }

    if (pair) {
      if (typeof pair.currentRoundTripTime === 'number') {
        stats.rttMs = Math.round(pair.currentRoundTripTime * 1000);
      }
      stats.local = candidateOf(byId.get(pair.localCandidateId ?? ''));
      stats.remote = candidateOf(byId.get(pair.remoteCandidateId ?? ''));
      stats.path = pathOf(stats.local, stats.remote);

      const now = nowMs(pair.timestamp);
      const sample: Sample = {
        atMs: now,
        pairId: pair.id,
        bytesSent: pair.bytesSent ?? 0,
        bytesReceived: pair.bytesReceived ?? 0,
      };
      const previous = this.previous;
      // 쌍이 바뀐 표본은 **비워 둔다** — 첫 호출과 같은 자리다. 다음 표본부터 새 기준으로
      // 다시 재고, 그동안 화면은 `—`를 그린다(없는 값을 0으로 그리지 않는다는 규칙).
      if (previous && previous.pairId === sample.pairId && sample.atMs > previous.atMs) {
        const seconds = (sample.atMs - previous.atMs) / 1000;
        stats.sendingKbps = kbps(sample.bytesSent - previous.bytesSent, seconds);
        stats.receivingKbps = kbps(
          sample.bytesReceived - previous.bytesReceived,
          seconds,
        );
      }
      this.previous = sample;
    }

    report.forEach((entry) => {
      // DTLS 상태는 전송 계층에 있다 — 후보 쌍이 아니라 transport가 갖는다.
      if (entry.type === 'transport') {
        const transport = entry as RTCStats & { dtlsState?: string };
        if (transport.dtlsState) stats.dtlsState = transport.dtlsState;
      }
      if (entry.type !== 'inbound-rtp') return;
      const inbound = entry as RTCInboundRtpStreamStats;
      if (inbound.kind !== 'video') return;

      if (typeof inbound.jitter === 'number') {
        stats.jitterMs = Math.round(inbound.jitter * 1000);
      }
      // 손실률은 받은 것 대비다 — 아직 아무것도 안 받았으면 비율이 성립하지 않는다.
      const lost = inbound.packetsLost ?? 0;
      const received = inbound.packetsReceived ?? 0;
      if (received + lost > 0) {
        stats.packetLossPct =
          Math.round((lost / (received + lost)) * 1000) / 10;
      }
      if (inbound.frameWidth && inbound.frameHeight) {
        stats.video = {
          width: inbound.frameWidth,
          height: inbound.frameHeight,
          fps:
            typeof inbound.framesPerSecond === 'number'
              ? Math.round(inbound.framesPerSecond)
              : undefined,
        };
      }
    });

    return stats;
  }
}

// `RTCIceCandidateStats`는 TS의 DOM 라이브러리에 없다(브라우저에는 있다). 우리가
// 읽는 두 필드만 적어 둔다 — **주소 필드는 일부러 적지 않는다**(§7).
interface CandidateStats extends RTCStats {
  candidateType?: string;
  protocol?: string;
}

function candidateOf(entry: RTCStats | undefined): CandidateInfo | undefined {
  if (!entry) return undefined;
  const candidate = entry as CandidateStats;
  if (!candidate.candidateType) return undefined;
  return { type: candidate.candidateType, protocol: candidate.protocol };
}

// 리포트의 timestamp는 DOMHighResTimeStamp다. 없으면 우리 시계로 대신한다 —
// 간격만 쓰므로 기준점이 어디든 상관없다.
function nowMs(timestamp: number | undefined): number {
  return typeof timestamp === 'number' ? timestamp : performance.now();
}

function kbps(deltaBytes: number, seconds: number): number | undefined {
  if (deltaBytes < 0 || seconds <= 0) return undefined;
  return Math.round((deltaBytes * 8) / seconds / 1000);
}
