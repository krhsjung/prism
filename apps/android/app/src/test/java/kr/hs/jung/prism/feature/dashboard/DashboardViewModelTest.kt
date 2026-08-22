package kr.hs.jung.prism.feature.dashboard

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.domain.model.DeviceKind
import kr.hs.jung.prism.domain.model.SessionListItem
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 세션 카드의 상태 전이를 네트워크 없이 검증한다.
 *
 * 여기서 중요한 것은 "무엇을 화면에 남기는가"다 — 폐기는 되돌릴 수 없으므로, 실패했을
 * 때 목록이 지워지거나 버튼이 잠긴 채로 남으면 사용자가 할 수 있는 일이 없어진다.
 */
class DashboardViewModelTest {

    private fun item(
        id: String,
        current: Boolean = false,
        device: DeviceKind = DeviceKind.MAC,
    ) = SessionListItem(
        id = id,
        startedAt = "2026-01-01T00:00:00.000Z",
        expiresAt = "2026-01-01T12:00:00.000Z",
        isCurrent = current,
        device = device,
    )

    /** 인메모리 토큰. 대시보드는 저장하지 않고 읽기만 한다. */
    private class FakeTokens(private val token: String? = "tok") : SessionTokens {
        override fun hasAny(): Boolean = token != null
        override fun access(): String? = token
        override fun refresh(): String? = null
        override fun save(access: String, refresh: String) {}
        override fun clear() {}
    }

    private class FakeApi(
        var items: List<SessionListItem> = emptyList(),
        var failList: Boolean = false,
        var failAction: Boolean = false,
    ) : SessionsApi {
        var revoked = mutableListOf<String>()
        var revokeAllCount = 0
        override suspend fun list(accessToken: String): List<SessionListItem> {
            if (failList) throw ApiError.network
            return items
        }
        override suspend fun revoke(accessToken: String, id: String) {
            if (failAction) throw ApiError.network
            revoked += id
            items = items.filterNot { it.id == id }
        }
        override suspend fun revokeAll(accessToken: String) {
            if (failAction) throw ApiError.network
            revokeAllCount++
        }
    }

    @Before
    fun setUp() {
        // init 블록이 viewModelScope(Main)에서 목록을 불러온다 — 테스트 디스패처로 바꾼다.
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(
        api: FakeApi,
        tokens: SessionTokens = FakeTokens(),
        onEnded: suspend () -> Unit = {},
    ) = DashboardViewModel(api, tokens, onEnded)

    @Test
    fun `목록을 불러오면 세션이 채워진다`() = runTest {
        val api = FakeApi(items = listOf(item("a", current = true), item("b")))
        val vm = viewModel(api)

        assertEquals(listOf("a", "b"), vm.state.value.sessions?.map { it.id })
        assertTrue(vm.state.value.hasOthers)
        assertNull(vm.state.value.loadErrorRes)
    }


    // 사라질 행은 하나인데 목록 전체가 비워지면, 카드가 "불러오는 중"으로 접혔다가 다시
    // 펴지며 화면이 통째로 흔들린다 — 실기기에서 그것이 깜빡임으로 보였다.
    @Test
    fun `해제 뒤 갱신은 목록을 비우지 않는다`() = runTest {
        val api = FakeApi(items = listOf(item("me", current = true), item("other")))
        val vm = viewModel(api)

        val seen = mutableListOf<List<String>?>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            vm.state.collect { seen += it.sessions?.map { s -> s.id } }
        }
        seen.clear() // 지금 화면에 떠 있는 목록이 기준선이다

        vm.revoke("other")

        assertTrue("갱신 도중 목록이 비워졌다: $seen", seen.none { it == null })
        assertEquals(listOf("me"), vm.state.value.sessions?.map { it.id })
        job.cancel()
    }

    // 갱신이 실패해도 화면에 있던 목록은 남는다 — 비운 뒤 실패하면 볼 것도 재시도할
    // 대상도 사라진다. (처음 불러오기(load)는 반대로 비우는 것이 맞다)
    @Test
    fun `갱신 실패는 화면의 목록을 지우지 않는다`() = runTest {
        val api = FakeApi(items = listOf(item("a", current = true), item("b")))
        val vm = viewModel(api)
        api.failList = true

        vm.refresh()

        assertEquals(listOf("a", "b"), vm.state.value.sessions?.map { it.id })
        assertEquals(R.string.error_sessions_load_failed, vm.state.value.loadErrorRes)
    }


    // 당겨서 새로고침은 "받았다"를 인디케이터로 말한다 — 목록을 비워서 말하면 화면이
    // 흔들린다(그래서 load가 아니라 fetch를 탄다).
    @Test
    fun `당겨서 새로고침은 인디케이터만 돌리고 목록은 남긴다`() = runTest {
        val api = FakeApi(items = listOf(item("a", current = true), item("b")))
        val vm = viewModel(api)

        val seen = mutableListOf<Pair<Boolean, List<String>?>>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            vm.state.collect { seen += it.refreshing to it.sessions?.map { s -> s.id } }
        }
        seen.clear()

