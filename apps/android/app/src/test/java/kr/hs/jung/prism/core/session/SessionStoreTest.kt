package kr.hs.jung.prism.core.session

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.domain.model.SessionListItem
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 화면 셋이 나눠 쓰는 **목록 하나**를 네트워크 없이 검증한다.
 *
 * 이 타입이 생긴 이유가 곧 이 파일이 보는 것이다: 목록을 화면마다 들고 있던 동안에는
 * 화면마다 신선도가 달랐고(푸시 화면만 소켓 신호를 듣지 않았다), 화면을 하나 더 만들
 * 때마다 같은 규칙을 옮겨 적어야 했다.
 */
// 테스트 디스패처는 아직 실험적 API다.
@OptIn(ExperimentalCoroutinesApi::class)
class SessionStoreTest {

    @Before
    fun setUp() {
        // init 블록이 viewModelScope(Main)에서 목록을 불러온다 — 테스트 디스패처로 바꾼다.
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun store(
        api: FakeSessionsApi,
        tokens: SessionTokens = FakeTokens(),
    ) = SessionStore(api, tokens)

    // 소켓 없이 세운 store는 알릴 곳이 없다 — 그래도 **죽지 않는다.** 신호는 편의이고,
    // 없으면 서버의 스윕이 늦게나마 같은 일을 한다.
    @Test
    fun `소켓이 없어도 알리기는 조용히 지나간다`() = runTest {
        val store = store(FakeSessionsApi(items = listOf(sessionItem("a", current = true))))

        store.notifyChanged()

        assertEquals(listOf("a"), store.state.value.sessions?.map { it.id })
    }

    // 조회는 겹칠 수 있고 응답은 출발 순서대로 오지 않는다 — 옛 응답이 늦게 와서 새 응답을
    // 덮으면 방금 켠 등록이 화면에서 꺼진 것으로 보인다. 가장 늦게 출발한 조회만 쓴다.
    @Test
    fun `늦게 도착한 옛 응답이 새 응답을 덮지 않는다`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val api = object : SessionsApi {
            var calls = 0
            override suspend fun list(accessToken: String, background: Boolean): List<SessionListItem> {
                calls++
                if (calls == 1) {
                    gate.await()
                    return listOf(sessionItem("a", current = true, pushRegistered = false))
                }
                return listOf(sessionItem("a", current = true, pushRegistered = true))
            }
            override suspend fun revoke(accessToken: String, id: String) {}
            override suspend fun revokeAll(accessToken: String) {}
        }
        val store = SessionStore(api, FakeTokens())

        store.refresh(background = true)
        assertEquals(true, store.state.value.sessions?.single()?.pushRegistered)

        gate.complete(Unit)

        assertEquals(true, store.state.value.sessions?.single()?.pushRegistered)
    }

