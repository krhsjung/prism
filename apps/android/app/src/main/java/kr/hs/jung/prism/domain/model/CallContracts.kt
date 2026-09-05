package kr.hs.jung.prism.domain.model

/*
 * 통화 시그널링 계약(서버: apps/server/libs/common/src/types/contracts.ts §통화).
 *
 * presence와 **같은 소켓**을 쓰지만 계약은 갈라져 있다. presence가 클라 → 서버 방향을
 * 두지 않았던 이유(살아 있다는 주장을 믿으면 반쯤 죽은 소켓이 계속 Active로 남는다)는
 * 그대로 유효하고, 여기 메시지들은 그 주장을 하지 않는다.
 *
 * **미디어는 이 소켓을 지나지 않는다.** 서버가 나르는 것은 상대를 찾는 신호와 SDP·ICE
 * 문자열뿐이고, 연결이 서면 그 뒤로는 P2P다. 녹화도 저장도 없다.
 */

/**
 * 벨의 상한. **서버 상수이고 클라이언트는 재지 않는다** — 양쪽이 재면 시계가 두 벌이
 * 되고 언젠가 어긋난다. 지나면 서버가 양쪽에 `Ended(TIMEOUT)`을 보낸다.
 */
const val RING_TIMEOUT_MS = 45_000L

/**
 * 릴레이가 나르는 문자열의 상한. 서버는 SDP를 해석하지 않으므로 길이와 형식이 경계에서
 * 볼 수 있는 전부다 — 상한이 없으면 소켓이 임의 크기 릴레이가 된다.
 */
const val MAX_SDP_LENGTH = 16_384
const val MAX_ICE_CANDIDATE_LENGTH = 1_024
const val MAX_SDP_MID_LENGTH = 64

/**
 * 클라이언트가 `PeerConnection`에 그대로 넘기는 ICE 서버 하나.
 *
 * 목록은 [CallServerMessage.Accepted]와 함께 소켓이 내려준다 — 값은 전부 env에서 오고
 * 앱에는 호스트도 자격증명도 없다. 화면에도 띄우지 않는다(plan/webrtc.md §7).
 */
data class IceServer(
    val urls: List<String>,
    /** TURN에만 있다. STUN은 자격증명을 쓰지 않는다. */
    val username: String? = null,
    val credential: String? = null,
)

/**
 * 상대를 가리키는 값은 **기기 종류뿐**이다 — 화면이 필요로 하는 전부이고, 그 이상은
 * 담지 않는다([SessionInfo]가 User-Agent 원문도 IP도 담지 않는 것과 같은 선).
 */
data class SessionRef(val id: String, val device: DeviceKind)

/**
 * 후보 하나. 웹의 `RTCIceCandidateInit`을 그대로 옮긴 모양이다.
 *
 * **후보 문자열만으로는 붙일 수 없다** — `addIceCandidate`는 sdpMid와 sdpMLineIndex가
 * 둘 다 없으면 거부한다. 서버는 릴레이라 어느 쪽인지 고르지 않고 온 것을 그대로 넘긴다.
 */
data class IceCandidatePayload(
    val candidate: String,
    val sdpMid: String? = null,
    val sdpMLineIndex: Int? = null,
)

/**
 * 통화가 끝난 이유. **통화의 성질이지 받는 사람의 사정이 아니다** — 같은 문장이 양쪽에
 * 그대로 참이어야 벨을 함께 받았던 다른 기기에도 같은 메시지를 보낼 수 있다.
 */
enum class CallEndReason(val wire: String) {
    /** 사람이 끊었다(거는 쪽의 취소 · 어느 쪽의 종료). */
    HANGUP("hangup"),

    /** 당사자의 소켓이 사라졌다. */
    PEER_GONE("peer-gone"),

    /** [RING_TIMEOUT_MS]가 지났다. */
    TIMEOUT("timeout"),
    ;

