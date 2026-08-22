package kr.hs.jung.prism.core.network

import kotlinx.coroutines.test.runTest
import kr.hs.jung.prism.domain.model.AuthErrorCode
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 화면을 쓰는 도중 액세스 토큰이 만료되는 경우를 다룬다.
 *
 * 앱 시작·복귀에서만 갱신하면 그사이의 401은 그냥 실패로 보인다 — 목록이 "불러오지
 * 못했습니다"가 되고, 사용자가 할 수 있는 일은 앱을 껐다 켜는 것뿐이다.
 */
class ApiClientRetryTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun client(): ApiClient = ApiClient(baseUrl = server.url("/").toString())

    private fun expired() = MockResponse()
        .setResponseCode(401)
        .setBody("""{"error":"${AuthErrorCode.SESSION_EXPIRED}"}""")

    @Test
    fun `만료된 세션은 갱신하고 새 토큰으로 한 번 다시 보낸다`() = runTest {
        server.enqueue(expired())
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val api = client()
        api.sessionRefresher = SessionRefresher { used ->
            assertEquals("stale", used)
            "rotated"
        }

        val body = api.request("GET", "/auth/sessions", accessToken = "stale")

        assertEquals("""{"ok":true}""", body)
        assertEquals(2, server.requestCount)
        assertEquals("Bearer stale", server.takeRequest().getHeader("Authorization"))
        // 재시도는 **새** 토큰으로 나가야 한다 — 같은 토큰이면 같은 401이 한 번 더 날 뿐이다.
        assertEquals("Bearer rotated", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `갱신하지 못하면 재시도하지 않고 401을 그대로 올린다`() = runTest {
        server.enqueue(expired())

        val api = client()
        api.sessionRefresher = SessionRefresher { null }

        val error = runCatching { api.request("GET", "/auth/sessions", accessToken = "stale") }
        assertTrue(error.exceptionOrNull() is ApiError)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `재시도한 요청이 또 만료되면 거기서 멈춘다`() = runTest {
        server.enqueue(expired())
        server.enqueue(expired())

        val api = client()
        var calls = 0
        api.sessionRefresher = SessionRefresher { calls++; "rotated" }

        runCatching { api.request("GET", "/auth/sessions", accessToken = "stale") }

        // 두 번째 401에도 갱신을 부르면 401 → 갱신 → 401 … 로 끝나지 않는다.
        assertEquals(1, calls)
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `인증 자신의 호출은 되살리지 않는다`() = runTest {
        server.enqueue(expired())

        val api = client()
        var calls = 0
        api.sessionRefresher = SessionRefresher { calls++; "rotated" }

        // AuthManager가 락을 쥔 채로 부르는 경로다 — 여기서 갱신을 부르면 그 락에서 교착한다.
        runCatching {
            api.request("GET", "/auth/me", accessToken = "stale", retryOnExpiredSession = false)
        }

        assertEquals(0, calls)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `토큰 없이 보낸 요청은 되살릴 세션이 없다`() = runTest {
        server.enqueue(expired())

        val api = client()
        var calls = 0
        api.sessionRefresher = SessionRefresher { calls++; "rotated" }

        runCatching { api.request("POST", "/auth/refresh") }

        assertEquals(0, calls)
        assertEquals(1, server.requestCount)
    }
}
