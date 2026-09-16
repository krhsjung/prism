package kr.hs.jung.prism.core.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 링크는 **우리 주소면 앱 안의 화면**(딥링크), 바깥 주소면 브라우저다 — 통화 알림만 예외다
 * (앱이 자기 화면으로 연다). 옛 서버가 실은 기본 주소(`/push`)도 우리 주소라 앱 안에서 열린다.
 */
class PushLinkResolveTest {
    private val base = "https://prism.example"

    @Test
    fun `통화 알림의 링크는 열지 않는다`() {
        assertEquals(PushOpen.Nothing, PushLinks.resolve("https://prism.example/webrtc?callId=1", "call", base))
    }

    @Test
    fun `우리 주소는 앱 안의 화면이다`() {
        assertEquals(PushOpen.Page(PushDestination.PUSH), PushLinks.resolve("https://prism.example/push", "demo", base))
        assertEquals(
            PushOpen.Page(PushDestination.WEBRTC),
            PushLinks.resolve("https://PRISM.example:443/webrtc?callId=1", "demo", base),
        )
        assertEquals(PushOpen.Page(PushDestination.DASHBOARD), PushLinks.resolve("https://prism.example/", null, base))
        assertEquals(PushOpen.Page(PushDestination.DASHBOARD), PushLinks.resolve("https://prism.example/docs", null, base))
        // 경로 전체로 견준다 — 끝의 `/`만 무시하고, 웹에도 없는 하위 경로는 대시보드다.
        assertEquals(PushOpen.Page(PushDestination.PUSH), PushLinks.resolve("https://prism.example/push/", null, base))
        assertEquals(PushOpen.Page(PushDestination.DASHBOARD), PushLinks.resolve("https://prism.example/push/settings", null, base))
        assertEquals(PushOpen.Page(PushDestination.DASHBOARD), PushLinks.resolve("https://prism.example/webrtc/old", null, base))
        // 스킴의 대소문자는 출처를 가르지 않는다.
        assertEquals(PushOpen.Page(PushDestination.PUSH), PushLinks.resolve("HTTPS://prism.example/push", null, base))
    }

    @Test
    fun `바깥 주소는 브라우저로 간다`() {
        assertEquals(PushOpen.External("https://example.com/thing"), PushLinks.resolve("https://example.com/thing", "demo", base))
        assertEquals(PushOpen.External("https://prism.example:8443/page"), PushLinks.resolve("https://prism.example:8443/page", null, base))
    }

    @Test
    fun `링크가 없거나 비었으면 아무것도 열지 않는다`() {
        assertEquals(PushOpen.Nothing, PushLinks.resolve(null, "demo", base))
        assertEquals(PushOpen.Nothing, PushLinks.resolve(" ", "demo", base))
    }

    // 앱 링크 판정은 **출처**로 한다 — 접두어로 보면 닮은 도메인이 앱 링크로 읽힌다.
    @Test
    fun `같은 출처면 앱 링크다`() {
        assertTrue(isSameOrigin("https://prism.example/push", base))
        assertTrue(isSameOrigin("https://PRISM.example:443/webrtc?callId=1", base))
    }

    @Test
    fun `닮은 도메인이나 다른 포트나 스킴은 앱 링크가 아니다`() {
        assertFalse(isSameOrigin("https://prism.example.evil/path", base))
        assertFalse(isSameOrigin("https://evil.com/prism.example", base))
        assertFalse(isSameOrigin("http://prism.example/push", base))
        assertFalse(isSameOrigin("https://prism.example:8443/push", base))
        assertFalse(isSameOrigin("https://prism.example/push", ""))
        assertFalse(isSameOrigin("not a url", base))
    }
}