    companion object {
        fun from(wire: String?): CallEndReason? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * 통화를 시작할 수 없는 이유.
 *
 * **없는 세션과 남의 세션을 구별해 주지 않는다**([UNKNOWN_SESSION] 하나로 접는다) —
 * 남의 세션 id를 넣어 존재를 떠보는 경로를 열지 않기 위해서다.
 */
enum class CallErrorCode(val wire: String) {
    UNREACHABLE("unreachable"),
    BUSY("busy"),
    UNKNOWN_SESSION("unknown-session"),
    SELF("self"),
    ;

    companion object {
        fun from(wire: String?): CallErrorCode? = entries.firstOrNull { it.wire == wire }
    }
}

/** 서버 → 클라(presence 메시지와 **같은 소켓**으로 내려온다). */
sealed interface CallServerMessage {
    /** 받는 쪽에 벨. 그 세션의 **모든** 연결에 간다 — 사용자가 어느 화면에 있는지 모른다. */
    data class Incoming(val callId: String, val from: SessionRef) : CallServerMessage

    /** 거는 쪽 — 상대에게 전달됐다. */
    data class Ringing(val callId: String) : CallServerMessage

    /**
     * 양쪽에 간다. **이것을 받은 거는 쪽이 offer를 낸다** — 역할이 방향에서 나오므로
     * glare가 구조적으로 없다.
     */
    data class Accepted(val callId: String, val iceServers: List<IceServer>) : CallServerMessage

    /**
     * 벨을 **함께 받았지만 지지 않은** 연결에 간다 — 다른 기기가 먼저 받았다.
     *
     * 이것이 없으면 그 창들이 통화 내내 벨을 붙들고 있다([Accepted]는 창구에만 가고
     * [Ended]는 통화가 끝나야 온다). **끝이 아니라 "내 차례가 아니었다"라서** 알림도
     * 남기지 않는다 — 다른 기기에서 받은 전화가 조용히 사라지는 것과 같다.
     */
    data class Claimed(val callId: String) : CallServerMessage

    data class Declined(val callId: String) : CallServerMessage

    data class Offer(val callId: String, val sdp: String) : CallServerMessage

    data class Answer(val callId: String, val sdp: String) : CallServerMessage

    data class Ice(val callId: String, val candidate: IceCandidatePayload) : CallServerMessage

    data class Ended(val callId: String, val reason: CallEndReason) : CallServerMessage

    /**
     * 알림을 늦게 열었다. [from]은 **없을 수 있다** — 서버가 그 통화를 더는 기억하지
     * 못하거나 애초에 내 통화가 아니었으면 기기 종류를 지어내지 않는다.
     */
    data class Expired(val callId: String, val from: SessionRef?) : CallServerMessage

    data class Error(val code: CallErrorCode) : CallServerMessage
}

/** 클라 → 서버. **callId는 담아도 발급하지는 않는다** — 서버가 준 것을 되돌려줄 뿐이다. */
sealed interface CallClientMessage {
    /** 대상 세션 id. 내 세션이 아니면 서버가 [CallErrorCode.UNKNOWN_SESSION]으로 거절한다. */
    data class Call(val to: String) : CallClientMessage

    data class Accept(val callId: String) : CallClientMessage

    data class Decline(val callId: String) : CallClientMessage

    /** 거는 쪽이 벨을 접는다. 붙은 뒤로는 [Hangup]의 자리다. */
    data class Cancel(val callId: String) : CallClientMessage

    data class Offer(val callId: String, val sdp: String) : CallClientMessage

    data class Answer(val callId: String, val sdp: String) : CallClientMessage

    data class Ice(val callId: String, val candidate: IceCandidatePayload) : CallClientMessage

    data class Hangup(val callId: String) : CallClientMessage

    /** 알림으로 열었다 — 이 통화가 아직 살아 있나. 소켓이 붙자마자 묻는다. */
    data class Resume(val callId: String) : CallClientMessage
}
