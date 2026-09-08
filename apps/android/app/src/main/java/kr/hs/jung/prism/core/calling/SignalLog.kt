package kr.hs.jung.prism.core.calling

import kr.hs.jung.prism.domain.model.CallClientMessage
import kr.hs.jung.prism.domain.model.CallServerMessage
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/*
 * 시그널링 로그 — **원소는 §6 계약의 메시지 그대로다**(웹 `lib/webrtc/signal-log.ts`).
 *
 * 로그를 위한 이벤트를 새로 만들지 않는다: 만드는 순간 계약이 두 벌이 되고, 화면이
 * 서버에 없는 것을 약속하게 된다.
 *
 * 레벨(DEBUG/INFO/WARN/ERROR)을 두지 않고 **방향**으로 가르는 것도 결정이다. 원소가
 * 열 몇 가지뿐이라 네 레벨로 나누면 필터 UI가 원소 수보다 커지고, 시그널링에서 실제로
 * 헷갈리는 축은 "누가 offer를 냈나" 곧 방향이다(plan/webrtc.md §4).
 *
 * ⚠️ **본문은 담지 않는다.** SDP와 후보 문자열은 종류와 크기까지만 적는다(§7) —
 * 로그는 사용자가 `Copy log`로 통째로 붙여넣는 물건이라, 담은 것이 곧 새어 나갈 수
 * 있는 것이다.
 */

/** 화면에 남기는 줄 수. 통화 하나의 시그널링은 수십 줄이라 넉넉하다. */
const val SIGNAL_LOG_LIMIT = 200

enum class SignalDirection { SENT, RECEIVED }

data class SignalLogEntry(
    /** 목록 key. 같은 밀리초에 두 줄이 생겨도 갈린다. */
    val id: Int,
    val atMs: Long,
    val direction: SignalDirection,
    val type: String,
    /** 오류 줄만 색을 쓴다(§4). */
    val isError: Boolean,
    /** 크기·코드처럼 본문이 아닌 것. */
    val detail: String?,
)

object SignalLog {
    private val nextId = AtomicInteger(0)

    fun entry(
        direction: SignalDirection,
        type: String,
        detail: String?,
        isError: Boolean,
        atMs: Long = System.currentTimeMillis(),
    ): SignalLogEntry = SignalLogEntry(
        id = nextId.getAndIncrement(),
        atMs = atMs,
        direction = direction,
        type = type,
        isError = isError,
        detail = detail,
    )

    /** 상한을 넘으면 **오래된 쪽부터** 버린다 — 지금 무슨 일이 나는지가 늘 아래에 있다. */
    fun append(entries: List<SignalLogEntry>, entry: SignalLogEntry): List<SignalLogEntry> {
        val next = entries + entry
        return if (next.size > SIGNAL_LOG_LIMIT) next.takeLast(SIGNAL_LOG_LIMIT) else next
    }

    /** `Copy log`가 붙여넣는 텍스트. 사용자가 누를 때만 만들어지고 자동 전송은 없다(§7). */
    fun format(entries: List<SignalLogEntry>): String = entries.joinToString("\n") { entry ->
        val arrow = if (entry.direction == SignalDirection.SENT) "→" else "←"
        val detail = entry.detail?.let { " $it" } ?: ""
        "${stamp(entry.atMs, compact = false)} $arrow ${entry.type}$detail"
    }

    /**
     * 375에서는 밀리초를 뺀다(시안 `Atom/LogLine` `Compact=Yes`) — 초 단위로도 순서와
     * 간격은 읽힌다.
     */
    fun stamp(atMs: Long, compact: Boolean): String {
        val seconds = atMs / 1_000
        val clock = String.format(
            Locale.US,
            "%02d:%02d:%02d",
            (seconds / 3_600) % 24,
            (seconds / 60) % 60,
            seconds % 60,
        )
        return if (compact) clock else clock + String.format(Locale.US, ".%03d", atMs % 1_000)
    }

    /*
     * 바이트로 적는 이유: SDP는 UTF-8에서 문자 수와 바이트 수가 갈리고, 계약의 상한도
     * 문자 기준이라 둘을 섞으면 "상한에 걸렸는데 화면은 여유가 있다고 말하는" 상태가 된다.
     */
    fun byteSize(value: String): String {
        val bytes = value.toByteArray(Charsets.UTF_8).size
        return if (bytes < 1_024) {
            "$bytes B"
        } else {
            String.format(Locale.US, "%.1f kB", bytes / 1_024.0)
        }
    }
}

// ── 계약의 메시지 → 로그 한 줄 ──────────────────────────────────────────────

val CallClientMessage.logType: String
    get() = when (this) {
        is CallClientMessage.Call -> "call"
        is CallClientMessage.Accept -> "accept"
        is CallClientMessage.Decline -> "decline"
        is CallClientMessage.Cancel -> "cancel"
        is CallClientMessage.Offer -> "offer"
        is CallClientMessage.Answer -> "answer"
        is CallClientMessage.Ice -> "ice"
        is CallClientMessage.Hangup -> "hangup"
        is CallClientMessage.Resume -> "resume"
    }

val CallClientMessage.logDetail: String?
    get() = when (this) {
        is CallClientMessage.Call -> "#${to.take(8)}"
        is CallClientMessage.Offer -> SignalLog.byteSize(sdp)
        is CallClientMessage.Answer -> SignalLog.byteSize(sdp)
        is CallClientMessage.Ice -> SignalLog.byteSize(candidate.candidate)
        else -> null
    }

val CallServerMessage.logType: String
    get() = when (this) {
        is CallServerMessage.Incoming -> "incoming"
        is CallServerMessage.Ringing -> "ringing"
        is CallServerMessage.Notified -> "notified"
        is CallServerMessage.Accepted -> "accepted"
        is CallServerMessage.Claimed -> "claimed"
        is CallServerMessage.Declined -> "declined"
        is CallServerMessage.Offer -> "offer"
        is CallServerMessage.Answer -> "answer"
        is CallServerMessage.Ice -> "ice"
        is CallServerMessage.Ended -> "ended"
        is CallServerMessage.Expired -> "expired"
        is CallServerMessage.Error -> "callError"
    }

val CallServerMessage.logDetail: String?
    get() = when (this) {
        is CallServerMessage.Offer -> SignalLog.byteSize(sdp)
        is CallServerMessage.Answer -> SignalLog.byteSize(sdp)
        is CallServerMessage.Ice -> SignalLog.byteSize(candidate.candidate)
        is CallServerMessage.Ended -> reason.wire
        is CallServerMessage.Error -> code.wire
        is CallServerMessage.Accepted -> "ice ${iceServers.size}"
        else -> null
    }

val CallServerMessage.isLogError: Boolean
    get() = this is CallServerMessage.Error
