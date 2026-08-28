package kr.hs.jung.prism.live

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kr.hs.jung.prism.core.network.ApiClient
import kr.hs.jung.prism.core.network.SessionSocket
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.domain.model.AuthProvider
import kr.hs.jung.prism.feature.auth.AuthManager
import kr.hs.jung.prism.feature.auth.HttpAuthApi
import kr.hs.jung.prism.feature.dashboard.HttpSessionsApi
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assume.assumeNotNull
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * "무엇이 유휴 창을 미는가"를 **실제 서버**에 대고, 앱이 쓰는 것과 **같은 클라이언트
 * 스택**(ApiClient → AuthManager → SessionSocket)으로 확인한다.
 *
 * 다른 유닛 테스트는 가짜 서버로 "이 요청에 표식이 붙는가"까지만 본다. 표식을 붙이는
 * 코드가 맞아도 프록시가 헤더를 떨구거나 서버가 회전에서 밀어 버리면, 기기 둘이 서로의
 * 세션을 영원히 살려내던 문제가 그대로 되살아난다 — 그건 실제 서버 앞에서만 드러난다.
 *
 * `PRISM_LIVE_API_URL`이 있을 때만 돈다(없으면 건너뛴다). UI는 보지 않으므로 에뮬레이터가
 * 없어도 되고, 그 대신 화면 대신 [SessionsApi][kr.hs.jung.prism.feature.dashboard.SessionsApi]를
 * 직접 부른다 — 대시보드가 소켓 신호에 반응하는 그 호출과 같은 것이다.
 *
 * ```
 * PRISM_LIVE_API_URL=https://example.com ./gradlew testDebugUnitTest --tests '*SessionLifetimeLiveTest'
 * ```
 */
class SessionLifetimeLiveTest {

    /** 액세스 토큰 수명(배포값 60초)보다 길게 본다 — 그래야 재조회가 실제로 회전을 탄다. */
    private val watchMs = 80_000L

    private val base: String? = System.getenv("PRISM_LIVE_API_URL")
    private val http = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    /** 인메모리 토큰 저장소 — Keystore는 기기 위에만 있다. */
    private class MemoryTokens : SessionTokens {
        private var acc: String? = null
        private var ref: String? = null
        override fun hasAny(): Boolean = acc != null
        override fun access(): String? = acc
        override fun refresh(): String? = ref
        override fun save(access: String, refresh: String) { acc = access; ref = refresh }
        override fun clear() { acc = null; ref = null }
    }

    /** 앱 밖에서 서버를 보는 눈. 데모 계정은 하나라 앱의 세션도 이 목록에 함께 보인다. */
    private inner class Observer(val token: String, val sessionId: String)

    private fun post(path: String, token: String? = null): String {
        val request = Request.Builder()
            .url(base + path)
            .post("".toRequestBody(null))
            .apply { token?.let { header("Authorization", "Bearer $it") } }
            .build()
        http.newCall(request).execute().use { return it.body?.string().orEmpty() }
    }

    /** ⚠️ 관측에는 활동 표식을 붙이지 않는다 — 재는 행위가 재려는 값을 밀면 안 된다. */
    private fun rows(token: String): JSONArray {
        val request = Request.Builder()
            .url(base + "/auth/sessions")
            .header("Authorization", "Bearer $token")
            .build()
        http.newCall(request).execute().use { return JSONArray(it.body?.string().orEmpty()) }
    }

    /** 관측자는 그때그때 새로 만든다 — 액세스가 60초짜리라 기다리는 동안 만료된다. */
    private fun mintObserver(): Observer {
        val token = org.json.JSONObject(post("/auth/demo/native")).getString("accessToken")
        val list = rows(token)
        for (i in 0 until list.length()) {
            val row = list.getJSONObject(i)
            if (row.optBoolean("isCurrent")) return Observer(token, row.getString("id"))
        }
        error("방금 만든 세션을 목록에서 찾지 못했다")
    }

    private fun appRow(known: Set<String>, token: String): org.json.JSONObject {
        val list = rows(token)
        for (i in 0 until list.length()) {
            val row = list.getJSONObject(i)
            if (row.getString("id") !in known) return row
        }
        error("앱의 세션을 목록에서 가려내지 못했다")
    }

    /** 다른 기기가 붙었다 끊긴다 — 서버가 `sessionsChanged`를 뿌리는 유일한 계기다. */
    private fun flickerAnotherDevice(observer: Observer) {
        val ready = CountDownLatch(1)
        val socket = http.newWebSocket(
            Request.Builder()
                .url(base!!.replaceFirst("https://", "wss://") + "/socket")
                .header("Authorization", "Bearer ${observer.token}")
                .build(),
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) = ready.countDown()
                override fun onOpen(webSocket: WebSocket, response: Response) = Unit
            },
        )
        // 붙기 전에 끊으면 신호가 나가지 않는다 — 첫 메시지(`ready`)까지 기다린다.
        ready.await(20, TimeUnit.SECONDS)
        socket.close(1000, null)
    }

    @Test
    fun `소켓이 시킨 재조회는 유휴 창을 밀지 않는다`() {
        assumeNotNull(base)

        // 시작 상태를 안다 — 남는 세션은 앱의 것과 관측자들의 것뿐이 되도록 비운다.
        post("/auth/sessions/revoke-all", mintObserver().token)

        val tokens = MemoryTokens()
        val api = ApiClient(userAgent = "Prism (Linux; Android 15; live-probe; Mobile)", baseUrl = base!!)
        val auth = AuthManager(nativeApi = HttpAuthApi(api), tokens = tokens)
        api.sessionAuthority = auth
        val sessions = HttpSessionsApi(api)
        val socket = SessionSocket(
            tokens = tokens,
            authority = auth,
            url = base!!.replaceFirst("https://", "wss://") + "/socket",
        )
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        try {
            runBlocking {
                auth.signIn(AuthProvider.DEMO)

                // 화면이 하는 일을 그대로 한다: 소켓이 신호를 주면 목록을 **배경으로** 다시 가져온다.
                var refetches = 0
                scope.launch {
                    socket.changed.drop(1).collect {
                        tokens.access()?.let { token ->
                            sessions.list(token, background = true)
                            refetches += 1
                        }
                    }
                }
                socket.start(scope)
                withTimeoutOrNull(20_000) { socket.isReady.first { it } }

                val observers = mutableListOf(mintObserver())
                val known = mutableSetOf(observers.first().sessionId)
                val before = appRow(known, observers.last().token).getString("expiresAt")

                val deadline = System.currentTimeMillis() + watchMs
                while (System.currentTimeMillis() < deadline) {
                    flickerAnotherDevice(observers.last())
                    delay(20_000)
                    mintObserver().also { observers += it; known += it.sessionId }
                }

                val after = appRow(known, observers.last().token).getString("expiresAt")
                // 소켓이 실제로 앱을 깨웠어야 이 확인이 의미가 있다.
                assertNotEquals("소켓 신호로 목록을 다시 가져온 적이 없다", 0, refetches)
                assertEquals("소켓이 깨운 재조회가 유휴 창을 밀었다", before, after)

                // 반대편도 함께 본다: 사용자가 시킨 요청은 밀어야 한다.
                delay(11_000) // 서버의 최소 밀기 간격(10초)을 넘긴다
                sessions.list(tokens.access()!!, background = false)
                val touched = appRow(known, mintObserver().token).getString("expiresAt")
                assertNotEquals("사용자가 시킨 요청인데 유휴 창이 그대로다", after, touched)
            }
        } finally {
            socket.stop()
            scope.cancel()
        }
    }
}
