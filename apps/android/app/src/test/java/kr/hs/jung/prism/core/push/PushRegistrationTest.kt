package kr.hs.jung.prism.core.push

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.session.FakeSessionsApi
import kr.hs.jung.prism.core.session.FakeTokens
import kr.hs.jung.prism.core.session.SessionStore
import kr.hs.jung.prism.core.session.sessionItem
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 이 기기의 알림 등록을 **세션에 하나만** 두는 자리를 네트워크 없이 검증한다.
 *
 * 이 타입이 생긴 이유가 곧 이 파일이 보는 것이다: 되살리기(`RootScreen`)와 켜기·끄기·
 * 해제(`PushViewModel`)가 두 벌로 있는 동안에는 둘이 겹쳐 돌 수 있었고, 권한이 사라진
 * 것은 푸시 화면이 떠 있을 때만 알아챘고, 토큰이 돌면 다음 로그인까지 죽은 값이 남았다.
 */
// 테스트 디스패처는 아직 실험적 API다.
@OptIn(ExperimentalCoroutinesApi::class)
class PushRegistrationTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    /** 기기의 사정을 손으로 정하는 가짜. 토큰은 [token]이고, `current()`가 불린 수를 센다. */
    private class FakeDevice(
        override var enabled: Boolean = true,
        var granted: Boolean = true,
        var wantedNow: Boolean = true,
        var token: String? = "fcm-1",
    ) : PushDevice {
        var currentCalls = 0
        val remembered = mutableListOf<Boolean>()
        /** 토큰을 붙잡아 "되살리기가 진행 중인" 순간을 재현한다(널이면 통과). */
        var tokenGate: CompletableDeferred<Unit>? = null

        override fun permissionGranted() = granted
        override suspend fun current(): String? {
            currentCalls++
            tokenGate?.await()
            return if (enabled && granted) token else null
        }
        override fun wanted() = wantedNow
        override fun rememberWanted(wanted: Boolean) {
            wantedNow = wanted
            remembered += wanted
        }
        var disablePendingNow = false
        override fun disablePending() = disablePendingNow
        override fun rememberDisablePending(pending: Boolean) {
            disablePendingNow = pending
        }
    }

    private class FakePushApi(
        var registerResult: Boolean = true,
        var registerThrows: Boolean = false,
        var unregisterThrows: Boolean = false,
    ) : PushApi {
        val registered = mutableListOf<String>()
        var unregisterCount = 0
        val order = mutableListOf<String>()

        override suspend fun register(accessToken: String, token: String): Boolean {
            if (registerThrows) throw ApiError.network
            registered += token
            order += "register:$token"
            return registerResult
        }

        override suspend fun unregister(accessToken: String) {
            if (unregisterThrows) throw ApiError.network
            unregisterCount++
            order += "unregister"
        }

        override suspend fun send(
            accessToken: String,
            sessionIds: List<String>,
            content: PushContent,
        ): List<PushOutcome> = emptyList()
    }

    private class Harness(
        val device: FakeDevice = FakeDevice(),
        val api: FakePushApi = FakePushApi(),
        registered: Boolean = false,
    ) {
        val sessionsApi = FakeSessionsApi(
            items = listOf(sessionItem("me", current = true, pushRegistered = registered)),
        )
        val store = SessionStore(sessionsApi, FakeTokens())
        val registration = PushRegistration(device, api, FakeTokens(), store)

        /** 서버가 다음 조회에서 내려줄 값 — 붙인(뗀) 결과가 목록에 반영된 모습이다. */
        fun serverSays(registered: Boolean) {
            sessionsApi.items = listOf(sessionItem("me", current = true, pushRegistered = registered))
        }
    }

    // ── 되살리기 ──

    @Test
    fun `받기로 해 뒀으면 조용히 다시 붙인다`() = runTest {
        val h = Harness()

        h.registration.reconcile()

        assertEquals(listOf("fcm-1"), h.api.registered)
        // 붙인 뒤 목록을 다시 받는다 — 배경 재조회다(유휴 창을 밀지 않는다).
        assertTrue(h.sessionsApi.listBackgrounds.contains(true))
    }

    @Test
    fun `꺼 뒀으면 아무것도 하지 않는다`() = runTest {
        val h = Harness(device = FakeDevice(wantedNow = false))

        h.registration.reconcile()

        assertTrue(h.api.registered.isEmpty())
        assertEquals(0, h.device.currentCalls)
    }

    @Test
    fun `권한이 없으면 토큰을 받지 않는다`() = runTest {
        val h = Harness(device = FakeDevice(granted = false))

        h.registration.reconcile()

        assertEquals(0, h.device.currentCalls)
        assertTrue(h.api.registered.isEmpty())
    }

    // 서버는 그사이 세션이 사라졌으면 던지지 않고 false를 돌려준다 — 붙은 것이 아니다.
    @Test
    fun `서버가 붙이지 못했다고 답하면 목록을 다시 받지 않는다`() = runTest {
        val h = Harness(api = FakePushApi(registerResult = false))

        h.registration.reconcile()

        assertFalse(h.sessionsApi.listBackgrounds.contains(true))
    }

    // 같은 토큰을 매번 다시 붙이면 앱이 앞으로 올 때마다 왕복이 하나씩 붙는다.
    @Test
    fun `토큰이 같으면 다시 붙이지 않는다`() = runTest {
        val h = Harness()
        h.registration.reconcile()
        h.serverSays(true)
        h.store.refresh()

        h.registration.reconcile()

        assertEquals(listOf("fcm-1"), h.api.registered)
    }

    // FCM은 토큰을 돌린다. 세션에 남은 옛 값으로는 알림이 오지 않는데 목록은 여전히
    // `Will notify`를 그린다 — 돌아온 값을 다시 붙여야 한다.
    @Test
    fun `토큰이 돌면 새 값을 다시 붙인다`() = runTest {
        val h = Harness()
        h.registration.reconcile()
        h.device.token = "fcm-2"

        PushTokenRotations.note()

        assertEquals(listOf("fcm-1", "fcm-2"), h.api.registered)
    }

    // ── 권한이 사라졌을 때 ──

    // 권한을 꺼도 세션 레코드의 토큰은 남아 `pushRegistered`가 참이다 — 남의 로비는
    // 울리지 않을 기기를 `Will notify`로 그린다. 받을 수 없다는 것을 아는 쪽은 이 기기뿐이다.
    @Test
    fun `등록돼 있는데 받을 수 없게 됐으면 뗀다`() = runTest {
        val h = Harness(registered = true)
        h.device.granted = false

        h.registration.reconcile()

        assertEquals(1, h.api.unregisterCount)
        // 사람이 끈 것이 아니다 — 선택은 그대로다.
        assertTrue(h.device.remembered.isEmpty())
        assertTrue(h.device.wantedNow)
    }

    @Test
    fun `등록돼 있지 않으면 받을 수 없어도 아무것도 하지 않는다`() = runTest {
        val h = Harness(device = FakeDevice(granted = false))

        h.registration.reconcile()

        assertEquals(0, h.api.unregisterCount)
    }

    // 내 줄의 등록 여부가 바뀌면(목록 도착·서버가 죽은 토큰을 뗌) 다시 맞춘다.
    @Test
    fun `목록에서 내 등록이 사라지면 다시 붙인다`() = runTest {
        val h = Harness(registered = true)
        h.registration.reconcile()
        assertEquals(listOf("fcm-1"), h.api.registered)
        // 서버가 거부된 토큰을 뗐다 — 이 설치의 토큰은 그대로라 같은 값을 다시 붙이지 않고,
        h.serverSays(false)
        h.store.refresh()
        assertEquals(listOf("fcm-1"), h.api.registered)
        // 토큰이 돌아야 비로소 새 값이 붙는다.
        h.device.token = "fcm-3"
        PushTokenRotations.note()
        assertEquals(listOf("fcm-1", "fcm-3"), h.api.registered)
    }

    // ── 켜기와 끄기 ──

    @Test
    fun `켜면 붙인 뒤 선택을 기억한다`() = runTest {
        val h = Harness(device = FakeDevice(wantedNow = false))

        assertTrue(h.registration.enable())

        assertEquals(listOf("fcm-1"), h.api.registered)
        assertEquals(listOf(true), h.device.remembered)
    }

    // 실패했는데 선택만 남기면 화면은 `알림 꺼짐`을 말하면서 다음 로그인에 조용히 켜진다.
    @Test
    fun `서버가 붙이지 못했다고 답하면 선택을 기억하지 않는다`() = runTest {
        val h = Harness(device = FakeDevice(wantedNow = false), api = FakePushApi(registerResult = false))

        assertFalse(h.registration.enable())

        assertTrue(h.device.remembered.isEmpty())
    }

    @Test
    fun `끄면 떼고 선택을 지운다`() = runTest {
        val h = Harness(registered = true)

        assertTrue(h.registration.disable())

        assertEquals(1, h.api.unregisterCount)
        assertEquals(listOf(false), h.device.remembered)
    }

    // 서버에서 떼지 못했으면 기억도 바꾸지 않는다 — 바꿔 두면 지금은 등록된 채로 남으면서
    // 다음 로그인부터 조용히 꺼진다.
    @Test
    fun `떼지 못하면 선택을 바꾸지 않는다`() = runTest {
        val h = Harness(registered = true, api = FakePushApi(unregisterThrows = true))

        assertFalse(h.registration.disable())

        assertTrue(h.device.remembered.isEmpty())
    }

    // 되살리기와 끄기가 각자 출발하면 늦게 끝난 쪽이 먼저 끝난 쪽을 덮는다 — "끄기" 뒤에
    // 옛 등록이 끝나 토큰이 되살아나는 식이다. **한 줄로 선다.**

    // 떼는 도중 앱이 죽었다(또는 떼지 못했다) — 끄다 만 표식이 남아 다음 맞추기가 이어서
    // 떼고, 그때 선택이 꺼진다. 표식이 없으면 선택은 켜진 채 남아 다음 실행이 조용히 다시 붙인다.
    @Test
    fun `끄다 만 등록은 다음 맞추기가 이어서 뗀다`() = runTest {
        val h = Harness(device = FakeDevice().apply { disablePendingNow = true }, registered = true)

        h.registration.reconcile()

        assertEquals(1, h.api.unregisterCount)
        assertEquals(false, h.device.wantedNow)
        assertEquals(false, h.device.disablePendingNow)
    }

    // 붙는 데 성공한 켜기는 끄다 만 것을 덮는다 — 남기면 다음 맞추기가 방금 붙인 것을 뗀다.
    @Test
    fun `켜기가 성공하면 끄다 만 표식을 지운다`() = runTest {
        val h = Harness(device = FakeDevice().apply { disablePendingNow = true })

        assertEquals(true, h.registration.enable())
        assertEquals(false, h.device.disablePendingNow)
        assertEquals(true, h.device.wantedNow)

        h.registration.reconcile()
        assertEquals(0, h.api.unregisterCount)
    }

    @Test
    fun `떼지 못하면 표식이 남아 다음에 이어서 뗀다`() = runTest {
        val h = Harness(api = FakePushApi(unregisterThrows = true), registered = true)
        assertEquals(false, h.registration.disable())
        assertTrue(h.device.disablePendingNow)

        h.api.unregisterThrows = false
        h.registration.reconcile()

        assertEquals(1, h.api.unregisterCount)
        assertEquals(listOf(false), h.device.remembered)
        assertEquals(false, h.device.disablePendingNow)
    }
    @Test
    fun `되살리기가 진행 중이면 끄기는 그 뒤에 온다`() = runTest {
        val h = Harness()
        val gate = CompletableDeferred<Unit>()
        h.device.tokenGate = gate
        h.registration.reconcile()

        val disabling = launch { h.registration.disable() }
        h.api.order += "disable-requested"
        gate.complete(Unit)
        disabling.join()

        assertEquals(listOf("disable-requested", "register:fcm-1", "unregister"), h.api.order)
        assertNull(h.device.tokenGate?.takeIf { !it.isCompleted })
    }
}
