package kr.hs.jung.prism.feature.auth

import android.app.Activity
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
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
class AuthManagerTest {

    private fun user() = User("u1", "demo", "Demo User", "2026-01-01T00:00:00Z")
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

        override suspend fun googleNative(idToken: String) =
            throw ApiError.providerUnavailable
        override suspend fun kakaoNative(accessToken: String) =
            throw ApiError.providerUnavailable
        override suspend fun demoNative(): AuthSession = demoResult.getOrThrow()
        override suspend fun exchangeNative(code: String): AuthSession = exchangeResult.getOrThrow()
        override suspend fun meBearer(accessToken: String): SessionUser {
            meCount++
            if (meCount == meGateOnCall) meGate?.await()
            return meResult.getOrThrow()
        }
        override suspend fun refreshBearer(refreshToken: String): AuthSession {
            refreshCount++
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

    private fun manager(native: FakeNative, tokens: FakeTokens) = AuthManager(native, tokens)

    @Test
    fun `restores signed-in session from tokens`() = runTest {
        val native = FakeNative().apply { meResult = Result.success(session()) }
        val manager = manager(native, FakeTokens(acc = "a", ref = "r"))

        manager.restoreSession()
        assertEquals(AuthManager.State.SignedIn(user()), manager.state.value)
        assertEquals(1, native.meCount)
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
            refreshResult = Result.success(AuthSession("acc2", "ref2", user()))
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
            demoResult = Result.success(AuthSession("dacc", "dref", user()))
        }
        val tokens = FakeTokens()
        val manager = manager(native, tokens)

        manager.signIn(AuthProvider.DEMO)
        assertEquals(AuthManager.State.SignedIn(user()), manager.state.value)
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
            exchangeResult = Result.success(AuthSession("racc", "rref", user()))
        }
        val web = FakeWebAuth(Result.success("one-time-code"))
        val tokens = FakeTokens()
        val manager = AuthManager(native, tokens, webAuth = web)

        manager.signIn(AuthProvider.GOOGLE, AuthMethod.REDIRECT, activity = null)
        assertEquals(AuthManager.State.SignedIn(user()), manager.state.value)
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
        assertEquals(AuthManager.State.SignedIn(user()), manager.state.value)
    }
}
