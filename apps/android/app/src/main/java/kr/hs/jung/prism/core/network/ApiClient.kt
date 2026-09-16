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
 * 401을 만난 요청의 뒷일을 맡는 것 — 세션의 주인.
 *
 * [ApiClient]가 [AuthManager][kr.hs.jung.prism.feature.auth.AuthManager]를 직접 알면
 * 고리가 된다(ApiClient → AuthApi → AuthManager → ApiClient). 그래서 좁은 구멍 하나만
 * 두고, 조립하는 곳에서 **만든 뒤에** 꽂는다.
 */
interface SessionAuthority {
    /**
     * **이 토큰으로** 나가는 요청에 찍을 세션 표식. 지금 세션의 토큰이 아니면 null.
     *
     * 요청을 **보내기 전에** 받아 두었다가 401의 뒷일을 맡길 때 함께 준다. 토큰만으로는
     * 부족하다: 토큰이 갈린 것이 "같은 세션의 회전"인지 "로그아웃 뒤 새 로그인"인지
     * 구분하지 못해, 옛 요청이 새 세션 위에서 재생되거나 새 세션을 끊을 수 있다.
     *
     * 토큰을 함께 받는 이유도 같다. 부르는 쪽이 토큰을 읽은 뒤 여기 오기까지 사이에
     * 세션이 갈릴 수 있어, 표식만 새로 찍으면 **옛 토큰이 새 세션의 이름표를 달고** 나간다.
     */
    fun sessionMark(usedAccessToken: String): Long?

    /**
     * 액세스 토큰이 곧 만료되는가 — 요청을 **보내기 전에** 회전할지 가른다.
     *
     * 타이머로 미리 돌지 않는 이유는 idle 타임아웃 때문이다: 요청이 없는 동안에도
     * 세션을 밀면 화면만 열어두면 세션이 영영 살아 있게 된다. 요청이 있을 때만 보면
     * 유휴 상태의 트래픽이 0이면서도 만료된 요청의 왕복을 아낀다.
     */
    fun isNearExpiry(): Boolean

    /**
     * 만료된 세션을 갱신한다.
     *
     * @param mark 요청을 보낼 때의 세션 표식. 그사이 세션이 갈렸으면 아무것도 하지 않는다.
     * @return 재시도에 쓸 새 액세스 토큰. 갱신하지 못했으면 null.
     */
    suspend fun refreshForRetry(mark: Long, usedAccessToken: String): String?

    /**
     * 서버가 **확정한** 인증 실패(폐기·변조)를 알린다 — 갱신으로는 살아나지 않는다.
     *
     * 다른 기기에서 이 세션을 해제하면 여기로 온다. 화면이 "불러오지 못했습니다"를 띄우고
     * 마는 대신, 세션의 주인이 자격증명을 지우고 로그인 화면으로 보낸다.
     *
     * @param mark 요청을 보낼 때의 세션 표식. 그사이 새 세션이 들어왔다면 낡은 응답이
     *   그것을 끊어서는 안 되므로 아무것도 하지 않는다.
     */
    suspend fun endSession(mark: Long, usedAccessToken: String)
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
/**
 * 이 요청을 **사용자가 시켰다**는 표시(서버의 ACTIVITY_HEADER).
 *
 * 서버는 이 표시가 붙은 요청에만 세션의 유휴 창을 민다 — 없으면 밀지 않는다
 * (plan/auth.md §6). 소켓이 시킨 재조회만 표시를 달지 않는다.
 */
const val ACTIVITY_HEADER = "X-Prism-Activity"

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
     * 화면이 지금 쓰고 있는 언어. **함수인 이유는 값이 바뀌기 때문이다** —
     * 언어 스위처로 고르면 다음 요청부터 새 값이 실려야 한다.
     *
     * 기본값은 컨테이너가 꽂기 전(테스트·초기화 중)의 안전한 값이다.
     */
    var languageTag: () -> String = { "en" }

