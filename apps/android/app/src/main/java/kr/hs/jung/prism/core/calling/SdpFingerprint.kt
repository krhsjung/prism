package kr.hs.jung.prism.core.calling

/**
 * SDP에서 **연결의 신원**만 읽는다(웹 `lib/webrtc/sdp.ts`).
 *
 * DTLS 인증서는 `PeerConnection`마다 새로 만들어지고 그 지문(`a=fingerprint:`)이 모든
 * offer·answer에 실린다. 그래서 지문이 같으면 **같은 연결이 낸 기술**이다 — offer를 받는
 * 쪽이 "지금 들고 있는 연결에 이어 붙일 것인가, 새로 세울 것인가"를 가르는 데 이것 하나면
 * 된다(plan/webrtc.md §6). ICE restart는 같은 연결의 재-offer라 지문이 같고, ICE 정책
 * 전환은 연결을 새로 세우므로 지문이 다르다.
 *
 * 계약에 표를 얹지 않는 이유: 표는 보낸 쪽의 **의도**이고 지문은 받는 쪽이 들고 있는
 * **사실**이다. 서버는 SDP를 해석하지 않으므로(§7) 이 판단은 클라이언트 안에서 끝난다.
 */
object SdpFingerprint {
    private const val PREFIX = "a=fingerprint:"

    /** 기술에 실린 지문들 — 세션 수준이든(Firefox) m-section마다든(libwebrtc·Chrome) 값은 같다. */
    fun fingerprintsOf(sdp: String): List<String> =
        sdp.lineSequence()
            .filter { it.startsWith(PREFIX) }
            .map { it.removePrefix(PREFIX).trim().lowercase() }
            .filter { it.isNotEmpty() }
            .toSortedSet()
            .toList()

    /**
     * 두 기술이 **같은 `PeerConnection`** 에서 나왔는가.
     *
     * 지문이 하나도 없으면 같다고 하지 않는다 — 모르는 것을 "같다"로 접으면 낯선 offer를
     * 살아 있는 연결에 붙이게 된다. 새로 세우는 쪽(지금까지의 규칙)이 안전한 기본값이다.
     */
    fun sameConnection(a: String, b: String): Boolean {
        val mine = fingerprintsOf(a)
        return mine.isNotEmpty() && mine == fingerprintsOf(b)
    }
}
