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
 * 401을 만난 요청을 위해 세션을 한 번 갱신해 주는 것.
 *
 * [ApiClient]가 [AuthManager][kr.hs.jung.prism.feature.auth.AuthManager]를 직접 알면
 * 고리가 된다(ApiClient → AuthApi → AuthManager → ApiClient). 그래서 좁은 구멍 하나만
 * 두고, 조립하는 곳에서 **만든 뒤에** 꽂는다.
 */
fun interface SessionRefresher {
    /**
     * @param usedAccessToken 401을 받은 그 토큰. 이미 다른 요청이 갱신했는지 가리는 데 쓴다.
     * @return 재시도에 쓸 새 액세스 토큰. 갱신하지 못했으면 null.
     */
    suspend fun refresh(usedAccessToken: String): String?
}

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
class ApiClient(
    /**
     * 이 앱이 자기를 소개하는 문자열. 기본값(`okhttp/4.x`)으로는 서버가 기기 종류를
     * 알아볼 수 없어 세션 목록에 "알 수 없는 기기"로만 뜬다.
     *
     * 브라우저와 **같은 토큰**을 쓴다(`Android` + 폰이면 `Mobile`) — 서버가 UA 하나를
     * 네 갈래로 접는 규칙 하나만 갖게 하려는 것이다(plan/dashboard.md §5). 서버는 이
     * 문자열을 저장하지 않고 접은 결과만 남긴다.
     */
    private val userAgent: String = "Prism (Android; Mobile)",
    /** 서버 주소. 테스트가 가짜 서버를 꽂을 수 있도록 열어 둔다. */
    private val baseUrl: String = BuildConfig.PRISM_API_URL,
) {
    /**
     * 만료된 세션을 되살릴 방법. 조립하는 곳에서 꽂는다([SessionRefresher] 참고).
     * 꽂히지 않았으면 401은 그대로 올라간다 — 로그인 이전 단계에서는 갱신할 것도 없다.
     */
    var sessionRefresher: SessionRefresher? = null

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
        /**
         * 만료된 세션을 갱신하고 **한 번** 다시 보낼지. 인증 자신의 호출(`/auth/me`·
         * `/auth/logout`)만 끈다 — 갱신 정책은 AuthManager의 것이고, 그쪽은 이미 락을 쥔
         * 채로 이 호출을 하므로 여기서 갱신을 부르면 그 락에서 교착한다.
         */
        retryOnExpiredSession: Boolean = true,
    ): String {
        try {
            return send(method, path, body, accessToken)
        } catch (e: ApiError) {
            // 갱신하면 살아나는 401인지는 **서버만** 안다 — 코드로 받아 본다. 토큰 없이
            // 보낸 요청(로그인·갱신 자체)은 되살릴 세션이 없으므로 그대로 올린다.
            if (!retryOnExpiredSession || accessToken == null || !e.isSessionExpired) throw e
            val rotated = sessionRefresher?.refresh(accessToken) ?: throw e
            AppLog.d("session rotated — retrying $method $path once")
            return send(method, path, body, rotated)
        }
    }

    /** 한 번 보낸다. 재시도는 [request]가 정하고 여기서는 하지 않는다. */
    private suspend fun send(
        method: String,
        path: String,
        body: String?,
        accessToken: String?,
    ): String {
        val requestBody: RequestBody? = when {
            body != null -> body.toRequestBody(JSON)
            // POST는 body가 없어도 빈 본문을 명시해야 한다(GET엔 body를 달지 않는다).
            method == "POST" -> ByteArray(0).toRequestBody(null)
            else -> null
        }
        val request = Request.Builder()
            .url(baseUrl + path)
            .method(method, requestBody)
            .header("User-Agent", userAgent)
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
        retryOnExpiredSession: Boolean = true,
    ) {
        request(
            method,
            path,
            accessToken = accessToken,
            retryOnExpiredSession = retryOnExpiredSession,
        )
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
