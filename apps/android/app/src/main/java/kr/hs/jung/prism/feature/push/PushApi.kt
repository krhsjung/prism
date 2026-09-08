package kr.hs.jung.prism.feature.push

import kr.hs.jung.prism.core.network.ApiClient
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.domain.model.PushActionSet
import kr.hs.jung.prism.domain.model.PushSendResult
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** 보내는 내용. 문구 외에는 **전부 선택이다**(plan/push.md §5-11 ~ §5-13). */
data class PushContent(
    val message: String,
    val imageUrl: String? = null,
    val link: String? = null,
    val actions: PushActionSet = PushActionSet.NONE,
)

/** 대상 하나의 결말. **세션 단위로 답한다** — 화면이 고른 줄 옆에 그대로 그린다. */
data class PushOutcome(val sessionId: String, val result: PushSendResult)

/**
 * 푸시 전송 API.
 *
 * **클라이언트는 "이 세션들에 보내줘"라고만 한다** — 등록 토큰은 서버가 세션 레코드에서
 * 꺼낸다(plan/push.md §5-3). 목록에 토큰이 실리지 않으므로 앱이 그것으로 할 수 있는
 * 일도 없다(전송에는 서버 자격증명이 필요하다).
 */
interface PushApi {
    suspend fun send(
        accessToken: String,
        sessionIds: List<String>,
        content: PushContent,
    ): List<PushOutcome>
}

class HttpPushApi(private val client: ApiClient) : PushApi {
    override suspend fun send(
        accessToken: String,
        sessionIds: List<String>,
        content: PushContent,
    ): List<PushOutcome> {
        val request = JSONObject()
            .put("sessionIds", JSONArray(sessionIds))
            .put("message", content.message)
            .put("actions", content.actions.wire)
            .apply {
                // 빈 값은 키조차 만들지 않는다 — 없는 필드와 빈 문자열은 서버에서 같은
                // 뜻이지만(둘 다 없음), 없는 쪽이 의도가 분명하다.
                content.imageUrl?.takeIf { it.isNotBlank() }?.let { put("imageUrl", it) }
                content.link?.takeIf { it.isNotBlank() }?.let { put("link", it) }
            }

        val body = client.request(
            "POST",
            "/auth/push/send",
            body = request.toString(),
            accessToken = accessToken,
        )
        return try {
            decodeOutcomes(JSONObject(body).getJSONArray("results"))
        } catch (e: JSONException) {
            throw ApiError.invalidResponse
        }
    }

    private fun decodeOutcomes(array: JSONArray): List<PushOutcome> =
        (0 until array.length()).map { i ->
            val item = array.optJSONObject(i) ?: throw ApiError.invalidResponse
            val sessionId = item.opt("sessionId") as? String
            // 계약에 없는 결과를 접으면 화면이 없는 사실을 말하게 된다 — 거부한다.
            val result = PushSendResult.from(item.opt("result") as? String)
            if (sessionId.isNullOrBlank() || result == null) throw ApiError.invalidResponse
            PushOutcome(sessionId, result)
        }
}
