package kr.hs.jung.prism.core.network

import kr.hs.jung.prism.domain.model.AuthErrorCode
import kr.hs.jung.prism.domain.model.SocketServerMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 소켓이 인증 상태를 건드리지 않는다는 것을 못 박는다.
 *
 * 틀리면 조용히 나빠진다 — 오프라인이 곧 로그아웃이 되거나, 이미 끝난 세션의 오류가
 * 새 세션을 끊는다.
 */
class SocketErrorActionTest {
    // 만료만이 갱신으로 살아나는 실패다 — 그때만 회전을 탄다.
    @Test
    fun `expired means refresh and reconnect`() {
        assertEquals(
            SocketErrorAction.REFRESH_AND_RECONNECT,
            SocketErrorAction.of(AuthErrorCode.SESSION_EXPIRED),
        )
    }

    // ⚠️ 회귀 방지: 확정 거절에도 **로그아웃하지 않는다.** 목록 재조회에 판단을 넘겨
    // 그 요청의 401을 중앙 경로가 처리하게 한다.
    @Test
    fun `definitive rejection stops and defers to the list`() {
        assertEquals(
            SocketErrorAction.STOP_AND_REFETCH,
            SocketErrorAction.of(AuthErrorCode.UNAUTHORIZED),
        )
        assertEquals(
            SocketErrorAction.STOP_AND_REFETCH,
            SocketErrorAction.of(AuthErrorCode.INVALID_TOKEN),
        )
    }

    // 모르는 코드로 회전을 시도하면 1회용 자격증명만 태운다 — 안전한 쪽으로 실패한다.
    @Test
    fun `unknown codes do not attempt a rotation`() {
        assertEquals(SocketErrorAction.STOP_AND_REFETCH, SocketErrorAction.of("NOPE"))
    }
}

class SocketMessageDecodeTest {
    @Test
    fun `decodes payload-free signals`() {
        assertEquals(SocketServerMessage.Ready, decodeSocketServerMessage("""{"type":"ready"}"""))
        assertEquals(
            SocketServerMessage.SessionsChanged,
            decodeSocketServerMessage("""{"type":"sessionsChanged"}"""),
        )
        assertEquals(
            SocketServerMessage.Heartbeat,
            decodeSocketServerMessage("""{"type":"heartbeat"}"""),
        )
    }

    @Test
    fun `decodes an error with its code`() {
        assertEquals(
            SocketServerMessage.Error("SESSION_EXPIRED"),
            decodeSocketServerMessage("""{"type":"error","code":"SESSION_EXPIRED"}"""),
        )
    }

    // DeviceKind와 달리 접지 않는다 — 이것은 화면 라벨이 아니라 동작이다.
    @Test
    fun `rejects an unknown type instead of folding it`() {
        assertNull(decodeSocketServerMessage("""{"type":"sessions"}"""))
    }

    // 코드가 없으면 "갱신하면 되는가"를 판단할 수 없다 — 아무 갈래로 떨어지면 안 된다.
    @Test
    fun `rejects an error without a code`() {
        assertNull(decodeSocketServerMessage("""{"type":"error"}"""))
    }

    @Test
    fun `ignores malformed json`() {
        assertNull(decodeSocketServerMessage("not json"))
    }
}
