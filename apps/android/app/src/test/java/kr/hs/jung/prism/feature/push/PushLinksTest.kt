package kr.hs.jung.prism.feature.push

import kr.hs.jung.prism.core.push.PushDestination
import kr.hs.jung.prism.core.push.PushLinks
import kr.hs.jung.prism.core.push.PushRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 알림이 열어 달라고 한 통화.
 *
 * 두 경로(시스템이 그린 알림의 인텐트 엑스트라 · 앱이 떠 있을 때 온 메시지)가 한 값으로
 * 모이고, 화면은 그것을 **한 번만** 소비한다 — 남겨 두면 되돌아올 때마다 같은 통화를
 * 다시 열려 한다.
 */
class PushLinksTest {
    @Before
    fun reset() {
        PushLinks.clear()
    }

    @Test
    fun `holds the call id until it is consumed`() {
        PushLinks.offer("call-1")
        assertEquals("call-1", PushLinks.pendingCallId)

        PushLinks.consume(PushLinks.pending.value!!)
        assertNull(PushLinks.pendingCallId)
    }

    @Test
    fun `opens the call the notification points at`() {
        PushLinks.offerFrom(kind = "call", callId = "call-2")

        assertEquals("call-2", PushLinks.pendingCallId)
    }

    /** 통화가 아닌 알림(데모 푸시)은 통화 화면을 열지 않는다. */
    @Test
    fun `ignores a payload that is not a call`() {
        PushLinks.offerFrom(kind = "demo", callId = "call-3")

        assertNull(PushLinks.pendingCallId)
    }

    /** callId 없는 통화 알림은 열어 봐야 물을 것이 없다. */
    @Test
    fun `ignores a call payload without an id`() {
        PushLinks.offerFrom(kind = "call", callId = null)
        PushLinks.offerFrom(kind = "call", callId = "  ")
        PushLinks.offerFrom(kind = null, callId = null)

        assertNull(PushLinks.pendingCallId)
    }

    /** 통화가 아닌 알림의 링크가 우리 주소면 그 화면을 연다 — 한 번만 소비한다. */
    @Test
    fun `opens the page an own-origin link points at`() {
        PushLinks.offerFrom(kind = "demo", callId = null, link = "https://prism.example/push", base = "https://prism.example")

        assertEquals(PushDestination.PUSH, PushLinks.pendingPage)
        assertNull(PushLinks.pendingCallId)

        PushLinks.consume(PushLinks.pending.value!!)
        assertNull(PushLinks.pendingPage)
    }

    /** 바깥 주소는 여기 남기지 않는다 — 브라우저가 연다. */
    @Test
    fun `does not hold an external link`() {
        PushLinks.offerFrom(kind = "demo", callId = null, link = "https://example.com/x", base = "https://prism.example")

        assertNull(PushLinks.pendingPage)
    }

    /** 통화가 화면보다 우선이다 — 둘이 함께 남으면 화면 쪽이 통화 화면을 덮는다. */
    @Test
    fun `a call outranks a pending page`() {
        PushLinks.offerFrom(kind = "demo", callId = null, link = "https://prism.example/push", base = "https://prism.example")
        assertEquals(PushDestination.PUSH, PushLinks.pendingPage)

        PushLinks.offerFrom(kind = "call", callId = "call-9")
        assertEquals("call-9", PushLinks.pendingCallId)
        assertNull(PushLinks.pendingPage)

        PushLinks.offerFrom(kind = "demo", callId = null, link = "https://prism.example/push", base = "https://prism.example")
        assertNull(PushLinks.pendingPage)
    }

    /** 처리한 것만 비운다 — 그사이 통화가 들어왔으면 그것은 남는다. */
    @Test
    fun `consuming a handled page keeps a call that arrived meanwhile`() {
        PushLinks.offerFrom(kind = "demo", callId = null, link = "https://prism.example/push", base = "https://prism.example")
        val handled = PushLinks.pending.value!!

        PushLinks.offer("call-1")
        PushLinks.consume(handled)

        assertEquals("call-1", PushLinks.pendingCallId)
    }

    /** 같은 통화를 다시 열어 달라고 하면 새 요청이다 — 같은 값이면 StateFlow가 접어 화면이 다시 돌지 않는다. */
    @Test
    fun `offering the same call again is a new request`() {
        PushLinks.offer("call-1")
        val first = PushLinks.pending.value!!
        PushLinks.consume(first)

        PushLinks.offer("call-1")
        val second = PushLinks.pending.value!!

        assertEquals("call-1", PushLinks.pendingCallId)
        assertTrue(first != second)
    }

    /** 처리하지 않은 것(다른 요청)으로는 비우지 못한다. */
    @Test
    fun `consuming a stale request leaves the current one`() {
        PushLinks.offer("call-1")
        val first = PushLinks.pending.value!!
        PushLinks.consume(first)
        PushLinks.offer("call-1")

        PushLinks.consume(first)

        assertEquals("call-1", PushLinks.pendingCallId)
    }

    /** 통화 화면을 떠나면 그때 남긴 통화 요청만 버린다 — 떠나는 사이 들어온 다른 통화는 남는다. */
    @Test
    fun `leaving the call screen drops only the retained call`() {
        PushLinks.offer("call-1")
        val retained = PushLinks.pending.value!!
        PushLinks.dropCall(retained)
        assertNull(PushLinks.pendingCallId)

        PushLinks.offer("call-1")
        val again = PushLinks.pending.value!!
        PushLinks.offer("call-2")
        PushLinks.dropCall(again)
        assertEquals("call-2", PushLinks.pendingCallId)
    }
}
