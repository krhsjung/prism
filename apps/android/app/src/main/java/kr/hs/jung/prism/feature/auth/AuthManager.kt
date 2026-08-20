package kr.hs.jung.prism.feature.auth

import android.app.Activity
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kr.hs.jung.prism.core.network.ApiError
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
) {
    sealed interface State {
        /** 저장된 토큰으로 세션을 확인하는 중(앱 시작 직후). */
        data object Checking : State
        data object SignedOut : State
        data class SignedIn(val user: User) : State
    }

    private val _state = MutableStateFlow<State>(State.Checking)
    val state: StateFlow<State> = _state.asStateFlow()

    // 세션 연산을 한 번에 하나만 돌린다(중복 복원·경쟁 갱신 방지).
    private val mutex = Mutex()

    /**
     * 저장된 Bearer 토큰으로 세션을 확인한다. 앱 시작·포그라운드 복귀에서 부른다.
     * 확정 실패(폐기·변조)만 토큰을 지우고, 일시적 실패(오프라인·5xx)는 보존해 다음에 복구한다.
     */
    suspend fun restoreSession() = mutex.withLock {
        val access = tokens.access()
        if (access == null) {
            _state.value = State.SignedOut
            return@withLock
        }
        try {
            _state.value = State.SignedIn(nativeApi.meBearer(access).user)
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

    /** 세션 채택 — Bearer 토큰을 저장하고 상태를 전환한다. */
    private fun adopt(session: AuthSession) {
        tokens.save(session.accessToken, session.refreshToken)
        _state.value = State.SignedIn(session.user)
    }

    /** 갱신 성공이면 새 토큰으로 세션을 잇고, 확정 실패면 토큰을 지운다. 일시적 실패면 보존한다. */
    private suspend fun refreshOrSignOut() {
        val refresh = tokens.refresh()
        if (refresh == null) {
            clearTokensAndSignOut()
            return
        }
        try {
            val session = nativeApi.refreshBearer(refresh)
            tokens.save(session.accessToken, session.refreshToken)
            _state.value = State.SignedIn(session.user)
            AppLog.d("session refreshed")
        } catch (e: ApiError) {
            if (e.isDefinitiveAuthFailure) {
                AppLog.d("refresh rejected — clearing tokens")
                clearTokensAndSignOut()
            } else {
                AppLog.d("refresh inconclusive — keeping tokens for retry")
                _state.value = State.SignedOut
            }
        }
    }

    private fun clearTokensAndSignOut() {
        tokens.clear()
        _state.value = State.SignedOut
    }
}
