package kr.hs.jung.prism.feature.auth

import android.app.Activity
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.domain.model.AuthErrorCode
import kr.hs.jung.prism.domain.model.AuthProvider
import kr.hs.jung.prism.domain.model.AuthSession
import kr.hs.jung.prism.domain.model.SessionUser
import kr.hs.jung.prism.domain.model.User
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 네이티브(Bearer) 세션 복원/로그인/로그아웃의 자격증명 안전성과 직렬화를 검증한다. 실제
 * 네트워크·저장소 없이 가짜를 주입해 "무엇을 지우고 어떤 상태로 가는가"를 결정적으로 본다.
 * 모든 로그인(소셜·데모)은 토큰 흐름 하나로 통일돼 있다 — 쿠키 경로는 없다.
 */
// 가상 시계(advanceTimeBy·runCurrent)와 테스트 디스패처는 아직 실험적 API다.
@OptIn(ExperimentalCoroutinesApi::class)
class AuthManagerTest {

    private fun user() = User("u1", "demo", "Demo User", "2026-01-01T00:00:00Z")

    /** 서버가 알려 주는 액세스 토큰 수명. 선제 갱신 스케줄이 이 값으로 걸린다. */
    private val ACCESS_TTL_MS = 900_000L
    private fun session() = SessionUser(user(), 900_000L)

    /** 인메모리 Bearer 토큰 저장소. clear 호출 수를 센다. */
    private class FakeTokens(var acc: String? = null, var ref: String? = null) : SessionTokens {
        var clearCount = 0
        override fun hasAny(): Boolean = acc != null
        override fun access(): String? = acc
        override fun refresh(): String? = ref
        override fun save(access: String, refresh: String) {
            acc = access
            ref = refresh
        }
        override fun clear() {
            clearCount++
            acc = null
            ref = null
        }
    }

    /**
     * 응답을 미리 정해 두는 가짜 네이티브 API. 호출 수를 세고, 동시성 테스트를 위해 me/logout에
     * 게이트를 걸 수 있다.
     */
    private class FakeNative : NativeAuthApi {
        var meResult: Result<SessionUser> = Result.failure(ApiError.network)
        var refreshResult: Result<AuthSession> = Result.failure(ApiError.network)
        var demoResult: Result<AuthSession> = Result.failure(ApiError.providerUnavailable)
        var exchangeResult: Result<AuthSession> = Result.failure(ApiError.network)
        var meCount = 0
        var refreshCount = 0
        var logoutCount = 0
        var logoutThrows: Throwable? = null

        // 동시성/락 테스트용 게이트(널이면 통과).
        var meGate: CompletableDeferred<Unit>? = null
        var meGateOnCall = 1
        var logoutGate: CompletableDeferred<Unit>? = null

        // 로그인에 실려 온 등록 토큰. **로그인 시점에만** 세션에 실린다(plan/push.md §5-2).
        var lastPushToken: String? = null

        override suspend fun googleNative(idToken: String, pushToken: String?) =
            throw ApiError.providerUnavailable
        override suspend fun kakaoNative(accessToken: String, pushToken: String?) =
            throw ApiError.providerUnavailable
        override suspend fun demoNative(pushToken: String?): AuthSession {
            lastPushToken = pushToken
            return demoResult.getOrThrow()
        }
        override suspend fun exchangeNative(code: String): AuthSession = exchangeResult.getOrThrow()
        override suspend fun meBearer(accessToken: String): SessionUser {
            meCount++
            if (meCount == meGateOnCall) meGate?.await()
            return meResult.getOrThrow()
        }
        // 회전을 붙잡아 "락을 쥔 채 서버 응답을 기다리는" 순간을 재현한다(널이면 통과).
        var refreshGate: CompletableDeferred<Unit>? = null

        /** 마지막 회전이 **활동으로** 표시됐는지 — 앱 복원이 창을 미느냐가 여기서 갈린다. */
        var lastRefreshActivity: Boolean? = null

        override suspend fun refreshBearer(refreshToken: String, activity: Boolean): AuthSession {
            refreshCount++
            lastRefreshActivity = activity
            refreshGate?.await()
            return refreshResult.getOrThrow()
        }
        override suspend fun logoutBearer(accessToken: String) {
            logoutCount++
            logoutGate?.await()
            logoutThrows?.let { throw it }
        }
    }

