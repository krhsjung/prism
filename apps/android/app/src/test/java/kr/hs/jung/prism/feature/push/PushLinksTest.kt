package kr.hs.jung.prism.feature.push

import kr.hs.jung.prism.core.push.PushLinks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
        PushLinks.consume()
    }

    @Test
    fun `holds the call id until it is consumed`() {
        PushLinks.offer("call-1")
        assertEquals("call-1", PushLinks.pendingCallId.value)

        PushLinks.consume()
        assertNull(PushLinks.pendingCallId.value)
    }

    @Test
    fun `opens the call the notification points at`() {
        PushLinks.offerFrom(kind = "call", callId = "call-2")

        assertEquals("call-2", PushLinks.pendingCallId.value)
    }

    /** 통화가 아닌 알림(데모 푸시)은 통화 화면을 열지 않는다. */
    @Test
    fun `ignores a payload that is not a call`() {
        PushLinks.offerFrom(kind = "demo", callId = "call-3")

        assertNull(PushLinks.pendingCallId.value)
    }

    /** callId 없는 통화 알림은 열어 봐야 물을 것이 없다. */
    @Test
    fun `ignores a call payload without an id`() {
        PushLinks.offerFrom(kind = "call", callId = null)
        PushLinks.offerFrom(kind = "call", callId = "  ")
        PushLinks.offerFrom(kind = null, callId = null)

        assertNull(PushLinks.pendingCallId.value)
    }
}