    @Test
    fun `목록을 불러오면 세션이 채워진다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("a", current = true), sessionItem("b")))
        val store = store(api)

        assertEquals(listOf("a", "b"), store.state.value.sessions?.map { it.id })
        assertTrue(store.state.value.hasOthers)
        assertNull(store.state.value.loadErrorRes)
    }

    @Test
    fun `현재 세션 하나뿐이면 다른 세션이 없다고 말한다`() = runTest {
        val store = store(FakeSessionsApi(items = listOf(sessionItem("only", current = true))))

        // "나 혼자"는 빈 목록이 아니다 — 전체 폐기가 곧 로그아웃이라 버튼을 둘 이유가 없다.
        assertEquals(1, store.state.value.sessions?.size)
        assertFalse(store.state.value.hasOthers)
    }

    @Test
    fun `불러오기에 실패하면 오류만 남기고 목록은 비운다`() = runTest {
        val store = store(FakeSessionsApi(failList = true))

        assertNull(store.state.value.sessions)
        assertEquals(R.string.error_sessions_load_failed, store.state.value.loadErrorRes)
    }

    @Test
    fun `토큰이 없으면 요청하지 않고 오류로 떨어진다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("a")))
        val store = store(api, tokens = FakeTokens(token = null))

        assertNull(store.state.value.sessions)
        assertEquals(R.string.error_sessions_load_failed, store.state.value.loadErrorRes)
        assertTrue(api.listBackgrounds.isEmpty())
    }

    // 갱신이 실패해도 화면에 있던 목록은 남는다 — 비운 뒤 실패하면 볼 것도 재시도할
    // 대상도 사라진다. (처음 불러오기(load)는 반대로 비우는 것이 맞다)
    @Test
    fun `갱신 실패는 화면의 목록을 지우지 않는다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("a", current = true), sessionItem("b")))
        val store = store(api)
        api.failList = true

        store.refresh()

        assertEquals(listOf("a", "b"), store.state.value.sessions?.map { it.id })
        assertEquals(R.string.error_sessions_load_failed, store.state.value.loadErrorRes)
    }

    // 사라질 행은 하나인데 목록 전체가 비워지면, 카드가 "불러오는 중"으로 접혔다가 다시
    // 펴지며 화면이 통째로 흔들린다 — 실기기에서 그것이 깜빡임으로 보였다.
    @Test
    fun `갱신은 목록을 비우지 않고 갈아 끼운다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("a", current = true)))
        val store = store(api)

        val seen = mutableListOf<List<String>?>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            store.state.collect { seen += it.sessions?.map { s -> s.id } }
        }
        seen.clear() // 지금 화면에 떠 있는 목록이 기준선이다

        api.items = listOf(sessionItem("a", current = true), sessionItem("b"))
        store.refresh(background = true)

        assertTrue("갱신 도중 목록이 비워졌다: $seen", seen.none { it == null })
        assertEquals(listOf("a", "b"), store.state.value.sessions?.map { it.id })
        job.cancel()
    }

    // 소켓이 시킨 재조회는 **활동이 아니다**(plan/auth.md §6) — 화면을 열어 둔 것만으로
    // 세션이 연장되면 기기가 둘일 때 서로가 서로의 세션을 영원히 살려낸다.
    @Test
    fun `배경 갱신은 유휴 창을 밀지 않는다고 말한다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("a", current = true)))
        val store = store(api)

        store.refresh(background = true)

        // 세션 시작(init의 load)은 활동이고, 소켓이 시킨 갱신은 아니다.
        assertEquals(listOf(false, true), api.listBackgrounds)
    }

    // 당겨서 새로고침은 "받았다"를 인디케이터로 말한다 — 목록을 비워서 말하면 화면이
    // 흔들린다(그래서 load가 아니라 fetch를 탄다).
    @Test
    fun `당겨서 새로고침은 인디케이터만 돌리고 목록은 남긴다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("a", current = true), sessionItem("b")))
        val store = store(api)

        val seen = mutableListOf<Pair<Boolean, List<String>?>>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            store.state.collect { seen += it.refreshing to it.sessions?.map { s -> s.id } }
        }
        seen.clear()

        api.items = listOf(sessionItem("a", current = true), sessionItem("b"), sessionItem("c"))
        store.pullRefresh()

        assertTrue("인디케이터가 한 번도 돌지 않았다: $seen", seen.any { it.first })
        assertTrue("갱신 도중 목록이 비워졌다: $seen", seen.none { it.second == null })
        assertEquals(listOf("a", "b", "c"), store.state.value.sessions?.map { it.id })
        assertFalse(store.state.value.refreshing)
        job.cancel()
    }

    // 실패해도 인디케이터는 멈춘다 — 돌기만 하면 사용자가 할 수 있는 일이 없다.
    @Test
    fun `당겨서 새로고침이 실패해도 인디케이터는 멈춘다`() = runTest {
        val api = FakeSessionsApi(items = listOf(sessionItem("a", current = true), sessionItem("b")))
        val store = store(api)
        api.failList = true

        store.pullRefresh()

        assertFalse(store.state.value.refreshing)
        assertEquals(listOf("a", "b"), store.state.value.sessions?.map { it.id })
        assertEquals(R.string.error_sessions_load_failed, store.state.value.loadErrorRes)
    }
}