        api.items = listOf(item("a", current = true), item("b"), item("c"))
        vm.pullRefresh()

        assertTrue("인디케이터가 한 번도 돌지 않았다: $seen", seen.any { it.first })
        assertTrue("갱신 도중 목록이 비워졌다: $seen", seen.none { it.second == null })
        assertEquals(listOf("a", "b", "c"), vm.state.value.sessions?.map { it.id })
        assertFalse(vm.state.value.refreshing)
        job.cancel()
    }

    // 실패해도 인디케이터는 멈춘다 — 돌기만 하면 사용자가 할 수 있는 일이 없다.
    @Test
    fun `당겨서 새로고침이 실패해도 인디케이터는 멈춘다`() = runTest {
        val api = FakeApi(items = listOf(item("a", current = true), item("b")))
        val vm = viewModel(api)
        api.failList = true

        vm.pullRefresh()

        assertFalse(vm.state.value.refreshing)
        assertEquals(listOf("a", "b"), vm.state.value.sessions?.map { it.id })
        assertEquals(R.string.error_sessions_load_failed, vm.state.value.loadErrorRes)
    }

    @Test
    fun `현재 세션 하나뿐이면 모두 로그아웃을 내보내지 않는다`() = runTest {
        val vm = viewModel(FakeApi(items = listOf(item("only", current = true))))

        // "나 혼자"는 빈 목록이 아니다 — 전체 폐기가 곧 로그아웃이라 버튼을 둘 이유가 없다.
        assertEquals(1, vm.state.value.sessions?.size)
        assertTrue(!vm.state.value.hasOthers)
    }

    @Test
    fun `불러오기에 실패하면 오류만 남기고 목록은 비운다`() = runTest {
        val vm = viewModel(FakeApi(failList = true))

        assertNull(vm.state.value.sessions)
        assertEquals(R.string.error_sessions_load_failed, vm.state.value.loadErrorRes)
    }

    @Test
    fun `토큰이 없으면 요청하지 않고 오류로 떨어진다`() = runTest {
        val api = FakeApi(items = listOf(item("a")))
        val vm = viewModel(api, tokens = FakeTokens(token = null))

        assertNull(vm.state.value.sessions)
        assertEquals(R.string.error_sessions_load_failed, vm.state.value.loadErrorRes)
    }

    @Test
    fun `다른 세션을 해제하면 목록을 다시 불러온다`() = runTest {
        val api = FakeApi(items = listOf(item("me", current = true), item("other")))
        val vm = viewModel(api)

        vm.revoke("other")

        assertEquals(listOf("other"), api.revoked)
        // 로컬에서 행만 지우지 않고 서버에 다시 묻는다 — 그사이 목록이 달라질 수 있다.
        assertEquals(listOf("me"), vm.state.value.sessions?.map { it.id })
        assertNull(vm.state.value.revokingId)
    }

    @Test
    fun `해제에 실패하면 목록을 유지한 채 오류만 알린다`() = runTest {
        val api = FakeApi(items = listOf(item("me", current = true), item("other")))
        val vm = viewModel(api)
        api.failAction = true

        vm.revoke("other")

        assertEquals(R.string.error_revoke_failed, vm.state.value.actionErrorRes)
        // 실패했는데 목록이 사라지면 다시 시도할 대상이 화면에서 없어진다.
        assertEquals(listOf("me", "other"), vm.state.value.sessions?.map { it.id })
        assertNull(vm.state.value.revokingId)
    }

    @Test
    fun `현재 세션을 해제하면 세션이 끝났음을 알린다`() = runTest {
        val api = FakeApi(items = listOf(item("me", current = true), item("other")))
        var ended = 0
        val vm = viewModel(api, onEnded = { ended++ })

        vm.revoke("me")

        // 내 토큰은 이미 무효다 — 목록을 다시 부르지 않고 세션의 주인에게 넘긴다.
        assertEquals(1, ended)
    }

    @Test
    fun `전체 로그아웃은 성공하면 세션이 끝났음을 알린다`() = runTest {
        val api = FakeApi(items = listOf(item("me", current = true), item("other")))
        var ended = 0
        val vm = viewModel(api, onEnded = { ended++ })

        vm.signOutAll()

        assertEquals(1, api.revokeAllCount)
        assertEquals(1, ended)
    }

    @Test
    fun `전체 로그아웃에 실패하면 버튼을 다시 열어 준다`() = runTest {
        val api = FakeApi(items = listOf(item("me", current = true), item("other")))
        val vm = viewModel(api)
        api.failAction = true

        vm.signOutAll()

        // 잠긴 채로 두면 재시도할 방법이 없다.
        assertTrue(!vm.state.value.signingOutAll)
        assertEquals(R.string.error_revoke_failed, vm.state.value.actionErrorRes)
    }
}