    /** 미리 정한 코드/오류를 돌려주는 가짜 웹 인증(Activity 없이 redirect 로직을 검증). */
    private class FakeWebAuth(private val result: Result<String>) : WebAuth {
        override suspend fun signIn(provider: AuthProvider, activity: Activity?): String =
            result.getOrThrow()
    }

    /**
     * 선제 갱신 타이머를 **가상 시계** 위에 올린다 — 실제 디스패처면 `advanceTimeBy`가
     * 닿지 않아 예약이 영영 돌지 않는다.
     */
    private fun TestScope.manager(native: FakeNative, tokens: FakeTokens) =
        AuthManager(native, tokens)

    @Test
    fun `restores signed-in session from tokens`() = runTest {
        val native = FakeNative().apply { meResult = Result.success(session()) }
        val manager = manager(native, FakeTokens(acc = "a", ref = "r"))

        manager.restoreSession()
        assertEquals(user(), (manager.state.value as AuthManager.State.SignedIn).user)
        assertEquals(1, native.meCount)
    }


    // 로그아웃하고 다시 로그인하면 **같은 사용자라도 다른 세션**이다. 화면(ViewModel)이
    // 이 값에 묶여 있어, 값이 그대로면 앞 세션의 목록이 새 세션 화면에 그대로 남는다.
    @Test
    fun `signing in again starts a new session generation`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("dacc", "dref", user(), ACCESS_TTL_MS))
            meResult = Result.success(session())
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        val first = (manager.state.value as AuthManager.State.SignedIn).generation

        manager.signOut()
        manager.signIn(AuthProvider.DEMO)
        val second = (manager.state.value as AuthManager.State.SignedIn).generation

        assertTrue("다시 로그인했는데 같은 세션으로 읽힌다", second > first)
    }

    // 복원·갱신은 **같은 세션을 잇는 것**이다. 여기서 값이 바뀌면 포그라운드로 돌아올
    // 때마다 화면이 통째로 새로 만들어져 목록이 깜빡인다.
    @Test
    fun `restoring and refreshing keep the same session generation`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("dacc", "dref", user(), ACCESS_TTL_MS))
            meResult = Result.success(session())
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        val issued = (manager.state.value as AuthManager.State.SignedIn).generation

        manager.restoreSession()
        assertEquals(issued, (manager.state.value as AuthManager.State.SignedIn).generation)

        // 만료 → 갱신으로 토큰만 갈린 경우도 같은 세션이다.
        native.meResult = Result.failure(ApiError(401, AuthErrorCode.SESSION_EXPIRED))
        native.refreshResult = Result.success(AuthSession("acc2", "ref2", user(), ACCESS_TTL_MS))
        manager.restoreSession()
        assertEquals(issued, (manager.state.value as AuthManager.State.SignedIn).generation)
    }


    // ⚠️ 회귀 방지: 타이머로 미리 회전하면 요청이 없는 동안에도 세션이 밀려 idle
    // 타임아웃이 무의미해진다 — 화면만 열어두면 absolute 상한까지 살아 있게 된다.
    // 회전은 **요청이 있을 때만**, 만료가 임박했을 때 보내기 직전에 한다.
    @Test
    fun `가만히 두면 회전 요청이 나가지 않는다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
            refreshResult = Result.success(AuthSession("a2", "r2", user(), ACCESS_TTL_MS))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        // 토큰 수명을 몇 배나 지나도록 둔다.
        advanceTimeBy(ACCESS_TTL_MS * 5)

        assertEquals(0, native.refreshCount)
    }

    @Test
    fun `수명이 넉넉하면 만료 임박이 아니다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)

        assertEquals(false, manager.isNearExpiry())
    }

    @Test
    fun `수명이 여유보다 짧으면 만료 임박이다`() = runTest {
        val native = FakeNative().apply {
            // 여유(5초)보다 짧다 — 다음 요청은 보내기 전에 회전해야 한다.
            demoResult = Result.success(AuthSession("a1", "r1", user(), 1_000))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)

        assertEquals(true, manager.isNearExpiry())
    }

    // 서버가 수명을 알려 주지 않으면(이 필드가 생기기 전 서버) 모르는 채로 둔다 —
    // 지어내서 헛 회전하지 않고, 만료 대응은 전부 반응형 401 경로가 맡는다.
    @Test
    fun `수명을 모르면 선제 회전을 걸지 않는다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), 0))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)

        assertEquals(false, manager.isNearExpiry())
    }

    // 세션이 끝났는데 만료 시각이 남아 있으면, 다음 세션의 첫 요청이 낡은 값을 보고
    // 헛 회전한다.
    @Test
    fun `로그아웃하면 만료 시각을 잊는다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), 1_000))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        assertEquals(true, manager.isNearExpiry())

        manager.signOut()
        assertEquals(false, manager.isNearExpiry())
    }

    // 요청을 보낸 뒤 응답이 돌아오기 전에 로그아웃하고 다시 로그인하면, 그 401은 **끝난
    // 세션**의 것이다. 토큰만 비교하면 회전과 구분되지 않아 옛 요청이 새 세션을 회전시킬 수
    // 있었다 — 요청 시점의 표식으로 막는다.
    @Test
    fun `낡은 표식으로 온 401은 새 세션을 회전시키지 않는다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
            refreshResult = Result.success(AuthSession("a2", "r2", user(), ACCESS_TTL_MS))
        }
        val tokens = FakeTokens()
        val manager = manager(native, tokens)

        manager.signIn(AuthProvider.DEMO)
        val stale = manager.sessionMark("a1")!!

        // 그사이 로그아웃 → 다시 로그인. 여기서부터는 다른 세션이다.
        manager.signOut()
        native.demoResult = Result.success(AuthSession("b1", "br1", user(), ACCESS_TTL_MS))
        manager.signIn(AuthProvider.DEMO)

        assertEquals(null, manager.refreshForRetry(stale, "a1"))
        assertEquals(0, native.refreshCount)
        assertEquals("b1", tokens.acc)
    }

    // 확정 401도 마찬가지다 — 끝난 세션의 응답이 새 세션을 끊으면 방금 로그인한 사용자가
    // 이유 없이 튕긴다.
    @Test
    fun `낡은 표식으로 온 확정 401은 새 세션을 끝내지 않는다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        val stale = manager.sessionMark("a1")!!

        manager.signOut()
        native.demoResult = Result.success(AuthSession("b1", "br1", user(), ACCESS_TTL_MS))
        manager.signIn(AuthProvider.DEMO)

        manager.endSession(stale, "a1")

        assertTrue(manager.state.value is AuthManager.State.SignedIn)
    }

    // 오프라인·5xx로 갱신이 실패했다고 로그인 화면으로 쫓아내지 않는다 — 자격증명은
    // 아직 살아 있을 수 있고, 화면은 오류만 보여 주면 된다.
    @Test
    fun `쓰는 도중 갱신이 일시적으로 실패해도 세션을 유지한다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
            refreshResult = Result.failure(ApiError.network)
        }
        val tokens = FakeTokens()
        val manager = manager(native, tokens)

        manager.signIn(AuthProvider.DEMO)
        val mark = manager.sessionMark("a1")!!

        assertEquals(null, manager.refreshForRetry(mark, "a1"))

        assertTrue(manager.state.value is AuthManager.State.SignedIn)
        assertEquals(0, tokens.clearCount)
        assertEquals("a1", tokens.acc)
    }

    // 확정 거부는 반대다 — 되살릴 수 없는 세션이므로 자격증명을 지우고 로그인 화면으로 보낸다.
    @Test
    fun `쓰는 도중 갱신이 확정 거부되면 자격증명을 지우고 알린다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
            refreshResult = Result.failure(ApiError(401, AuthErrorCode.UNAUTHORIZED))
        }
        val tokens = FakeTokens()
        val manager = manager(native, tokens)

        manager.signIn(AuthProvider.DEMO)
        val mark = manager.sessionMark("a1")!!

        assertEquals(null, manager.refreshForRetry(mark, "a1"))

        assertEquals(1, tokens.clearCount)
        assertEquals(AuthManager.State.SignedOut, manager.state.value)
        assertTrue(manager.endedUnexpectedly.value)
    }

    // 같은 만료를 화면 요청·복원·소켓이 동시에 발견할 수 있다. 알릴지를 **경로**로
    // 정하면 누가 먼저 처리하느냐에 따라 같은 상황이 조용했다 시끄러웠다 한다 — 기준은
    // "무엇을 보고 있었는가"다. 로그인된 화면에서 끊겼으면 누가 발견했든 알린다.
    @Test
    fun `보내기 전 회전이 거부되면 로그인된 화면이었으므로 알린다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
            refreshResult = Result.failure(ApiError(401, AuthErrorCode.UNAUTHORIZED))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        // 요청 경로가 만료를 보고 회전을 부르는 그 지점이다(ApiClient.request).
        manager.refreshForRetry(manager.sessionMark("a1")!!, "a1")

        assertEquals(1, native.refreshCount)
        assertEquals(AuthManager.State.SignedOut, manager.state.value)
        assertTrue(manager.endedUnexpectedly.value)
    }

    // 로그아웃은 락과 서버 응답을 기다린다. 그 사이 만료가 먼저 발견되면, 자기가 누른
    // 버튼의 결과가 "세션이 종료되었습니다"라는 사고 통지로 뜬다.
    @Test
    fun `로그아웃을 기다리는 동안 세션이 끊겨도 알리지 않는다`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
            refreshResult = Result.failure(ApiError(401, AuthErrorCode.UNAUTHORIZED))
            refreshGate = gate
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        // 요청 경로의 회전이 락을 쥔 채 서버 응답에서 멈춘다.
        val mark = manager.sessionMark("a1")!!
        val rotating = launch { manager.refreshForRetry(mark, "a1") }
        runCurrent()
        assertEquals(1, native.refreshCount)

        // 그 사이 사용자가 로그아웃을 누른다 — 락을 기다리게 된다.
        val signOut = launch { manager.signOut() }
        runCurrent()

        // 멈춰 있던 회전이 확정 거부로 끝난다 — 먼저 정리하지만 알리지는 않아야 한다.
        gate.complete(Unit)
        rotating.join()
        signOut.join()

        assertEquals(AuthManager.State.SignedOut, manager.state.value)
        assertFalse(manager.endedUnexpectedly.value)
    }

    // ⚠️ 회귀 방지: 앱을 다시 여는 것은 **활동**이다. 복원은 만료를 만나면 회전으로 끝나고
    // 다시 보호된 요청을 보내지 않으므로, 그 회전이 활동임을 알리지 않으면 앱을 열어 둔
    // 채로 유휴 만료를 맞는다(plan/auth.md §6).
    @Test
    fun `복원이 만료를 만나 회전하면 그 회전은 활동이다`() = runTest {
        val native = FakeNative().apply {
            meResult = Result.failure(ApiError(401, AuthErrorCode.SESSION_EXPIRED))
            refreshResult = Result.success(AuthSession("a2", "r2", user(), ACCESS_TTL_MS))
        }
        val manager = manager(native, FakeTokens(acc = "a1", ref = "r1"))

        manager.restoreSession()

        assertEquals(true, native.lastRefreshActivity)
    }

    // 스스로 누른 로그아웃은 설명할 것이 없다.
    @Test
    fun `스스로 로그아웃한 것은 알리지 않는다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        manager.signOut()

        assertEquals(AuthManager.State.SignedOut, manager.state.value)
        assertFalse(manager.endedUnexpectedly.value)
    }

    // 앱을 켤 때의 실패는 알리지 않는다 — 그 자리는 자격증명이 아예 없는 첫 방문과
    // 구분되지 않아, 처음 온 사람에게 엉뚱한 안내가 뜬다.
    @Test
    fun `복원이 실패해서 로그인 화면으로 가는 것은 알리지 않는다`() = runTest {
        val native = FakeNative().apply {
            meResult = Result.failure(ApiError(401, AuthErrorCode.SESSION_EXPIRED))
            refreshResult = Result.failure(ApiError(401, AuthErrorCode.UNAUTHORIZED))
        }
        val manager = manager(native, FakeTokens(acc = "a", ref = "r"))

        manager.restoreSession()

        assertEquals(AuthManager.State.SignedOut, manager.state.value)
        assertFalse(manager.endedUnexpectedly.value)
    }

    // 로그아웃한 뒤 남은 요청이 401로 돌아와도 되살릴 세션이 없다.
    @Test
    fun `로그아웃하면 표식이 사라진다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        assertTrue(manager.sessionMark("a1") != null)

        manager.signOut()
        assertEquals(null, manager.sessionMark("a1"))
    }

    // 요청을 보내려고 토큰을 읽은 **뒤** 로그아웃·재로그인이 끝날 수 있다. 그때 표식만
    // 새로 찍으면 옛 토큰이 새 세션의 이름표를 달고 나가, 401 처리가 그 요청을 새 세션의
    // 것으로 착각한다.
    @Test
    fun `낡은 토큰은 새 세션의 표식을 받지 못한다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        manager.signOut()
        native.demoResult = Result.success(AuthSession("b1", "br1", user(), ACCESS_TTL_MS))
        manager.signIn(AuthProvider.DEMO)

        assertEquals(null, manager.sessionMark("a1"))
        assertTrue(manager.sessionMark("b1") != null)
    }

    // 오프라인·5xx는 **판정 불가**다. 세션이 끝났다고 말할 수 없으므로 자격증명을 지키고,
    // 연결이 돌아오면 다음 요청이 다시 회전시킨다.
    @Test
    fun `일시적 회전 실패는 세션을 지키고 다음 요청에서 회복한다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
            refreshResult = Result.failure(ApiError.network)
        }
        val tokens = FakeTokens()
        val manager = manager(native, tokens)

        manager.signIn(AuthProvider.DEMO)
        val mark = manager.sessionMark("a1")!!
        assertEquals(null, manager.refreshForRetry(mark, "a1"))
        assertEquals(1, native.refreshCount)
        // 실패했다고 쫓아내지는 않는다.
        assertTrue(manager.state.value is AuthManager.State.SignedIn)

        // 연결이 돌아왔다 — 다음 요청의 회전은 성공한다.
        native.refreshResult = Result.success(AuthSession("a2", "r2", user(), ACCESS_TTL_MS))
        assertEquals("a2", manager.refreshForRetry(mark, "a1"))
        assertEquals(2, native.refreshCount)
        assertEquals("a2", tokens.acc)
    }

    // 함께 나간 두 요청이 같은 토큰을 들고 있다가 하나가 먼저 회전시키면, 나머지는 이미
    // 물러난 토큰을 들고 있다. 그것을 "남의 세션"으로 보면 되살릴 수 있는 401이 그냥
    // 실패가 된다 — 물러난 토큰도 이 세션이 발급한 것이다.
    @Test
    fun `회전 직전의 토큰으로 나간 요청도 되살아난다`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("a1", "r1", user(), ACCESS_TTL_MS))
            refreshResult = Result.success(AuthSession("a2", "r2", user(), ACCESS_TTL_MS))
        }
        val manager = manager(native, FakeTokens())

        manager.signIn(AuthProvider.DEMO)
        val mark = manager.sessionMark("a1")!!

        // 첫 요청이 회전시킨다.
        assertEquals("a2", manager.refreshForRetry(mark, "a1"))

        // 뒤늦게 출발한 두 번째 요청은 아직 "a1"을 들고 있다.
        assertEquals(mark, manager.sessionMark("a1"))
        // 이미 갈려 있으므로 갱신 없이 회전된 토큰으로 재시도한다.
        assertEquals("a2", manager.refreshForRetry(mark, "a1"))
        assertEquals(1, native.refreshCount)
    }

    @Test
    fun `no tokens goes signed-out without calling me`() = runTest {
        val native = FakeNative()
        val manager = manager(native, FakeTokens())

        manager.restoreSession()
        assertEquals(AuthManager.State.SignedOut, manager.state.value)
        assertEquals(0, native.meCount)
    }

    // 확정 인증 실패(폐기·변조)만 토큰을 지운다.
    @Test
    fun `definitive auth failure clears tokens`() = runTest {
        val native = FakeNative().apply {
            meResult = Result.failure(ApiError(401, AuthErrorCode.INVALID_TOKEN))
        }
        val tokens = FakeTokens(acc = "a", ref = "r")
        manager(native, tokens).restoreSession()

        assertEquals(1, tokens.clearCount)
    }

    // 일시적 실패(네트워크·5xx)는 토큰을 **보존**한다 — 오프라인 실행이 유효 세션을 파괴하지 않게.
    @Test
    fun `transient failure keeps tokens`() = runTest {
        val native = FakeNative().apply { meResult = Result.failure(ApiError.network) }
        val tokens = FakeTokens(acc = "a", ref = "r")
        manager(native, tokens).restoreSession()

        assertEquals(0, tokens.clearCount)
        assertTrue(tokens.hasAny())
    }

    @Test
    fun `expired session refreshes and keeps signed-in with rotated tokens`() = runTest {
        val native = FakeNative().apply {
            meResult = Result.failure(ApiError(401, AuthErrorCode.SESSION_EXPIRED))
            refreshResult = Result.success(AuthSession("acc2", "ref2", user(), ACCESS_TTL_MS))
        }
        val tokens = FakeTokens(acc = "a", ref = "r")
        manager(native, tokens).restoreSession()

        assertEquals(1, native.refreshCount)
        assertEquals("acc2", tokens.acc) // 회전된 토큰이 저장됐다
        assertEquals("ref2", tokens.ref)
    }

    @Test
    fun `refresh rejection clears, transient refresh keeps tokens`() = runTest {
        // 확정 거부 → clear
        FakeTokens(acc = "a", ref = "r").let { tokens ->
            val native = FakeNative().apply {
                meResult = Result.failure(ApiError(401, AuthErrorCode.SESSION_EXPIRED))
                refreshResult = Result.failure(ApiError(401, AuthErrorCode.UNAUTHORIZED))
            }
            manager(native, tokens).restoreSession()
            assertEquals(1, tokens.clearCount)
        }
        // 일시적 실패 → 보존
        FakeTokens(acc = "a", ref = "r").let { tokens ->
            val native = FakeNative().apply {
                meResult = Result.failure(ApiError(401, AuthErrorCode.SESSION_EXPIRED))
                refreshResult = Result.failure(ApiError.network)
            }
            manager(native, tokens).restoreSession()
            assertEquals(0, tokens.clearCount)
        }
    }

    // 데모: 서버가 시드 계정으로 준 Bearer 세션을 토큰으로 저장하고 SignedIn으로 전환한다(쿠키 아님).
    @Test
    fun `demo login issues bearer session`() = runTest {
        val native = FakeNative().apply {
            demoResult = Result.success(AuthSession("dacc", "dref", user(), ACCESS_TTL_MS))
        }
        val tokens = FakeTokens()
        val manager = manager(native, tokens)

        manager.signIn(AuthProvider.DEMO)
        assertEquals(user(), (manager.state.value as AuthManager.State.SignedIn).user)
        assertEquals("dacc", tokens.acc)
        assertEquals("dref", tokens.ref)
    }

    @Test
    fun `sign-out calls logoutBearer and clears tokens even when server logout fails`() = runTest {
        val native = FakeNative().apply { logoutThrows = ApiError.network }
        val tokens = FakeTokens(acc = "a", ref = "r")
        val manager = manager(native, tokens)

        manager.signOut()
        assertEquals(AuthManager.State.SignedOut, manager.state.value)
        assertEquals(1, native.logoutCount)
        assertEquals(1, tokens.clearCount)
    }

    // redirect: 브라우저 탭이 준 일회용 코드를 교환해 Bearer 세션으로 채택한다.
    @Test
    fun `redirect login exchanges the one-time code and adopts the session`() = runTest {
        val native = FakeNative().apply {
            exchangeResult = Result.success(AuthSession("racc", "rref", user(), ACCESS_TTL_MS))
        }
        val web = FakeWebAuth(Result.success("one-time-code"))
        val tokens = FakeTokens()
        val manager = AuthManager(native, tokens, webAuth = web)

        manager.signIn(AuthProvider.GOOGLE, AuthMethod.REDIRECT, activity = null)
        assertEquals(user(), (manager.state.value as AuthManager.State.SignedIn).user)
        assertEquals("racc", tokens.acc)
        assertEquals("rref", tokens.ref)
    }

    // webAuth 미설정(기본 Unavailable)이면 redirect는 providerUnavailable로 막힌다.
    @Test
    fun `redirect without a web auth path is unavailable`() = runTest {
        val manager = manager(FakeNative(), FakeTokens())
        var thrown: ApiError? = null
        try {
            manager.signIn(AuthProvider.APPLE, AuthMethod.REDIRECT, activity = null)
        } catch (e: ApiError) {
            thrown = e
        }
        assertEquals(ApiError.providerUnavailable.code, thrown?.code)
    }

    @Test
    fun `google and apple are unavailable`() = runTest {
        val manager = manager(FakeNative(), FakeTokens())
        for (provider in listOf(AuthProvider.GOOGLE, AuthProvider.APPLE)) {
            var thrown: ApiError? = null
            try {
                manager.signIn(provider)
            } catch (e: ApiError) {
                thrown = e
            }
            assertEquals(ApiError.providerUnavailable.code, thrown?.code)
        }
    }

    // 정리가 **락 안**에서 일어나므로, 로그아웃이 진행 중일 때 대기하던 복원은 로그아웃이
    // 토큰을 지운 뒤에야 락을 잡아 세션을 되살리지 못한다(경쟁으로 SignedIn 되지 않음).
    @Test
    fun `sign-out clears inside lock so a queued restore cannot resurrect`() =
        runTest(UnconfinedTestDispatcher()) {
            val logoutGate = CompletableDeferred<Unit>()
            val native = FakeNative().apply {
                meResult = Result.success(session()) // 서버 세션은 살아 있다(부활하면 SignedIn 상황)
                this.logoutGate = logoutGate // 로그아웃이 락을 쥔 채 멈춘다
            }
            val tokens = FakeTokens(acc = "a", ref = "r")
            val manager = manager(native, tokens)

            val out = launch { manager.signOut() } // 락 획득 후 logoutBearer에서 대기
            val restore = launch { manager.restoreSession() } // 락 대기(진입 못 함)
            assertFalse(restore.isCompleted)
            assertEquals(0, native.meCount) // 복원이 아직 me를 못 쳤다

            logoutGate.complete(Unit) // 로그아웃 진행 → 토큰 삭제 + SignedOut, 락 해제
            out.join()
            restore.join()

            // 복원은 락을 잡았을 때 토큰이 이미 없어 me를 부르지 않고 SignedOut을 유지한다.
            assertEquals(0, native.meCount)
            assertEquals(AuthManager.State.SignedOut, manager.state.value)
            assertFalse(tokens.hasAny())
        }

    // 직렬화: 동시에 두 복원이 들어와도 갱신은 한 번만 나간다(1회용 refresh 재사용 방지).
    // 첫 복원의 me를 게이트로 붙잡아 그 사이 두 번째 복원을 시작한다.
    @Test
    fun `concurrent restores are serialized`() = runTest(UnconfinedTestDispatcher()) {
        val gate = CompletableDeferred<Unit>()
        val native = FakeNative().apply {
            meResult = Result.success(session())
            meGate = gate // 첫 me 호출을 붙잡는다
        }
        val tokens = FakeTokens(acc = "a", ref = "r")
        val manager = manager(native, tokens)

        val first = launch { manager.restoreSession() }
        val second = launch { manager.restoreSession() }
        // 두 번째는 첫 번째가 mutex를 쥐고 있어 진입하지 못한다 — 아직 me는 1회뿐.
        assertEquals(1, native.meCount)
        assertFalse(second.isCompleted)

        gate.complete(Unit)
        first.join()
        second.join()
        // 직렬화됐으므로 두 번째가 그제서야 두 번째 me를 부른다(겹치지 않음).
        assertEquals(2, native.meCount)
        assertEquals(user(), (manager.state.value as AuthManager.State.SignedIn).user)
    }
}
