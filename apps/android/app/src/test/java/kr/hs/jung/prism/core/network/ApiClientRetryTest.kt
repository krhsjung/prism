package kr.hs.jung.prism.core.network

import kotlinx.coroutines.test.runTest
import kr.hs.jung.prism.domain.model.AuthErrorCode
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    /** 다른 기기에서 이 세션을 해제했을 때 서버가 주는 응답(실제로 확인한 값). */
    private fun revoked() = MockResponse()
        .setResponseCode(401)
        .setBody("""{"error":"${AuthErrorCode.UNAUTHORIZED}"}""")

    // ⚠️ 회귀 방지: 유휴 창을 미는 것은 회전이 아니라 **요청**이다. 서버는 표시가 없는
    // 인증 요청을 활동으로 보고 창을 미므로, 소켓이 시킨 재조회에는 표시가 실려야 한다
    // (plan/auth.md §6).
    @Test
    fun `사용자 요청은 활동 표시를 싣는다`() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        val client = client()

        client.request("GET", "/auth/sessions", accessToken = "a1")

        assertEquals("1", server.takeRequest().getHeader(ACTIVITY_HEADER))
    }

    // 소켓이 시킨 재조회에는 표시가 없다 — 사용자가 한 일이 아니다.
    @Test
    fun `배경 요청에는 활동 표시가 없다`() = runTest {
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        val client = client()

        client.request("GET", "/auth/sessions", accessToken = "a1", background = true)

        assertNull(server.takeRequest().getHeader(ACTIVITY_HEADER))
    }

    // 회전 뒤 재시도도 같은 표시를 달고 나가야 한다 — 그러지 않으면 배경 재조회가
    // 회전 한 번으로 슬그머니 활동이 된다.
    @Test
    fun `회전 뒤 재시도도 성격을 유지한다`() = runTest {
        server.enqueue(expired())
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        val client = client().apply { sessionAuthority = FakeAuthority(rotated = "a2") }

        client.request("GET", "/auth/sessions", accessToken = "a1", background = true)

        assertNull(server.takeRequest().getHeader(ACTIVITY_HEADER))
        assertNull(server.takeRequest().getHeader(ACTIVITY_HEADER))
    }

    /** 갱신·종료 호출을 세는 가짜 세션 주인. */    /** 갱신·종료 호출을 세는 가짜 세션 주인. */
    private class FakeAuthority(
        private val rotated: String?,
        /** null이면 "로그인한 세션이 없다" — 되살릴 것도 끝낼 것도 없다. */
        private val mark: Long? = 7L,
        /** true면 요청을 보내기 **전에** 회전한다(만료 임박). */
        private val nearExpiry: Boolean = false,
    ) : SessionAuthority {
        var refreshCount = 0
        var ended: String? = null

        /** 요청을 보낼 때 찍힌 표식이 갱신·종료까지 그대로 따라와야 한다. */
        val seenMarks = mutableListOf<Long>()

        override fun sessionMark(usedAccessToken: String): Long? = mark

        override fun isNearExpiry(): Boolean = nearExpiry

        override suspend fun refreshForRetry(mark: Long, usedAccessToken: String): String? {
            refreshCount++
            seenMarks += mark
            return rotated
        }

        override suspend fun endSession(mark: Long, usedAccessToken: String) {
            seenMarks += mark
            ended = usedAccessToken
        }
    }

    // ⚠️ 회귀 방지: 타이머로 미리 회전하면 요청이 없는 동안에도 세션이 밀려 idle
    // 타임아웃이 무의미해진다. 회전은 **요청이 있을 때만**, 만료가 임박했을 때 한다.
    @Test
    fun `만료가 임박하면 보내기 전에 회전하고 새 토큰으로 보낸다`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))
        val api = client()
        val authority = FakeAuthority(rotated = "fresh", nearExpiry = true)
        api.sessionAuthority = authority

        api.request("GET", "/auth/sessions", accessToken = "stale")

        // 요청은 **한 번만** 나간다 — 만료된 토큰으로 보내고 401을 받는 왕복이 없다.
        assertEquals(1, server.requestCount)
        assertEquals("Bearer fresh", server.takeRequest().getHeader("Authorization"))
        assertEquals(1, authority.refreshCount)
    }

    @Test
    fun `수명이 넉넉하면 보내기 전에 회전하지 않는다`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))
        val api = client()
        val authority = FakeAuthority(rotated = "fresh", nearExpiry = false)
        api.sessionAuthority = authority

        api.request("GET", "/auth/sessions", accessToken = "current")

        assertEquals("Bearer current", server.takeRequest().getHeader("Authorization"))
        assertEquals(0, authority.refreshCount)
    }

    // 선제 회전은 최적화지 정확성이 아니다 — 실패해도 요청은 나가고, 정말 만료였다면
    // 반응형 401 경로가 받아 낸다.
    @Test
    fun `선제 회전이 실패해도 원래 토큰으로 보낸다`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))
        val api = client()
        val authority = FakeAuthority(rotated = null, nearExpiry = true)
        api.sessionAuthority = authority

        api.request("GET", "/auth/sessions", accessToken = "stale")

        assertEquals("Bearer stale", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `만료된 세션은 갱신하고 새 토큰으로 한 번 다시 보낸다`() = runTest {
        server.enqueue(expired())
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val api = client()
        val authority = FakeAuthority(rotated = "rotated")
        api.sessionAuthority = authority

        val body = api.request("GET", "/auth/sessions", accessToken = "stale")

        assertEquals("""{"ok":true}""", body)
        assertEquals(2, server.requestCount)
        assertEquals("Bearer stale", server.takeRequest().getHeader("Authorization"))
        // 재시도는 **새** 토큰으로 나가야 한다 — 같은 토큰이면 같은 401이 한 번 더 날 뿐이다.
        assertEquals("Bearer rotated", server.takeRequest().getHeader("Authorization"))
        // 갱신은 **요청을 보낸 그 세션**의 이름으로 부탁해야 한다.
        assertEquals(listOf(7L), authority.seenMarks)
    }

    // 요청을 보낸 뒤 응답이 오기 전에 로그아웃했다가 다시 로그인하면, 그 401은 **끝난
    // 세션**의 것이다. 표식을 요청 시점에 찍어 두고 그대로 들고 가야 세션 주인이 남의
    // 401인지 알아볼 수 있다.
    @Test
    fun `요청 시점의 세션 표식을 종료까지 들고 간다`() = runTest {
        server.enqueue(revoked())

        val api = client()
        val authority = FakeAuthority(rotated = null, mark = 3L)
        api.sessionAuthority = authority

        runCatching { api.request("GET", "/auth/sessions", accessToken = "dead") }

        assertEquals(listOf(3L), authority.seenMarks)
    }

    // 로그인하지 않은 상태에서 남은 토큰으로 나간 요청은 되살릴 세션이 없다.
    @Test
    fun `로그인한 세션이 없으면 갱신하지 않는다`() = runTest {
        server.enqueue(expired())

        val api = client()
        val authority = FakeAuthority(rotated = "rotated", mark = null)
        api.sessionAuthority = authority

        runCatching { api.request("GET", "/auth/sessions", accessToken = "stale") }

        assertEquals(0, authority.refreshCount)
        assertNull(authority.ended)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `갱신하지 못하면 재시도하지 않고 401을 그대로 올린다`() = runTest {
        server.enqueue(expired())

        val api = client()
        api.sessionAuthority = FakeAuthority(rotated = null)

        val error = runCatching { api.request("GET", "/auth/sessions", accessToken = "stale") }
        assertTrue(error.exceptionOrNull() is ApiError)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `재시도한 요청이 또 만료되면 거기서 멈춘다`() = runTest {
        server.enqueue(expired())
        server.enqueue(expired())

        val api = client()
        val authority = FakeAuthority(rotated = "rotated")
        api.sessionAuthority = authority

        runCatching { api.request("GET", "/auth/sessions", accessToken = "stale") }

        // 두 번째 401에도 갱신을 부르면 401 → 갱신 → 401 … 로 끝나지 않는다.
        assertEquals(1, authority.refreshCount)
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `인증 자신의 호출은 되살리지 않는다`() = runTest {
        server.enqueue(expired())

        val api = client()
        val authority = FakeAuthority(rotated = "rotated")
        api.sessionAuthority = authority

        // AuthManager가 락을 쥔 채로 부르는 경로다 — 여기서 부르면 그 락에서 교착한다.
        runCatching {
            api.request("GET", "/auth/me", accessToken = "stale", recoverSession = false)
        }

        assertEquals(0, authority.refreshCount)
        assertNull(authority.ended)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `토큰 없이 보낸 요청은 되살릴 세션이 없다`() = runTest {
        server.enqueue(expired())

        val api = client()
        val authority = FakeAuthority(rotated = "rotated")
        api.sessionAuthority = authority

        runCatching { api.request("POST", "/auth/refresh") }

        assertEquals(0, authority.refreshCount)
        assertNull(authority.ended)
        assertEquals(1, server.requestCount)
    }

    // 다른 기기에서 이 세션을 해제하면 갱신으로는 살아나지 않는다. 화면이 "불러오지
    // 못했습니다"를 띄우고 마는 대신 세션을 끝내야 로그인 화면으로 돌아간다.
    @Test
    fun `폐기된 세션은 갱신하지 않고 세션을 끝낸다`() = runTest {
        server.enqueue(revoked())

        val api = client()
        val authority = FakeAuthority(rotated = "rotated")
        api.sessionAuthority = authority

        runCatching { api.request("GET", "/auth/sessions", accessToken = "dead") }

        assertEquals(0, authority.refreshCount)
        assertEquals("dead", authority.ended)
        assertEquals(1, server.requestCount)
    }

    // 방금 회전한 토큰까지 거부됐다면 되살릴 수 있는 세션이 아니다.
    @Test
    fun `재시도가 폐기로 돌아오면 세션을 끝낸다`() = runTest {
        server.enqueue(expired())
        server.enqueue(revoked())

        val api = client()
        val authority = FakeAuthority(rotated = "rotated")
        api.sessionAuthority = authority

        runCatching { api.request("GET", "/auth/sessions", accessToken = "stale") }

        assertEquals(1, authority.refreshCount)
        assertEquals("rotated", authority.ended)
        assertEquals(2, server.requestCount)
    }
}
