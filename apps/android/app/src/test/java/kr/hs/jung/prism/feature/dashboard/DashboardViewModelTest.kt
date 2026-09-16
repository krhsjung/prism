package kr.hs.jung.prism.feature.dashboard

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.session.FakeSessionsApi
import kr.hs.jung.prism.core.session.FakeTokens
import kr.hs.jung.prism.core.session.SessionStore
import kr.hs.jung.prism.core.session.sessionItem
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 세션 카드에서 **할 수 있는 일**을 네트워크 없이 검증한다.
 *
 * 여기서 중요한 것은 "무엇을 화면에 남기는가"다 — 폐기는 되돌릴 수 없으므로, 실패했을
 * 때 목록이 지워지거나 버튼이 잠긴 채로 남으면 사용자가 할 수 있는 일이 없어진다.
 *
 * 목록 자체(불러오기·갱신·실패·당겨 새로고침)는 `SessionStoreTest`가 본다 — 화면 셋이
 * 나눠 쓰는 것이라 화면의 테스트에 섞어 두면 화면마다 같은 것을 다시 확인하게 된다.
 */
// 가상 시계(advanceTimeBy·runCurrent)와 테스트 디스패처는 아직 실험적 API다.
@OptIn(ExperimentalCoroutinesApi::class)
class DashboardViewModelTest {

    @Before
    fun setUp() {
        // store의 init이 viewModelScope(Main)에서 목록을 불러온다 — 테스트 디스패처로 바꾼다.
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun store(api: FakeSessionsApi, tokens: SessionTokens = FakeTokens()) =
        SessionStore(api, tokens)

    private fun viewModel(
        api: FakeSessionsApi,
        store: SessionStore,
        tokens: SessionTokens = FakeTokens(),
        onEnded: suspend () -> Unit = {},
    ) = DashboardViewModel(api, tokens, store, onEnded)

    @Test
    fun `다른 세션을 해제하면 목록을 다시 불러온다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("me", current = true), sessionItem("other")))
        val store = store(api)
        val vm = viewModel(api, store)

        vm.revoke("other")

        assertEquals(listOf("other"), api.revoked)
        // 로컬에서 행만 지우지 않고 서버에 다시 묻는다 — 그사이 목록이 달라질 수 있다.
        assertEquals(listOf("me"), store.state.value.sessions?.map { it.id })
        assertNull(vm.state.value.revokingId)
    }

    // 사라질 행은 하나인데 목록 전체가 비워지면, 카드가 "불러오는 중"으로 접혔다가 다시
    // 펴지며 화면이 통째로 흔들린다 — 실기기에서 그것이 깜빡임으로 보였다.
    @Test
    fun `해제 뒤 갱신은 목록을 비우지 않는다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("me", current = true), sessionItem("other")))
        val store = store(api)
        val vm = viewModel(api, store)

        val seen = mutableListOf<List<String>?>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            store.state.collect { seen += it.sessions?.map { s -> s.id } }
        }
        seen.clear() // 지금 화면에 떠 있는 목록이 기준선이다

        vm.revoke("other")

        assertTrue("갱신 도중 목록이 비워졌다: $seen", seen.none { it == null })
        assertEquals(listOf("me"), store.state.value.sessions?.map { it.id })
        job.cancel()
    }

    @Test
    fun `해제에 실패하면 목록을 유지한 채 오류만 알린다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("me", current = true), sessionItem("other")))
        val store = store(api)
        val vm = viewModel(api, store)
        api.failAction = true

        vm.revoke("other")

        assertEquals(R.string.error_revoke_failed, vm.state.value.actionErrorRes)
        // 실패했는데 목록이 사라지면 다시 시도할 대상이 화면에서 없어진다.
        assertEquals(listOf("me", "other"), store.state.value.sessions?.map { it.id })
        assertNull(vm.state.value.revokingId)
    }

    @Test
    fun `현재 세션을 해제하면 세션이 끝났음을 알린다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("me", current = true), sessionItem("other")))
        var ended = 0
        val vm = viewModel(api, store(api), onEnded = { ended++ })

        vm.revoke("me")

        // 내 토큰은 이미 무효다 — 목록을 다시 부르지 않고 세션의 주인에게 넘긴다.
        assertEquals(1, ended)
    }

    @Test
    fun `전체 로그아웃은 성공하면 세션이 끝났음을 알린다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("me", current = true), sessionItem("other")))
        var ended = 0
        val vm = viewModel(api, store(api), onEnded = { ended++ })

        vm.signOutAll()

        assertEquals(1, api.revokeAllCount)
        assertEquals(1, ended)
    }

    @Test
    fun `전체 로그아웃에 실패하면 버튼을 다시 열어 준다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("me", current = true), sessionItem("other")))
        val vm = viewModel(api, store(api))
        api.failAction = true

        vm.signOutAll()

        // 잠긴 채로 두면 재시도할 방법이 없다.
        assertTrue(!vm.state.value.signingOutAll)
        assertEquals(R.string.error_revoke_failed, vm.state.value.actionErrorRes)
    }
}
