//
//  CallStats.swift
//  prism
//
//  Path: Core/Calling/CallStats.swift
//

import Foundation
import WebRTC

// `getStats()`를 **여섯 지표와 한 경로**로 접는다(웹 `lib/webrtc/stats.ts`와 같은 규칙).
//
// KVS 테스트 페이지는 리포트를 그대로 흘리지만(plan/webrtc.md §4), 덤프는 "많이
// 보여준다"가 아니라 "읽을 수 없다"에 가깝다. 여기서 고르는 것은 통화가 좋은지 나쁜지를
// 실제로 가르는 값들뿐이다.
//
// **없는 값은 0이 아니라 nil이다.** 플랫폼마다 리포트의 일부 필드를 주지 않는데,
// 없는 숫자를 0으로 그리면 화면이 "패킷 손실 0%"라고 **거짓말을 한다**.

/// 미디어가 어떤 경로로 흐르는가. 라벨은 `webrtc.ice_path_*`가 갖는다.
enum IcePath: Sendable {
    case direct
    case reflexive
    case relay
    case loopback
}

/// 후보 한쪽. **주소는 담지 않는다** — 타입과 전송까지만 화면에 낸다(§7).
struct CandidateInfo: Equatable, Sendable {
    let type: String
    let protocolName: String?
}

struct CallStats: Equatable, Sendable {
    /// ms
    var rttMs: Int?
    /// ms
    var jitterMs: Int?
    /// 0–100
    var packetLossPct: Double?
    /// kbps
    var sendingKbps: Int?
    /// kbps
    var receivingKbps: Int?
    var video: VideoSize?
    var path: IcePath?
    var local: CandidateInfo?
    var remote: CandidateInfo?
    /// ICE의 진행 단계. 붙는 중인지 되찾는 중인지가 여기서 갈린다.
    var iceState: String?
    /// DTLS 핸드셰이크. **미디어가 암호화됐다는 증거가 이 한 줄이다.**
    var dtlsState: String?

    struct VideoSize: Equatable, Sendable {
        let width: Int
        let height: Int
        let fps: Int?
    }
}

/// 후보 두 쪽에서 경로를 정한다. 릴레이가 한쪽만 있어도 미디어는 릴레이를 지난다.
func icePath(local: CandidateInfo?, remote: CandidateInfo?) -> IcePath? {
    let types = [local?.type, remote?.type].compactMap { $0 }
    if types.isEmpty { return nil }
    if types.contains("relay") { return .relay }
    if types.contains("srflx") || types.contains("prflx") { return .reflexive }
    return .direct
}

/// 한 `RTCPeerConnection`의 지표를 되풀이해 읽는다.
///
/// 비트레이트는 **누적 바이트의 차이**라 표본 하나로는 나오지 않는다 — 첫 호출은
/// `sendingKbps`/`receivingKbps` 없이 돌아오고, 그때 화면은 `—`를 그린다.
@MainActor
final class StatsSampler {
    /// 이전 표본과의 차이가 있어야 나오는 값(비트레이트)을 위해 표본을 하나 기억한다.
    private struct Sample {
        let atMs: Double
        let bytesSent: Double
        let bytesReceived: Double
    }

    private var previous: Sample?

    func reset() {
        previous = nil
    }

