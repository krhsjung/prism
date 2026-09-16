package kr.hs.jung.prism.feature.push

import kr.hs.jung.prism.core.session.sessionItem
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 고른 대상은 **지금 보낼 수 있는 것**만 남는다.
 *
 * 체크박스는 등록된 줄에만 서므로, 끈 줄을 걸러 내지 않으면 **보이는 선택과 보내는
 * 선택이 어긋난다** — 고른 것이 그것 하나뿐이면 줄에서 끌 방법도 없다.
 */
class PushTargetsTest {

    private val state = PushUiState(selectedIds = listOf("a", "b"))

    @Test
    fun `등록된 대상만 남는다`() {
        val sessions = listOf(
            sessionItem("a", pushRegistered = true),
            sessionItem("b", pushRegistered = true),
        )

        assertEquals(listOf("a", "b"), state.targets(sessions))
    }

    @Test
    fun `알림을 끈 대상은 빠진다`() {
        val sessions = listOf(
            sessionItem("a", pushRegistered = true),
            sessionItem("b", pushRegistered = false),
        )

        assertEquals(listOf("a"), state.targets(sessions))
    }

    @Test
    fun `사라진 세션도 빠진다`() {
        val sessions = listOf(sessionItem("a", pushRegistered = true))

        assertEquals(listOf("a"), state.targets(sessions))
    }

    // 목록이 잠깐 비는 순간(재조회 실패)에 선택이 통째로 날아가면 안 된다 — 그래서
    // 지우지 않고 **걸러서 읽는다**. 목록이 돌아오면 선택도 그대로 돌아온다.
    @Test
    fun `목록이 비어도 고른 것 자체는 남는다`() {
        assertEquals(emptyList<String>(), state.targets(emptyList()))
        assertEquals(listOf("a", "b"), state.selectedIds)
    }

    @Test
    fun `보낼 대상이 없으면 보낼 수 없다`() {
        val off = listOf(sessionItem("a", pushRegistered = false))

        assertEquals(false, state.copy(message = "hello").canSend(off))
        assertEquals(
            true,
            state.copy(message = "hello")
                .canSend(listOf(sessionItem("a", pushRegistered = true))),
        )
    }

    // 숨은 옛 선택이 뒤에 돌아와 상한을 넘기지 않게 — 고치는 순간에 걷어낸다.
    @Test
    fun `고치는 순간 사라진 선택을 걷어내 상한을 지킨다`() {
        val twenty = (1..20).map { "s$it" }
        val full = PushUiState(selectedIds = twenty)
        val registered = { ids: List<String> -> ids.map { sessionItem(it, pushRegistered = true) } }

        // s1이 알림을 끈 사이 s21을 고른다 → 살아 있는 19개 + 1개.
        val replaced = full.toggled("s21", registered(twenty.drop(1) + "s21"))
        assertEquals(twenty.drop(1) + "s21", replaced.selectedIds)

        // s1이 돌아와도 고른 것이 아니다 — 여전히 20개고 보낼 수 있다.
        val back = registered(twenty + "s21")
        assertEquals(20, replaced.targets(back).size)
        assertEquals(true, replaced.copy(message = "hello").canSend(back))
    }

    @Test
    fun `상한을 넘긴 선택은 보낼 수 없다`() {
        val ids = (1..21).map { "s$it" }
        val over = PushUiState(selectedIds = ids, message = "hello")

        assertEquals(false, over.canSend(ids.map { sessionItem(it, pushRegistered = true) }))
    }

    // 등록 기기가 상한보다 많으면 "모두"는 상한까지다 — 전체 수와 견주면 버튼이 영영 "모두 선택"으로 남는다.
    @Test
    fun `상한보다 많이 등록돼 있어도 상한만큼 골랐으면 모두 고른 것이다`() {
        val sessions = (1..21).map { sessionItem("s$it", pushRegistered = true) }
        val twenty = PushUiState(selectedIds = (1..20).map { "s$it" })

        assertEquals(true, twenty.allSelected(sessions))
        assertEquals(false, PushUiState(selectedIds = listOf("s1")).allSelected(sessions))
    }
}
