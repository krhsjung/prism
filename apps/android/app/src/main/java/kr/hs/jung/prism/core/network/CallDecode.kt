package kr.hs.jung.prism.core.network

import kr.hs.jung.prism.domain.model.CallClientMessage
import kr.hs.jung.prism.domain.model.CallEndReason
import kr.hs.jung.prism.domain.model.CallErrorCode
import kr.hs.jung.prism.domain.model.CallServerMessage
import kr.hs.jung.prism.domain.model.DeviceKind
import kr.hs.jung.prism.domain.model.IceCandidatePayload
import kr.hs.jung.prism.domain.model.IceServer
import kr.hs.jung.prism.domain.model.MAX_ICE_CANDIDATE_LENGTH
import kr.hs.jung.prism.domain.model.MAX_SDP_LENGTH
import kr.hs.jung.prism.domain.model.MAX_SDP_MID_LENGTH
import kr.hs.jung.prism.domain.model.SessionRef
import org.json.JSONArray
import org.json.JSONObject

// 통화 메시지의 경계 디코딩(parse, don't validate) — [Decode.kt]와 같은 철학이다.
// 형식이 어긋나면 던지고, 화면 코드는 완성된 타입만 본다.

private fun JSONObject.str(key: String): String {
    val value = opt(key)
    if (value !is String || value.isBlank()) throw ApiError.invalidResponse
    return value
}

/**
 * 상한은 **받는 쪽에서도** 본다.
 *
 * 서버가 이미 검사하지만, 경계에서 한 번 더 보는 것이 이 앱이 다른 서버를 보게 되는 날의
 * 유일한 방어다. 서버는 SDP를 해석하지 않으므로 길이와 형식이 여기서 볼 수 있는 전부다.
 */
private fun JSONObject.bounded(key: String, limit: Int): String {
    val value = str(key)
    if (value.length > limit) throw ApiError.invalidResponse
    return value
}

private fun decodeSessionRef(json: JSONObject): SessionRef =
    SessionRef(
        id = json.str("id"),
        // 기기 종류는 화면 라벨이라 모르는 값을 UNKNOWN으로 접는다(DeviceKind.from).
        device = DeviceKind.from(json.opt("device") as? String),
    )

private fun decodeIceServer(json: JSONObject): IceServer {
    val urls = json.optJSONArray("urls") ?: throw ApiError.invalidResponse
    val list = buildList {
        for (i in 0 until urls.length()) {
            val url = urls.opt(i)
            if (url !is String || url.isBlank()) throw ApiError.invalidResponse
            add(url)
        }
    }
    if (list.isEmpty()) throw ApiError.invalidResponse
    return IceServer(
        urls = list,
        username = json.opt("username") as? String,
        credential = json.opt("credential") as? String,
    )
}

private fun decodeIceServers(array: JSONArray?): List<IceServer> {
    if (array == null) throw ApiError.invalidResponse
    return buildList {
        for (i in 0 until array.length()) {
            add(decodeIceServer(array.optJSONObject(i) ?: throw ApiError.invalidResponse))
        }
    }
}

private fun decodeCandidate(json: JSONObject): IceCandidatePayload {
    val candidate = json.optJSONObject("candidate") ?: throw ApiError.invalidResponse
    val line = candidate.bounded("candidate", MAX_ICE_CANDIDATE_LENGTH)
    val mid = candidate.opt("sdpMid") as? String
    if (mid != null && mid.length > MAX_SDP_MID_LENGTH) throw ApiError.invalidResponse
    val index = candidate.opt("sdpMLineIndex")
    return IceCandidatePayload(
        candidate = line,
        sdpMid = mid,
        sdpMLineIndex = (index as? Number)?.toInt(),
    )
}

/**
 * 통화 메시지 하나. **모르는 타입은 접지 않고 던진다** — 이것은 화면 라벨이 아니라
 * 동작이라, 아무 갈래로 접으면 하지 말아야 할 일을 한다.
 */
fun decodeCallServerMessage(json: JSONObject): CallServerMessage {
    fun callId() = json.str("callId")
    return when (json.opt("type")) {
        "incoming" -> CallServerMessage.Incoming(
            callId(),
            decodeSessionRef(json.optJSONObject("from") ?: throw ApiError.invalidResponse),
        )
        "ringing" -> CallServerMessage.Ringing(callId())
        "notified" -> CallServerMessage.Notified(callId())
        "accepted" -> CallServerMessage.Accepted(
            callId(),
            decodeIceServers(json.optJSONArray("iceServers")),
        )
        "claimed" -> CallServerMessage.Claimed(callId())
        "declined" -> CallServerMessage.Declined(callId())
        "offer" -> CallServerMessage.Offer(callId(), json.bounded("sdp", MAX_SDP_LENGTH))
        "answer" -> CallServerMessage.Answer(callId(), json.bounded("sdp", MAX_SDP_LENGTH))
        "ice" -> CallServerMessage.Ice(callId(), decodeCandidate(json))
        "ended" -> CallServerMessage.Ended(
            callId(),
            CallEndReason.from(json.opt("reason") as? String) ?: throw ApiError.invalidResponse,
        )
        // from은 **없을 수 있다** — 서버가 그 통화를 더는 기억하지 못하거나 애초에 내
        // 통화가 아니었으면 기기 종류를 지어내지 않는다.
        "expired" -> CallServerMessage.Expired(
            callId(),
            json.optJSONObject("from")?.let(::decodeSessionRef),
        )
        "callError" -> CallServerMessage.Error(
            CallErrorCode.from(json.opt("code") as? String) ?: throw ApiError.invalidResponse,
        )
        else -> throw ApiError.invalidResponse
    }
}

/** 내려온 메시지가 통화 쪽인가. 두 계약은 타입 이름이 겹치지 않아 이 하나로 갈린다. */
fun isCallMessageType(type: String?): Boolean = type in CALL_SERVER_MESSAGE_TYPES

private val CALL_SERVER_MESSAGE_TYPES = setOf(
    "incoming", "ringing", "notified", "accepted", "claimed", "declined", "offer",
    "answer", "ice", "ended", "expired", "callError",
)

/** 클라 → 서버 직렬화. 계약의 모양이 단순해 직렬화기를 세우지 않는다. */
fun encodeCallClientMessage(message: CallClientMessage): String {
    val json = JSONObject()
    when (message) {
        is CallClientMessage.Call -> json.put("type", "call").put("to", message.to)
        is CallClientMessage.Accept -> json.put("type", "accept").put("callId", message.callId)
        is CallClientMessage.Decline -> json.put("type", "decline").put("callId", message.callId)
        is CallClientMessage.Cancel -> json.put("type", "cancel").put("callId", message.callId)
        is CallClientMessage.Hangup -> json.put("type", "hangup").put("callId", message.callId)
        is CallClientMessage.Resume -> json.put("type", "resume").put("callId", message.callId)
        is CallClientMessage.Offer ->
            json.put("type", "offer").put("callId", message.callId).put("sdp", message.sdp)
        is CallClientMessage.Answer ->
            json.put("type", "answer").put("callId", message.callId).put("sdp", message.sdp)
        is CallClientMessage.Ice ->
            json.put("type", "ice").put("callId", message.callId).put(
                "candidate",
                JSONObject()
                    .put("candidate", message.candidate.candidate)
                    .apply {
                        message.candidate.sdpMid?.let { put("sdpMid", it) }
                        message.candidate.sdpMLineIndex?.let { put("sdpMLineIndex", it) }
                    },
            )
    }
    return json.toString()
}