    /**
     * 401의 뒷일을 맡을 것. 조립하는 곳에서 꽂는다([SessionAuthority] 참고).
     * 꽂히지 않았으면 401은 그대로 올라간다 — 로그인 이전 단계에는 세션이 없다.
     */
    var sessionAuthority: SessionAuthority? = null

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
         * 401의 뒷일(갱신·세션 종료)을 전송 계층이 맡을지. 인증 자신의 호출(`/auth/me`·
         * `/auth/logout`)만 끈다 — 그 결정은 AuthManager의 것이고, 그쪽은 이미 락을 쥔
         * 채로 이 호출을 하므로 여기서 부르면 그 락에서 교착한다.
         */
        recoverSession: Boolean = true,
        /**
         * 이 요청이 **서버가 밀어 준 신호 때문에** 나가는가(소켓의 `sessionsChanged`).
         *
         * 서버는 이 표시가 없는 인증 요청을 **활동**으로 보고 세션의 유휴 창을 민다.
         * 소켓 신호로 목록을 다시 가져오는 그 요청 하나만 표시를 단다(plan/auth.md §6).
         */
        background: Boolean = false,
    ): String {
        // 요청이 **어느 세션의 것인지** 지금 붙잡아 둔다. 응답이 돌아왔을 때는 그사이
        // 로그아웃·재로그인이 끝나 있을 수 있고, 그때 옛 응답으로 새 세션을 건드리면
        // 남의 계정에 옛 요청을 재생하거나 멀쩡한 세션을 끊게 된다.
        val authority = sessionAuthority
        val mark = if (recoverSession && accessToken != null) {
            authority?.sessionMark(accessToken)
        } else {
            null
        }
        // 만료가 임박했으면 **보내기 전에** 회전한다. 반응형 경로와 같은 문을 쓰므로
        // 그사이 다른 요청이 이미 회전시켰다면 여기서는 아무 요청도 나가지 않는다.
        //
        // 실패해도 그대로 보낸다 — 정말 만료였다면 아래 catch가 받아 낸다.
        // 여기는 정확성이 아니라 최적화다.
        var token = accessToken
        if (authority != null && mark != null && token != null && authority.isNearExpiry()) {
            token = authority.refreshForRetry(mark, token) ?: token
        }
        try {
            return send(method, path, body, token, background)
        } catch (e: ApiError) {
            // 토큰 없이 보낸 요청(로그인·갱신 자체)은 되살릴 세션이 없다.
            // ⚠️ 여기서 보는 것은 **실제로 보낸** 토큰이다 — 위에서 선제 회전이 돌았다면
            // 원래 인자와 다르고, 서버가 거부한 것은 보낸 쪽이다.
            if (authority == null || mark == null || token == null) throw e
            // 갱신하면 살아나는 401인지는 **서버만** 안다 — 코드로 받아 본다.
            if (e.isSessionExpired) {
                val rotated = authority.refreshForRetry(mark, token) ?: throw e
                AppLog.d("session rotated — retrying $method $path once")
                return sendOrEndSession(method, path, body, rotated, authority, mark, background)
            }
            if (e.isDefinitiveAuthFailure) authority.endSession(mark, token)
            throw e
        }
    }

    /**
     * 재시도 한 번. 그 응답까지 확정 실패면 세션을 끝낸다 — 방금 회전한 토큰까지 거부됐다면
     * 되살릴 수 있는 세션이 아니다.
     */
    private suspend fun sendOrEndSession(
        method: String,
        path: String,
        body: String?,
        accessToken: String,
        authority: SessionAuthority,
        mark: Long,
        background: Boolean = false,
    ): String {
        try {
            return send(method, path, body, accessToken, background)
        } catch (e: ApiError) {
            if (e.isDefinitiveAuthFailure) authority.endSession(mark, accessToken)
            throw e
        }
    }

    /** 한 번 보낸다. 재시도는 [request]가 정하고 여기서는 하지 않는다. */
    private suspend fun send(
        method: String,
        path: String,
        body: String?,
        accessToken: String?,
        background: Boolean = false,
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
            // 서버가 **세션의 언어**를 이 헤더로 정한다 — 로그인 시점에 담아 두고,
            // 나중에 그 기기로 보내는 알림 문구를 그 언어로 그린다(plan/push.md D4).
            // 기기 설정이 아니라 **앱에서 고른 언어**다: 앱에 언어 스위처가 있어
            // 둘은 자주 다르고, 사용자가 보는 것은 후자다.
            .header("Accept-Language", languageTag())
            .apply { if (accessToken != null) header("Authorization", "Bearer $accessToken") }
            // 소켓이 시킨 재조회만 표시를 달지 않는다 — 나머지는 사용자가 시킨 것이다.
            .apply { if (!background) header(ACTIVITY_HEADER, "1") }
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
        recoverSession: Boolean = true,
    ) {
        request(method, path, accessToken = accessToken, recoverSession = recoverSession)
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
