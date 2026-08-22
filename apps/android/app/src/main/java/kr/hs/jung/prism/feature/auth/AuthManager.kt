package kr.hs.jung.prism.feature.auth

import android.app.Activity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.network.SessionAuthority
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.util.AppLog
import kr.hs.jung.prism.domain.model.AuthProvider
import kr.hs.jung.prism.domain.model.AuthSession
import kr.hs.jung.prism.domain.model.User
import kr.hs.jung.prism.feature.auth.social.SocialSignIn

/**
 * 앱 전체의 인증 상태.
 *
 * 세션의 진실은 서버에 있고(plan/auth.md §6), 앱은 저장된 Bearer 토큰으로 그것을 물어볼
 * 뿐이다 — 그래서 시작 상태가 `SignedIn`이 아니라 `Checking`이다. 토큰이 있다는 사실
 * 만으로 로그인된 화면을 그리면, 원격에서 폐기된 세션이 잠깐 통과한다.
 *
 * 모든 로그인(소셜·데모)은 서버가 토큰을 body로 주는 **네이티브(Bearer)** 흐름 하나로
 * 통일돼 있다 — 쿠키를 쓰지 않는다(iOS와 동일). 자격증명은 안전 저장소(Keystore 기반
 * [SessionTokens])에 담는다.
 *
 * 세션을 바꾸는 모든 연산(복원·로그인·로그아웃)은 [mutex]로 **직렬화**한다. 포그라운드
 * 복귀마다 복원이 launch되므로, 직렬화가 없으면 두 복원이 같은 1회용 refresh 토큰으로
 * 동시에 갱신을 시도해(재사용 탐지) 세션을 잃거나, 지는 쪽이 상대가 방금 심은 토큰을 덮는다.
 */
