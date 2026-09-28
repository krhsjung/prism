package kr.hs.jung.prism.core.calling

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * offer를 받는 쪽은 이 답 하나로 "이어 붙일까, 새로 세울까"를 가른다 — 틀리면 ICE restart가
 * 새 연결에 들어가 통화가 끊기거나, 정책 전환의 새 offer가 옛 연결에 들어간다.
 */
class SdpFingerprintTest {
    private fun libwebrtc(fingerprint: String) = listOf(
        "v=0",
        "m=audio 9 UDP/TLS/RTP/SAVPF 111",
        "a=fingerprint:sha-256 $fingerprint",
        "m=video 9 UDP/TLS/RTP/SAVPF 96",
        "a=fingerprint:sha-256 $fingerprint",
    ).joinToString("\r\n")

    private fun firefox(fingerprint: String) =
        listOf("v=0", "a=fingerprint:sha-256 $fingerprint", "m=audio 9 UDP/TLS/RTP/SAVPF 111")
            .joinToString("\n")

    @Test
    fun `reads the same fingerprint on every m-section as one`() {
        assertEquals(listOf("sha-256 aa:bb"), SdpFingerprint.fingerprintsOf(libwebrtc("AA:BB")))
    }

    @Test
    fun `a re-offer from the same connection (ICE restart) is the same connection`() {
        assertTrue(SdpFingerprint.sameConnection(libwebrtc("AA:BB"), libwebrtc("AA:BB")))
    }

    // Firefox는 세션 수준에 한 번, libwebrtc는 m-section마다 — 값이 같으면 같은 연결이다.
    @Test
    fun `where the fingerprint sits does not matter`() {
        assertTrue(SdpFingerprint.sameConnection(libwebrtc("AA:BB"), firefox("aa:bb")))
    }

    @Test
    fun `an offer from a rebuilt connection is a different connection`() {
        assertFalse(SdpFingerprint.sameConnection(libwebrtc("AA:BB"), libwebrtc("CC:DD")))
    }

    // 모르는 것을 "같다"로 접으면 낯선 offer를 살아 있는 연결에 붙인다.
    @Test
    fun `no fingerprint is never the same`() {
        assertFalse(SdpFingerprint.sameConnection("v=0", "v=0"))
        assertFalse(SdpFingerprint.sameConnection("v=0", libwebrtc("AA:BB")))
    }
}
