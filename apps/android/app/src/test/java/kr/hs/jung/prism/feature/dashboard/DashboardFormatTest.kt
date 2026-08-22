package kr.hs.jung.prism.feature.dashboard

import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.network.decodeSessionList
import kr.hs.jung.prism.domain.model.DeviceKind
import kr.hs.jung.prism.ui.component.initials
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** 세션 목록 디코딩과 화면 표기(시각·이니셜)의 경계 조건. */
class DashboardFormatTest {

    // ── 목록 디코딩 ──

    @Test
    fun `세션 배열을 디코딩한다`() {
        val list = decodeSessionList(
            """[{"id":"a","startedAt":"2026-01-01T00:00:00.000Z",
               "expiresAt":"2026-01-01T12:00:00.000Z","isCurrent":true,"device":"iphone"}]""",
        )
        assertEquals(1, list.size)
        assertEquals("a", list[0].id)
        assertTrue(list[0].isCurrent)
        assertEquals(DeviceKind.IPHONE, list[0].device)
    }

    @Test
    fun `모르는 기기 종류는 UNKNOWN으로 접는다`() {
        // 갈래가 늘었다고 예전 앱에서 목록 전체가 실패하면 손해가 더 크다.
        val list = decodeSessionList(
            """[{"id":"a","startedAt":"2026-01-01T00:00:00.000Z",
               "expiresAt":"2026-01-01T12:00:00.000Z","isCurrent":true,"device":"watch"},
              {"id":"b","startedAt":"2026-01-01T00:00:00.000Z",
               "expiresAt":"2026-01-01T12:00:00.000Z","isCurrent":false}]""",
        )
        assertEquals(DeviceKind.UNKNOWN, list[0].device)
        // 필드가 아예 없어도 마찬가지다(이 필드가 생기기 전 세션).
        assertEquals(DeviceKind.UNKNOWN, list[1].device)
    }

    @Test
    fun `빈 배열도 정상이다`() {
        assertEquals(emptyList<Any>(), decodeSessionList("[]"))
    }

    @Test
    fun `isCurrent가 boolean이 아니면 거부한다`() {
        // optBoolean이라면 "true"를 통과시킨다 — 실제 타입만 받는지 확인한다.
        assertThrows(ApiError::class.java) {
            decodeSessionList(
                """[{"id":"a","startedAt":"2026-01-01T00:00:00.000Z",
                   "expiresAt":"2026-01-01T12:00:00.000Z","isCurrent":"true"}]""",
            )
        }
    }

    @Test
    fun `한 항목이라도 어긋나면 목록 전체를 거부한다`() {
        // 일부만 살려 그리면 "해제했는데 목록에 남아 있는" 것과 구분되지 않는다.
        assertThrows(ApiError::class.java) {
            decodeSessionList(
                """[{"id":"a","startedAt":"2026-01-01T00:00:00.000Z",
                   "expiresAt":"2026-01-01T12:00:00.000Z","isCurrent":true},{"id":""}]""",
            )
        }
    }

    @Test
    fun `배열이 아니면 거부한다`() {
        assertThrows(ApiError::class.java) { decodeSessionList("""{"id":"a"}""") }
    }

    // ── 시각 표기 ──

    @Test
    fun `밀리초가 있든 없든 파싱한다`() {
        val withMs = formatTimestamp("2026-08-20T12:08:26.806Z", Locale.US)
        val withoutMs = formatTimestamp("2026-08-20T12:08:26Z", Locale.US)
        assertTrue(withMs.contains("2026"))
        assertTrue(withoutMs.contains("2026"))
    }

    @Test
    fun `형식을 벗어난 값은 원문을 그대로 보여준다`() {
        // 빈칸으로 두면 무엇이 잘못됐는지 알 수 없고, 목록 전체를 실패시킬 이유도 없다.
        assertEquals("not-a-date", formatTimestamp("not-a-date", Locale.US))
        assertEquals("2026-13-45T00:00:00Z", formatTimestamp("2026-13-45T00:00:00Z", Locale.US))
    }

    // ── 아바타 이니셜 ──

    @Test
    fun `라틴 이름은 두 단어의 첫 글자를 모은다`() {
        assertEquals("AK", initials("Alex Kim"))
        assertEquals("D", initials("Demo"))
    }

    @Test
    fun `한글 이름은 앞 한 글자만 쓴다`() {
        // `정희석`을 `정희`로 자르면 이름이 아니라 다른 단어로 읽힌다.
        assertEquals("정", initials("정희석"))
        assertEquals("정", initials("정 희석"))
    }

    @Test
    fun `이름이 비어 있으면 물음표로 떨어진다`() {
        assertEquals("?", initials("   "))
    }
}
