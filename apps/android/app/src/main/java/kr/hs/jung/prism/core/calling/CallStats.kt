package kr.hs.jung.prism.core.calling

import org.webrtc.PeerConnection
import org.webrtc.RTCStats
import org.webrtc.RTCStatsReport
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/*
 * `getStats()`를 **여섯 지표와 한 경로**로 접는다(웹 `lib/webrtc/stats.ts`와 같은 규칙).
 *
 * KVS 테스트 페이지는 리포트를 그대로 흘리지만(plan/webrtc.md §4), 덤프는 "많이
 * 보여준다"가 아니라 "읽을 수 없다"에 가깝다. 여기서 고르는 것은 통화가 좋은지 나쁜지를
 * 실제로 가르는 값들뿐이다.
 *
 * **없는 값은 0이 아니라 null이다.** 플랫폼마다 리포트의 일부 필드를 주지 않는데,
 * 없는 숫자를 0으로 그리면 화면이 "패킷 손실 0%"라고 **거짓말을 한다**.
 */

/** 미디어가 어떤 경로로 흐르는가. 라벨은 `webrtc_ice_path_*`가 갖는다. */
enum class IcePath { DIRECT, REFLEXIVE, RELAY, LOOPBACK }

/** 후보 한쪽. **주소는 담지 않는다** — 타입과 전송까지만 화면에 낸다(§7). */
data class CandidateInfo(val type: String, val protocol: String?)

data class VideoSize(val width: Int, val height: Int, val fps: Int?)

data class CallStats(
    /** ms */
    val rttMs: Int? = null,
    /** ms */
    val jitterMs: Int? = null,
    /** 0–100 */
    val packetLossPct: Double? = null,
    /** kbps */
    val sendingKbps: Int? = null,
    /** kbps */
    val receivingKbps: Int? = null,
    val video: VideoSize? = null,
    val path: IcePath? = null,
    val local: CandidateInfo? = null,
    val remote: CandidateInfo? = null,
    /** ICE의 진행 단계. 붙는 중인지 되찾는 중인지가 여기서 갈린다. */
    val iceState: String? = null,
    /** DTLS 핸드셰이크. **미디어가 암호화됐다는 증거가 이 한 줄이다.** */
    val dtlsState: String? = null,
)

/** 후보 두 쪽에서 경로를 정한다. 릴레이가 한쪽만 있어도 미디어는 릴레이를 지난다. */
fun icePathOf(local: CandidateInfo?, remote: CandidateInfo?): IcePath? {
    val types = listOfNotNull(local?.type, remote?.type)
    return when {
        types.isEmpty() -> null
        types.contains("relay") -> IcePath.RELAY
        types.contains("srflx") || types.contains("prflx") -> IcePath.REFLEXIVE
        else -> IcePath.DIRECT
    }
}

/**
 * 한 [PeerConnection]의 지표를 되풀이해 읽는다.
 *
 * 비트레이트는 **누적 바이트의 차이**라 표본 하나로는 나오지 않는다 — 첫 호출은
 * `sendingKbps`/`receivingKbps` 없이 돌아오고, 그때 화면은 `—`를 그린다.
 */
class StatsSampler {
    private data class Sample(val atMs: Double, val bytesSent: Double, val bytesReceived: Double)

    private var previous: Sample? = null

    fun reset() {
        previous = null
    }

    fun read(report: RTCStatsReport, iceState: PeerConnection.IceConnectionState?): CallStats {
        val entries = report.statsMap
        var stats = CallStats(iceState = iceState?.name?.lowercase())

        // 리포트는 id로 서로를 가리키는 평평한 맵이다 — 후보 쌍을 먼저 찾고 거기서
        // 양쪽 후보를 되짚는다.
        val pair = entries.values.firstOrNull { entry ->
            entry.type == "candidate-pair" &&
                entry.members["state"] == "succeeded" &&
                // `nominated`가 지금 쓰이는 쌍이다. 실패한 쌍도 `succeeded`로 남을 수
                // 있으므로 둘 다 본다.
                entry.members["nominated"] == true
        }

        if (pair != null) {
            val local = candidate(entries[pair.members["localCandidateId"] as? String])
            val remote = candidate(entries[pair.members["remoteCandidateId"] as? String])
            stats = stats.copy(
                rttMs = (pair.members["currentRoundTripTime"] as? Number)
                    ?.let { (it.toDouble() * 1_000).roundToInt() },
                local = local,
                remote = remote,
                path = icePathOf(local, remote),
            )

            val sample = Sample(
                atMs = pair.timestampUs / 1_000.0,
                bytesSent = (pair.members["bytesSent"] as? Number)?.toDouble() ?: 0.0,
                bytesReceived = (pair.members["bytesReceived"] as? Number)?.toDouble() ?: 0.0,
            )
            val last = previous
            if (last != null && sample.atMs > last.atMs) {
                val seconds = (sample.atMs - last.atMs) / 1_000
                stats = stats.copy(
                    sendingKbps = kbps(sample.bytesSent - last.bytesSent, seconds),
                    receivingKbps = kbps(sample.bytesReceived - last.bytesReceived, seconds),
                )
            }
            previous = sample
        }

        for (entry in entries.values) {
            // DTLS 상태는 전송 계층에 있다 — 후보 쌍이 아니라 transport가 갖는다.
            if (entry.type == "transport") {
                (entry.members["dtlsState"] as? String)?.let { stats = stats.copy(dtlsState = it) }
            }
            if (entry.type != "inbound-rtp") continue
            if (entry.members["kind"] != "video") continue

            (entry.members["jitter"] as? Number)?.let {
                stats = stats.copy(jitterMs = (it.toDouble() * 1_000).roundToInt())
            }
            // 손실률은 받은 것 대비다 — 아직 아무것도 안 받았으면 비율이 성립하지 않는다.
            val lost = (entry.members["packetsLost"] as? Number)?.toDouble() ?: 0.0
            val received = (entry.members["packetsReceived"] as? Number)?.toDouble() ?: 0.0
            if (received + lost > 0) {
                stats = stats.copy(
                    packetLossPct = (lost / (received + lost) * 1_000).roundToLong() / 10.0,
                )
            }
            val width = (entry.members["frameWidth"] as? Number)?.toInt()
            val height = (entry.members["frameHeight"] as? Number)?.toInt()
            if (width != null && height != null) {
                stats = stats.copy(
                    video = VideoSize(
                        width = width,
                        height = height,
                        fps = (entry.members["framesPerSecond"] as? Number)
                            ?.let { it.toDouble().roundToInt() },
                    ),
                )
            }
        }

        return stats
    }

    private fun candidate(entry: RTCStats?): CandidateInfo? {
        // **주소 필드는 일부러 읽지 않는다**(§7) — 담은 것이 곧 새어 나갈 수 있는 것이다.
        val type = entry?.members?.get("candidateType") as? String ?: return null
        return CandidateInfo(type, entry.members["protocol"] as? String)
    }

    private fun kbps(deltaBytes: Double, seconds: Double): Int? {
        if (deltaBytes < 0 || seconds <= 0) return null
        return (deltaBytes * 8 / seconds / 1_000).roundToInt()
    }
}
