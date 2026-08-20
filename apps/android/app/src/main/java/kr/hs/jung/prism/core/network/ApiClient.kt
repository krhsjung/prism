package kr.hs.jung.prism.core.network

import kr.hs.jung.prism.BuildConfig
import kr.hs.jung.prism.core.util.AppLog
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * HTTP 호출 한 겹.
 *
 * 인증은 **Bearer 토큰**으로만 오간다: 로그인 응답의 토큰을 안전 저장소에 담고, 이후
 * 요청에 `Authorization: Bearer`로 실어 보낸다. **쿠키는 쓰지 않는다**(OkHttp 기본
 * `CookieJar.NO_COOKIES`) — 서버 웹 흐름이 심는 세션 쿠키가 자동 저장·전송되면 네이티브가
 * Bearer 없이도 "어쩌다" 인증되는, Keystore를 우회하는 경로가 생기기 때문이다(iOS
 * NetworkManager와 같은 이유, plan/auth.md §6).
 *
 * OkHttp의 enqueue(콜백)를 코루틴으로 감싸, 취소되면 요청도 취소되게 한다.
 */
class ApiClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()

    /**
     * 요청을 보내고 성공 응답 body를 문자열로 돌려준다(2xx가 아니면 [ApiError]).
     *
     * [accessToken]이 있으면 `Authorization: Bearer`로 실어 보낸다 — 세션의 인증 경로다.
     * 없으면 인증 없이 보낸다(로그인·데모 발급 등 토큰 이전 단계).
     */
    suspend fun request(
        method: String,
        path: String,
        body: String? = null,
        accessToken: String? = null,
    ): String {
        val requestBody: RequestBody? = when {
            body != null -> body.toRequestBody(JSON)
            // POST는 body가 없어도 빈 본문을 명시해야 한다(GET엔 body를 달지 않는다).
            method == "POST" -> ByteArray(0).toRequestBody(null)
            else -> null
        }
        val request = Request.Builder()
            .url(BuildConfig.PRISM_API_URL + path)
            .method(method, requestBody)
            .apply { if (accessToken != null) header("Authorization", "Bearer $accessToken") }
            .build()

        AppLog.d("$method $path")
        val response = client.newCall(request).await()
        response.use {
            val text = it.body?.string().orEmpty()
            if (it.isSuccessful) return text
            val code = decodeErrorCode(text) ?: default(it.code)
            AppLog.d("HTTP ${it.code} — $code")
            throw ApiError(it.code, code)
        }
    }

    /** body를 쓰지 않는 요청(예: 204 로그아웃). */
    suspend fun requestIgnoringBody(
        method: String,
        path: String,
        accessToken: String? = null,
    ) {
        request(method, path, accessToken = accessToken)
    }

    private fun default(status: Int): String =
        // 프록시·게이트웨이가 만든, 계약 코드 없는 오류 응답. 상태 코드만으로도 화면은
        // 일반 메시지를 그릴 수 있다.
        kr.hs.jung.prism.domain.model.ClientErrorCode.REQUEST_FAILED

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
        const val CONNECT_TIMEOUT_SECONDS = 10L
        const val READ_TIMEOUT_SECONDS = 10L
        const val CALL_TIMEOUT_SECONDS = 30L
    }
}

// OkHttp Call → 코루틴. 코루틴이 취소되면 진행 중인 요청도 취소한다.
private suspend fun Call.await(): okhttp3.Response =
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(object : okhttp3.Callback {
            override fun onResponse(call: Call, response: okhttp3.Response) {
                // 응답이 도착했지만 그사이 코루틴이 취소됐다면, 재개해도 호출부의 `use`에
                // 닿지 못해 body가 닫히지 않는다(커넥션 누수). onCancellation에서 닫는다.
                continuation.resume(response) { _, _, _ -> response.close() }
            }

            override fun onFailure(call: Call, e: IOException) {
                // 오프라인·타임아웃·DNS 실패를 하나로 묶는다(사용자가 할 수 있는 일이 같다).
                if (continuation.isCancelled) return
                continuation.resumeWithException(ApiError.network)
            }
        })
    }