    func read(_ peer: RTCPeerConnection) async -> CallStats {
        let report = await withCheckedContinuation { continuation in
            peer.statistics { continuation.resume(returning: $0) }
        }

        var stats = CallStats()
        stats.iceState = Self.name(of: peer.iceConnectionState)

        let entries = report.statistics
        // 리포트는 id로 서로를 가리키는 평평한 맵이다 — 후보 쌍을 먼저 찾고 거기서
        // 양쪽 후보를 되짚는다.
        let pair = entries.values.first { entry in
            entry.type == "candidate-pair"
                && entry.values["state"] as? String == "succeeded"
                // `nominated`가 지금 쓰이는 쌍이다. 실패한 쌍도 `succeeded`로 남을 수
                // 있으므로 둘 다 본다.
                && (entry.values["nominated"] as? NSNumber)?.boolValue == true
        }

        if let pair {
            if let rtt = pair.values["currentRoundTripTime"] as? NSNumber {
                stats.rttMs = Int((rtt.doubleValue * 1_000).rounded())
            }
            stats.local = Self.candidate(entries[pair.values["localCandidateId"] as? String ?? ""])
            stats.remote = Self.candidate(entries[pair.values["remoteCandidateId"] as? String ?? ""])
            stats.path = icePath(local: stats.local, remote: stats.remote)

            let sample = Sample(
                atMs: pair.timestamp_us / 1_000,
                bytesSent: (pair.values["bytesSent"] as? NSNumber)?.doubleValue ?? 0,
                bytesReceived: (pair.values["bytesReceived"] as? NSNumber)?.doubleValue ?? 0,
            )
            if let previous, sample.atMs > previous.atMs {
                let seconds = (sample.atMs - previous.atMs) / 1_000
                stats.sendingKbps = Self.kbps(sample.bytesSent - previous.bytesSent, seconds)
                stats.receivingKbps = Self.kbps(
                    sample.bytesReceived - previous.bytesReceived,
                    seconds,
                )
            }
            previous = sample
        }

        for entry in entries.values {
            // DTLS 상태는 전송 계층에 있다 — 후보 쌍이 아니라 transport가 갖는다.
            if entry.type == "transport", let state = entry.values["dtlsState"] as? String {
                stats.dtlsState = state
            }
            guard entry.type == "inbound-rtp",
                  entry.values["kind"] as? String == "video"
            else { continue }

            if let jitter = entry.values["jitter"] as? NSNumber {
                stats.jitterMs = Int((jitter.doubleValue * 1_000).rounded())
            }
            // 손실률은 받은 것 대비다 — 아직 아무것도 안 받았으면 비율이 성립하지 않는다.
            let lost = (entry.values["packetsLost"] as? NSNumber)?.doubleValue ?? 0
            let received = (entry.values["packetsReceived"] as? NSNumber)?.doubleValue ?? 0
            if received + lost > 0 {
                stats.packetLossPct = ((lost / (received + lost)) * 1_000).rounded() / 10
            }
            if let width = entry.values["frameWidth"] as? NSNumber,
               let height = entry.values["frameHeight"] as? NSNumber {
                let fps = entry.values["framesPerSecond"] as? NSNumber
                stats.video = CallStats.VideoSize(
                    width: width.intValue,
                    height: height.intValue,
                    fps: fps.map { Int($0.doubleValue.rounded()) },
                )
            }
        }

        return stats
    }

    private static func candidate(_ entry: RTCStatistics?) -> CandidateInfo? {
        guard let type = entry?.values["candidateType"] as? String else { return nil }
        // **주소 필드는 일부러 읽지 않는다**(§7) — 담은 것이 곧 새어 나갈 수 있는 것이다.
        return CandidateInfo(type: type, protocolName: entry?.values["protocol"] as? String)
    }

    private static func kbps(_ deltaBytes: Double, _ seconds: Double) -> Int? {
        guard deltaBytes >= 0, seconds > 0 else { return nil }
        return Int(((deltaBytes * 8) / seconds / 1_000).rounded())
    }

    /// 계약의 문자열과 같은 이름으로 적는다 — 진단은 웹·Android와 같은 값을 보여야 한다.
    private static func name(of state: RTCIceConnectionState) -> String {
        switch state {
        case .new: "new"
        case .checking: "checking"
        case .connected: "connected"
        case .completed: "completed"
        case .failed: "failed"
        case .disconnected: "disconnected"
        case .closed: "closed"
        case .count: "count"
        @unknown default: "unknown"
        }
    }
}
