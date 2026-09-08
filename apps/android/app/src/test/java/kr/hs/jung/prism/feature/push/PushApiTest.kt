package kr.hs.jung.prism.feature.push

import kotlinx.coroutines.test.runTest
import kr.hs.jung.prism.core.network.ApiClient
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.domain.model.PushActionSet
import kr.hs.jung.prism.domain.model.PushSendResult
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

/**
 * 푸시 전송의 경계.
 *
 * **클라이언트는 대상 세션 id와 문구만 보낸다** — 등록 토큰은 서버가 세션 레코드에서
 * 꺼낸다(plan/push.md §5-3). 이 스위트가 지키는 것이 그 규칙이다.
 */
class PushApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: PushApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = HttpPushApi(ApiClient(baseUrl = server.url("/").toString().trimEnd('/')))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `sends only the target ids and the content`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"results":[{"sessionId":"sess-1","result":"accepted"}]}""",
            ),
        )

        val outcomes = api.send(
            "access-1",
            listOf("sess-1", "sess-2"),
            PushContent(message = "hello"),
        )

        assertEquals(listOf(PushOutcome("sess-1", PushSendResult.ACCEPTED)), outcomes)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/auth/push/send", request.path)
        val body = JSONObject(request.body.readUtf8())
        assertEquals("hello", body.getString("message"))
        assertEquals(2, body.getJSONArray("sessionIds").length())
        // 토큰은 어디에도 실리지 않는다 — 서버가 꺼낸다.
        assertNull(body.opt("pushToken"))
    }

    /** 빈 값은 키조차 만들지 않는다 — 없는 필드와 빈 문자열은 서버에서 같은 뜻이다. */
    @Test
    fun `omits image and link when they are blank`() = runTest {
        server.enqueue(MockResponse().setBody("""{"results":[]}"""))

        api.send("access-1", listOf("sess-1"), PushContent("hi", imageUrl = "  ", link = ""))

        val body = JSONObject(server.takeRequest().body.readUtf8())
        assertNull(body.opt("imageUrl"))
        assertNull(body.opt("link"))
        assertEquals("none", body.getString("actions"))
    }

    @Test
    fun `carries image link and buttons when present`() = runTest {
        server.enqueue(MockResponse().setBody("""{"results":[]}"""))

        api.send(
            "access-1",
            listOf("sess-1"),
            PushContent(
                message = "hi",
                imageUrl = "https://cdn.example/a.png",
                link = "https://example.com/x",
                actions = PushActionSet.OPEN_DISMISS,
            ),
        )

        val body = JSONObject(server.takeRequest().body.readUtf8())
        assertEquals("https://cdn.example/a.png", body.getString("imageUrl"))
        assertEquals("https://example.com/x", body.getString("link"))
        assertEquals("open-dismiss", body.getString("actions"))
    }

    @Test
    fun `carries the bearer token`() = runTest {
        server.enqueue(MockResponse().setBody("""{"results":[]}"""))

        api.send("access-1", listOf("sess-1"), PushContent("hi"))

        assertEquals("Bearer access-1", server.takeRequest().getHeader("Authorization"))
    }

    /** 답은 **대상마다** 온다 — 화면이 고른 줄 옆에 그대로 그린다(§5-10). */
    @Test
    fun `maps every contract result`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"results":[
                    {"sessionId":"a","result":"accepted"},
                    {"sessionId":"b","result":"no-token"},
                    {"sessionId":"c","result":"rejected"},
                    {"sessionId":"d","result":"duplicate"},
                    {"sessionId":"e","result":"unknown"}
                ]}""",
            ),
        )

        val outcomes = api.send("access-1", listOf("a", "b", "c", "d", "e"), PushContent("hi"))

        assertEquals(
            listOf(
                PushSendResult.ACCEPTED,
                PushSendResult.NO_TOKEN,
                PushSendResult.REJECTED,
                PushSendResult.DUPLICATE,
                PushSendResult.UNKNOWN,
            ),
            outcomes.map { it.result },
        )
    }

    /** 모르는 결과를 접으면 화면이 없는 사실을 말하게 된다 — 거부한다. */
    @Test
    fun `rejects a result that is not in the contract`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"results":[{"sessionId":"a","result":"delivered"}]}""",
            ),
        )

        assertThrows(ApiError::class.java) {
            kotlinx.coroutines.runBlocking { api.send("access-1", listOf("a"), PushContent("hi")) }
        }
    }

    @Test
    fun `rejects a response without results`() = runTest {
        server.enqueue(MockResponse().setBody("""{}"""))

        assertThrows(ApiError::class.java) {
            kotlinx.coroutines.runBlocking { api.send("access-1", listOf("a"), PushContent("hi")) }
        }
    }
}
