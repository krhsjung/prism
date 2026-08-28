package kr.hs.jung.prism.feature.dashboard

import kr.hs.jung.prism.R
import kr.hs.jung.prism.domain.model.DeviceKind
import kr.hs.jung.prism.domain.model.SessionListItem
import kr.hs.jung.prism.ui.component.PrismBadgeVariant
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 배지가 말하는 것은 **연결 여부**지 세션의 유효성이 아니다.
 *
 * 여기서 틀리면 조용히 나빠진다: 소켓 서비스가 죽었을 때 멀쩡한 기기들이 전부
 * "비활성"으로 보인다 — 없는 정보를 지어내는 셈이다.
 */
class DashboardStatusTest {
    private fun session(
        current: Boolean = false,
        connected: Boolean = false,
    ) = SessionListItem(
        id = "s-1",
        startedAt = "2026-01-01T00:00:00.000Z",
        expiresAt = "2026-01-01T12:00:00.000Z",
        isCurrent = current,
        isConnected = connected,
        device = DeviceKind.GALAXY,
    )

    // 소켓이 붙어 있어야 presence를 믿는다. 그때 비로소 세 갈래가 드러난다.
    @Test
    fun `splits three ways when the socket is up`() {
        val current = session(current = true)
        val online = session(connected = true)
        val offline = session(connected = false)

        assertEquals(R.string.dashboard_status_current, statusLabel(current, true))
        assertEquals(PrismBadgeVariant.SUCCESS, statusVariant(current, true))
        assertEquals(R.string.dashboard_status_active, statusLabel(online, true))
        assertEquals(PrismBadgeVariant.INFO, statusVariant(online, true))
        assertEquals(R.string.dashboard_status_inactive, statusLabel(offline, true))
        assertEquals(PrismBadgeVariant.NEUTRAL, statusVariant(offline, true))
    }

    // ⚠️ 회귀 방지: 소켓 서비스가 죽으면 presence가 통째로 비어 모든 세션이 "연결 없음"으로
    // 온다. 그것을 그대로 그리면 멀쩡한 기기들을 전부 "비활성"이라고 지어내게 된다.
    @Test
    fun `does not invent Inactive when the socket is down`() {
        val offline = session(connected = false)

        assertEquals(R.string.dashboard_status_active, statusLabel(offline, false))
        assertEquals(PrismBadgeVariant.INFO, statusVariant(offline, false))
    }

    // 후퇴 중에도 "이 기기"는 구별된다 — 그건 presence가 아니라 서버가 계산한 값이다.
    @Test
    fun `keeps the current session distinct while degraded`() {
        val current = session(current = true)

        assertEquals(R.string.dashboard_status_current, statusLabel(current, false))
        assertEquals(PrismBadgeVariant.SUCCESS, statusVariant(current, false))
    }
}