class AuthManager(
    private val nativeApi: NativeAuthApi,
    private val tokens: SessionTokens,
    private val social: SocialSignIn = SocialSignIn.Unavailable,
    // 웹 redirect 로그인(Custom Tabs). 기본값은 "미설정"이라 native·데모만 동작한다.
    private val webAuth: WebAuth = WebAuth.Unavailable,
    /**
     * 선제 갱신 타이머가 사는 곳. AuthManager는 화면보다 오래 살아야 하므로(세션의 주인)
     * 기본값은 화면과 무관한 스코프다. 테스트가 가상 시계를 꽂을 수 있도록 열어 둔다.
     */
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) : SessionAuthority {
    sealed interface State {
        /** 저장된 토큰으로 세션을 확인하는 중(앱 시작 직후). */
        data object Checking : State
        data object SignedOut : State

        /**
         * @param generation 이 세션이 **몇 번째로 발급된 것인지**. 로그아웃 뒤 다시
         *   로그인하면 같은 사용자라도 값이 달라진다 — 화면이 세션에 묶여 있음을
         *   표현하는 유일한 수단이다(서버의 세션 id는 토큰 안에만 있어 앱이 모른다).
         *   복원·갱신은 **같은 세션을 잇는 것이므로 값을 바꾸지 않는다.**
         */
        data class SignedIn(val user: User, val generation: Long) : State
    }

    private var proactiveRefresh: Job? = null

    // 마지막으로 서버가 알려 준 액세스 토큰 수명. 회전 응답에도 실려 오므로 갱신할 때마다
    // 갱신된다.
    private var accessTokenTtlMs: Long = 0

    /**
     * 지금 세션의 **정체와 자격증명을 한 덩어리로** 들고 있는 표식.
     *
     * 둘을 따로 읽으면 그사이 세션이 갈려 "옛 토큰 + 새 표식"이 나올 수 있다 — 요청을
     * 보내려고 토큰을 읽은 직후 로그아웃·재로그인이 끝나는 경우다. 그 조합은 옛 요청을
     * 새 세션의 것으로 둔갑시킨다. 참조 하나를 한 번 읽어 둘을 같이 얻는다.
     *
     * @param mark 새 세션이 채택될 때마다 하나씩 오른다. 앞 세션의 화면 상태가 다음
     *   세션으로 넘어가지 않게 하는 것이 전부다 — 값 자체에는 의미가 없다. 회전은 같은
     *   세션을 잇는 것이라 값을 바꾸지 않는다.
     * @param issued 이 세션이 발급한 액세스 토큰들(최신이 앞). **회전으로 물러난 것도
     *   잠깐 남긴다**: 함께 나간 두 요청이 같은 토큰을 들고 있다가 하나가 먼저 회전시키면
     *   나머지는 이미 물러난 토큰을 들고 있는데, 그것을 "남의 세션"으로 보면 되살릴 수
     *   있는 401이 그냥 실패가 된다. 물러난 토큰은 이미 죽었으므로 기억해 둬도 새로 할 수
     *   있는 일이 없고, 세션이 갈리면 통째로 버린다.
     */
    private data class SessionStamp(val mark: Long, val issued: List<String>)

    // 요청을 보내는 아무 스레드에서나 락 없이 읽는다 — 참조 한 번 읽기라 찢어지지 않는다.
    // 쓰기는 전부 세션 연산(락 안)에서만 일어난다.
    @Volatile
    private var stamp = SessionStamp(0, listOfNotNull(tokens.access()))

    private val generation: Long get() = stamp.mark

    /** 여기부터는 **다른 세션**이다 — 표식을 올리고 발급 기록을 새로 시작한다. */
    private fun beginSession(accessToken: String?) {
        stamp = SessionStamp(stamp.mark + 1, listOfNotNull(accessToken))
    }

    /** 같은 세션 안에서 토큰만 갈렸다(회전) — 표식은 그대로, 물러난 토큰도 남긴다. */
    private fun rotatedTo(accessToken: String) {
        val current = stamp
        stamp = SessionStamp(
            current.mark,
            (listOf(accessToken) + current.issued).distinct().take(ISSUED_TOKEN_MEMORY),
        )
    }

    /**
     * 스스로 로그아웃한 것이 **아닌데** 로그인 화면으로 온 경우.
     *
     * 이유 없이 대시보드에서 튕기면 무슨 일이 일어난 건지 알 수 없다 — 로그인 화면이 이
     * 값을 보고 한 줄 알려 준다.
     *
     * **원인은 단정하지 않는다.** 서버는 폐기·만료·로그아웃을 모두 `UNAUTHORIZED` 하나로
     * 알려주므로(`jwt-auth.guard.ts`의 `findValid`가 null이면 셋 다다), "다른 기기에서
     * 해제됐다"고 말하면 단순 만료에도 없는 사실을 지어내게 된다.
     *
     * 반대로 **앱을 켤 때의 실패는 알리지 않는다.** 그 자리는 자격증명이 아예 없는 첫
     * 방문과 구분되지 않고(웹은 쿠키를 읽을 수 없어 원리적으로 그렇다), 처음 온 사람에게
     * 엉뚱한 안내가 뜬다. 알리는 것은 **쓰는 도중 세션이 끊긴 경우**뿐이다.
     *
     * 새 세션이 채택될 때 꺼진다(`adopt`) — 읽은 쪽이 따로 지울 것은 없다.
     */
    private val _endedUnexpectedly = MutableStateFlow(false)
    val endedUnexpectedly: StateFlow<Boolean> = _endedUnexpectedly.asStateFlow()

    private val _state = MutableStateFlow<State>(State.Checking)
    val state: StateFlow<State> = _state.asStateFlow()

    // 세션 연산을 한 번에 하나만 돌린다(중복 복원·경쟁 갱신 방지).
    private val mutex = Mutex()

    /**
     * 사용자가 로그아웃을 **누른 순간**부터 그 처리가 끝날 때까지 선다.
     *
     * 락을 기다리거나 서버 응답을 기다리는 동안 만료가 먼저 발견될 수 있다. 그때 안내를
     * 띄우면 **자기가 누른 버튼의 결과를 사고처럼 알리는 셈**이다. 그래서 의도를 기다리기
     * **전에** 세워 둔다 — 락을 잡은 뒤에 세우면 이미 늦다.
     */
    @Volatile
    private var signOutRequested = false

    /**
     * 저장된 Bearer 토큰으로 세션을 확인한다. 앱 시작·포그라운드 복귀에서 부른다.
     * 확정 실패(폐기·변조)만 토큰을 지우고, 일시적 실패(오프라인·5xx)는 보존해 다음에 복구한다.
     */
    suspend fun restoreSession() = mutex.withLock {
        val access = tokens.access()
        if (access == null) {
            cancelProactiveRefresh()
            _state.value = State.SignedOut
            return@withLock
        }
        try {
            val session = nativeApi.meBearer(access)
            accessTokenTtlMs = session.accessTokenTtlMs
            _state.value = State.SignedIn(session.user, generation)
            scheduleProactiveRefresh()
            AppLog.d("session restored")
        } catch (e: ApiError) {
            when {
                e.isSessionExpired -> refreshOrSignOut()
                e.isDefinitiveAuthFailure -> {
                    // 서버가 "이 세션은 못 쓴다"고 확정했다 — 폐기·변조. 토큰을 지운다.
                    AppLog.d("session invalidated by server — clearing tokens")
                    clearTokensAndSignOut()
                }
                else -> {
                    // 일시적 실패(오프라인·타임아웃·5xx·형식 오류) — 토큰은 **보존**한다.
                    // 지금은 확인이 안 되니 로그인 화면을 보이되, 다음 시도에서 복구될 수 있게 둔다.
                    AppLog.d("session check inconclusive — keeping tokens for retry")
                    cancelProactiveRefresh()
                    _state.value = State.SignedOut
                }
            }
        }
    }

    /**
     * 로그아웃 — 서버 세션을 폐기하고 토큰을 지운다.
     *
     * 두 성질을 **동시에** 만족해야 한다:
     *  - **락 안에서** 정리한다 — 락 밖에서 지우면, 로그아웃이 락을 놓은 직후 대기하던
     *    복원이 락을 잡아 아직 남은 토큰으로 `meBearer()`를 시작하고, 나중에 그 응답이
     *    SignedIn을 세팅해 "토큰 없는 SignedIn"으로 끝날 수 있다(경쟁).
     *  - **취소돼도** 정리한다 — 사용자가 로그아웃을 눌렀는데 화면 회전 등으로 코루틴이
     *    취소되면, 정리가 생략돼 남은 토큰으로 세션이 부활한다(보안).
     *
     * 그래서 전체를 [NonCancellable]로 감싸 락 획득·서버 호출·정리가 취소로 중단되지 않게
     * 하고, 정리는 락 안에서 한다. 서버 호출은 OkHttp callTimeout(30초)으로 상한이 있어
     * NonCancellable이어도 무한 대기하지 않는다.
     */
    suspend fun signOut() = withContext(NonCancellable) {
        // 락을 **기다리기 전에** 의도를 세운다(위 [signOutRequested] 설명).
        signOutRequested = true
        try {
            mutex.withLock {
                val access = tokens.access()
                if (access != null) {
                    try {
                        nativeApi.logoutBearer(access)
                    } catch (e: ApiError) {
                        AppLog.d("server logout failed — clearing local session anyway")
                    }
                }
                clearTokensAndSignOut()
            }
        } finally {
            signOutRequested = false
        }
    }

    /**
     * 소셜·데모 로그인. 모두 서버가 토큰을 body로 주는 네이티브(Bearer) 흐름으로 끝난다.
     *
     * 방식(method)이 둘이다(iOS와 동일):
     *  - NATIVE: provider 네이티브 SDK로 앱 안에서 토큰을 받아 서버에 보낸다(Google·Kakao).
     *    데모는 SDK 없이 서버가 시드 계정으로 바로 세션을 발급한다. Apple은 SDK가 없어 미지원.
     *  - REDIRECT: 시스템 브라우저 탭으로 서버 웹 OAuth(flow=native)를 열고 일회용 코드를
     *    받아 `exchangeNative`로 토큰과 교환한다 — SDK가 없는 Apple도 이 경로로 로그인된다.
     *
     * SDK UI·브라우저 탭은 Activity가 있어야 뜨므로 [activity]를 받는다. 데모(native)는 필요 없다.
     */
    suspend fun signIn(
        provider: AuthProvider,
        method: AuthMethod = AuthMethod.NATIVE,
        activity: Activity? = null,
    ) {
        if (method == AuthMethod.REDIRECT) {
            redirectSignIn(provider, activity)
            return
        }
        when (provider) {
            AuthProvider.DEMO -> mutex.withLock {
                adopt(nativeApi.demoNative())
                AppLog.d("demo session issued")
            }
            AuthProvider.GOOGLE -> nativeSignIn(activity) { act ->
                nativeApi.googleNative(social.googleIdToken(act))
            }
            AuthProvider.KAKAO -> nativeSignIn(activity) { act ->
                nativeApi.kakaoNative(social.kakaoAccessToken(act))
            }
            AuthProvider.APPLE -> {
                AppLog.d("apple native sign-in is not available on Android")
                throw ApiError.providerUnavailable
            }
        }
    }

    /**
     * 웹 redirect 로그인: (락 밖에서) 브라우저 탭으로 일회용 코드를 받아 토큰과 교환하고,
     * (락 안에서) 세션을 채택한다. 탭 상호작용은 오래 걸리므로 [mutex] 밖에서 한다.
     */
    private suspend fun redirectSignIn(provider: AuthProvider, activity: Activity?) {
        // Activity 없음(providerUnavailable) 판단은 webAuth 구현이 한다 — 취소는
        // CancellationException으로 위로 전파된다.
        val code = webAuth.signIn(provider, activity)
        val session = nativeApi.exchangeNative(code)
        mutex.withLock {
            adopt(session)
            AppLog.d("redirect session issued (${session.user.provider})")
        }
    }

    /**
     * 네이티브 로그인 공통 흐름: (락 밖에서) SDK로 토큰을 얻고 서버 세션을 받은 뒤,
     * (락 안에서) 토큰을 저장하고 상태를 전환한다.
     *
     * SDK UI 호출은 상호작용이라 오래 걸리므로 [mutex] 밖에서 한다 — 그동안 복원 등 다른
     * 세션 연산이 막히지 않게. 실제 세션 채택만 락 안에서 원자적으로 한다.
     */
    private suspend fun nativeSignIn(
        activity: Activity?,
        acquire: suspend (Activity) -> AuthSession,
    ) {
        val act = activity ?: throw ApiError.providerUnavailable
        val session = acquire(act) // SDK 취소는 CancellationException으로 위로 전파된다
        mutex.withLock {
            adopt(session)
            AppLog.d("native session issued (${session.user.provider})")
        }
    }

    /** 세션 채택 — Bearer 토큰을 저장하고 상태를 전환한다. 여기가 **새 세션의 시작**이다. */
    private fun adopt(session: AuthSession) {
        tokens.save(session.accessToken, session.refreshToken)
        beginSession(session.accessToken)
        accessTokenTtlMs = session.accessTokenTtlMs
        _endedUnexpectedly.value = false
        _state.value = State.SignedIn(session.user, generation)
        // 로그인 직후부터 세션이 밀리게 한다 — 다음 `/auth/me`까지 기다리지 않는다.
        scheduleProactiveRefresh()
    }

    /**
     * 액세스 토큰이 만료되기 **전에** 미리 세션을 회전한다.
     *
     * 401을 만나고 나서 갱신하는 것만으로는 부족하다: 요청이 없는 채로 놔둔 화면은 401을
     * 만날 일도 없어, idle 창이 지나면 세션이 조용히 죽는다. 화면을 열어 둔 동안 세션이
     * 밀리도록 수명의 [REFRESH_LEAD_RATIO] 지점에서 미리 돌린다(웹과 같은 규칙).
     *
     * 앱이 백그라운드에 있는 동안 타이머가 밀려도 손해가 없다 — 포그라운드로 돌아오면
     * `restoreSession()`이 다시 확인하고 여기를 새로 건다.
     */
    private fun scheduleProactiveRefresh() {
        proactiveRefresh?.cancel()
        val ttl = accessTokenTtlMs
        if (ttl <= 0) return
        // 예약을 건 **그 세션**의 표식을 함께 들고 간다 — 깨어났을 때 세션이 갈렸다면
        // 이 예약은 남의 것이다.
        val mark = generation
        var delayMs = maxOf((ttl * REFRESH_LEAD_RATIO).toLong(), MIN_REFRESH_DELAY_MS)
        proactiveRefresh = scope.launch {
            while (isActive) {
                delay(delayMs)
                if (mark != generation) return@launch
                val current = tokens.access() ?: return@launch
                // 반응형 경로와 같은 문을 쓴다 — 그사이 401이 먼저 갱신했다면 여기서는
                // 아무 요청도 나가지 않는다. 회전에 성공하면 rotate()가 이 자리를 새
                // 예약으로 갈아 끼우므로 여기서 물러난다.
                if (refreshForRetry(mark, current) != null) return@launch
                // 오프라인·5xx로 회전하지 못했을 뿐인데 여기서 놓아 버리면, 타이머는
                // 이미 소모됐고 아무도 다시 걸지 않아 **선제 갱신이 영영 멈춘다**.
                // 세션은 아직 살아 있으니 짧게 다시 시도한다.
                delayMs = RETRY_REFRESH_DELAY_MS
            }
        }
    }

    /** 세션이 끝났다 — 예약된 회전도 함께 거둔다. */
    private fun cancelProactiveRefresh() {
        proactiveRefresh?.cancel()
        proactiveRefresh = null
        accessTokenTtlMs = 0
    }

    /**
     * 401을 만난 요청을 위해 세션을 갱신한다 — 화면을 쓰는 도중 액세스 토큰이 만료되는
     * 흔한 경우다(앱 시작·복귀에서만 갱신하면 그 사이는 그냥 실패로 보인다).
     *
     * 여러 요청이 동시에 401을 받아도 **갱신은 한 번만** 나간다: 락을 잡은 뒤, 내가
     * 실패시킨 그 토큰이 이미 갈려 있으면 다른 요청이 갱신한 것이므로 그 결과를 쓴다.
     * 각자 갱신하면 회전한 refresh token으로 두 번째가 거부되어 멀쩡한 세션이 끊긴다.
     *
     * @return 재시도에 쓸 **새** 액세스 토큰. 갱신하지 못했으면 null — 토큰이 그대로면
     *   같은 401이 한 번 더 날 뿐이라 재시도하지 않는다.
     */
    override fun sessionMark(usedAccessToken: String): Long? {
        // 참조를 **한 번만** 읽는다 — 표식과 토큰이 같은 순간의 짝이어야 한다.
        val current = stamp
        return if (usedAccessToken in current.issued) current.mark else null
    }

    override suspend fun refreshForRetry(mark: Long, usedAccessToken: String): String? =
        mutex.withLock {
            // 요청을 보낸 그 세션이 아직 살아 있을 때만 손댄다 — 그사이 로그아웃하고 다시
            // 로그인했다면 이 요청은 **남의 세션**이다(토큰 비교만으로는 회전과 구분되지 않아
            // 옛 요청이 새 계정에서 재생될 수 있었다).
            if (mark != generation) return@withLock null
            val current = tokens.access()
            // 같은 세션 안에서 다른 요청이 이미 회전시켰다면 그 결과를 쓴다.
            if (current != null && current != usedAccessToken) return@withLock current
            when (rotate()) {
                RotateOutcome.ROTATED -> tokens.access()?.takeIf { it != usedAccessToken }
                // 확정 거부는 세션이 끝난 것이다 — 자격증명을 지우고 로그인 화면으로.
                // **쓰는 도중** 끊긴 것이므로 이유도 함께 남긴다: 대시보드를 보고 있다가
                // 아무 말 없이 로그인 화면으로 돌아가면 이동이 실패한 것처럼 보인다.
                RotateOutcome.REJECTED -> {
                    clearTokensAndSignOut()
                    null
                }
                // 오프라인·5xx 같은 일시적 실패로 **로그인 화면으로 쫓아내지 않는다.**
                // 자격증명은 아직 살아 있을 수 있고, 화면은 오류만 보여 주면 된다.
                RotateOutcome.INCONCLUSIVE -> null
            }
        }

    /**
     * 서버가 **확정한** 인증 실패를 받았다 — 다른 기기에서 이 세션을 해제한 경우가 대표적이다.
     *
     * 화면이 "불러오지 못했습니다"를 띄우고 마는 대신 여기서 정리한다: 자격증명은 이미
     * 죽었으므로 지우고 로그인 화면으로 보낸다. **서버에 로그아웃을 부르지 않는다** —
     * 세션은 이미 서버에서 사라졌다.
     */
    override suspend fun endSession(mark: Long, usedAccessToken: String) = mutex.withLock {
        // 그사이 세션이 갈렸다면 낡은 응답이 새 세션을 끊어서는 안 된다.
        if (mark != generation || tokens.access() != usedAccessToken) return@withLock
        AppLog.d("session rejected by the server — signing out")
        clearTokensAndSignOut()
    }

    /** 갱신 한 번의 결과. 무엇을 할지는 **부르는 쪽**이 정한다 — 자리마다 답이 다르다. */
    private enum class RotateOutcome { ROTATED, REJECTED, INCONCLUSIVE }

    /**
     * 리프레시 자격증명을 회전한다. 성공하면 새 토큰을 저장하고 세션을 잇는다.
     *
     * **상태를 로그아웃으로 바꾸지 않는다.** 실패를 어떻게 다룰지는 자리마다 다르기
     * 때문이다: 앱 시작의 복원은 확인이 안 되면 로그인 화면을 보여야 하지만, 쓰는 도중의
     * 갱신은 잠깐 끊긴 것만으로 사용자를 쫓아내면 안 된다.
     */
    private suspend fun rotate(): RotateOutcome {
        val refresh = tokens.refresh() ?: return RotateOutcome.REJECTED
        return try {
            val session = nativeApi.refreshBearer(refresh)
            tokens.save(session.accessToken, session.refreshToken)
            rotatedTo(session.accessToken)
            accessTokenTtlMs = session.accessTokenTtlMs
            scheduleProactiveRefresh()
            // 토큰만 갈렸을 뿐 세션은 그대로다 — generation을 올리면 화면이 통째로
            // 다시 만들어져, 갱신이 일어날 때마다 목록이 깜빡인다.
            _state.value = State.SignedIn(session.user, generation)
            AppLog.d("session refreshed")
            RotateOutcome.ROTATED
        } catch (e: ApiError) {
            if (e.isDefinitiveAuthFailure) {
                AppLog.d("refresh rejected")
                RotateOutcome.REJECTED
            } else {
                AppLog.d("refresh inconclusive — keeping tokens for retry")
                RotateOutcome.INCONCLUSIVE
            }
        }
    }

    /** 복원 경로의 갱신 — 확인이 안 되면 로그인 화면을 보인다(자격증명은 보존). */
    private suspend fun refreshOrSignOut() {
        when (rotate()) {
            RotateOutcome.ROTATED -> Unit
            RotateOutcome.REJECTED -> {
                AppLog.d("refresh rejected — clearing tokens")
                clearTokensAndSignOut()
            }
            RotateOutcome.INCONCLUSIVE -> {
                cancelProactiveRefresh()
                _state.value = State.SignedOut
            }
        }
    }

    /**
     * 세션이 **확정적으로** 끝났다 — 자격증명을 지우고 로그인 화면으로 보낸다.
     *
     * 알릴지는 **어느 경로가 발견했는지가 아니라 무엇을 보고 있었는지**로 정한다. 같은
     * 만료를 복원·예약 타이머·화면 요청이 동시에 발견할 수 있어, 경로로 정하면 누가 먼저
     * 처리하느냐에 따라 같은 상황이 조용했다 시끄러웠다 한다(실제로 그랬다). 지금 보고
     * 있던 것이 로그인된 화면이었을 때만 설명이 필요하다 — 앱을 켜자마자 실패한 것은
     * 자격증명이 아예 없는 첫 방문과 같은 화면이라 알릴 일이 아니다.
     *
     * **확인이 안 된 것(오프라인·5xx)에는 쓰지 않는다.** 세션이 끝났다고 말할 수 없다.
     */
    private fun clearTokensAndSignOut() {
        val wasSignedIn = _state.value is State.SignedIn
        tokens.clear()
        cancelProactiveRefresh()
        // 세션이 끝났으니 표식도 넘긴다 — 아직 떠 있는 옛 요청의 응답이 돌아와도
        // 다음 세션을 건드리지 못한다.
        beginSession(null)
        when {
            // 스스로 누른 로그아웃이다 — 그 사이 다른 경로가 먼저 올려 둔 안내도 내린다.
            signOutRequested -> _endedUnexpectedly.value = false
            wasSignedIn -> _endedUnexpectedly.value = true
        }
        _state.value = State.SignedOut
    }

    private companion object {
        // 남은 수명의 이 비율에서 미리 회전한다. 0.75면 15분 토큰을 ~11분에 갱신해,
        // 네트워크 지연·시계 오차가 있어도 만료 전에 여유가 있다(웹과 같은 값).
        const val REFRESH_LEAD_RATIO = 0.75

        // 아주 짧은 수명·시계 튐에 스케줄이 과도하게 촘촘해지지 않게 하는 하한.
        const val MIN_REFRESH_DELAY_MS = 30_000L

        // 일시적 실패로 회전하지 못했을 때 다시 시도하는 간격. 오프라인이 길어져도
        // 분당 한 번이라 부담이 없고, 연결이 돌아오면 그 안에 세션이 다시 밀린다.
        const val RETRY_REFRESH_DELAY_MS = 60_000L

        // 회전으로 물러난 토큰을 몇 개까지 기억할지. 한 번의 401 무리에서 회전은 한 번만
        // 나가므로(락) 하나면 대개 충분하고, 선제 회전이 겹칠 때를 위해 여유를 둔다.
        const val ISSUED_TOKEN_MEMORY = 3
    }
}
