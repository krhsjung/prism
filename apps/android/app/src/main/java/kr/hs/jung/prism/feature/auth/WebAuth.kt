package kr.hs.jung.prism.feature.auth

import android.app.Activity
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.domain.model.AuthProvider

/**
 * 웹 OAuth(redirect) 로그인의 추상화 — 서버에 보낼 **일회용 코드**만 받아 온다.
 *
 * `AuthManager`가 구체 구현이 아니라 이 인터페이스에 의존해, 브라우저 없이도 로직을
 * 테스트할 수 있다. 반환값은 서버 콜백이 커스텀 스킴으로 돌려준 코드이며,
 * `NativeAuthApi.exchangeNative`로 토큰과 교환한다. 사용자가 탭을 닫으면 취소
 * (`CancellationException`)로 위에 전파된다 — 오류가 아니라 조용한 복귀(iOS와 같은 규칙).
 */
interface WebAuth {
    /** [activity]가 있어야 브라우저 탭을 띄운다 — 없으면 각 구현이 providerUnavailable로 막는다. */
    suspend fun signIn(provider: AuthProvider, activity: Activity?): String

    /** SDK/서버 경로가 없다고 가정하는 기본(주로 테스트) — redirect 경로를 막는다. */
    object Unavailable : WebAuth {
        override suspend fun signIn(provider: AuthProvider, activity: Activity?): String =
            throw ApiError.providerUnavailable
    }
}

/**
 * 진행 중인 웹 인증 하나의 결과를 [WebAuthActivity](콜백 캡처)와 코루틴 사이에 잇는 다리.
 *
 * 세션 연산은 [AuthManager]가 mutex로 직렬화하므로 한 번에 하나만 진행한다 — 그래서
 * 프로세스 전역에 in-flight 하나만 둔다. Activity는 [AuthManager]를 직접 참조할 수 없어
 * (매니페스트가 만드는 진입점) 이 오브젝트로 코드를 되돌려 준다.
 */
object WebAuthCoordinator {
    private var pending: CompletableDeferred<String>? = null

    fun start(): CompletableDeferred<String> =
        CompletableDeferred<String>().also { pending = it }

    fun deliverCode(code: String) {
        pending?.complete(code)
        pending = null
    }

    fun deliverError() {
        pending?.completeExceptionally(ApiError(0, kr.hs.jung.prism.domain.model.AuthErrorCode.SIGNIN_FAILED))
        pending = null
    }

    fun cancel() {
        pending?.completeExceptionally(CancellationException("web auth cancelled"))
        pending = null
    }

    /** 코루틴이 취소돼 더는 결과를 기다리지 않을 때, 내가 만든 슬롯만 정리한다. */
    fun clearIf(deferred: CompletableDeferred<String>) {
        if (pending === deferred) pending = null
    }
}

/**
 * 시스템 브라우저 탭(Custom Tabs)으로 서버 웹 OAuth(flow=native)를 여는 구현.
 *
 * 서버가 provider로 redirect하고, 콜백에서 쿠키/웹 페이지가 아니라 커스텀 스킴
 * (`prism://auth/callback?code=…`)으로 일회용 코드를 돌려준다. 그 스킴은
 * [WebAuthActivity]가 매니페스트 intent-filter로 잡아 [WebAuthCoordinator]에 넘긴다.
 */
class CustomTabsWebAuth(private val baseUrl: String) : WebAuth {
    override suspend fun signIn(provider: AuthProvider, activity: Activity?): String {
        val act = activity ?: throw ApiError.providerUnavailable
        val deferred = WebAuthCoordinator.start()
        // 서버 provider 슬러그는 소문자(google/apple/kakao). 데모는 웹 OAuth가 아니라 여기 오지 않는다.
        val url = "$baseUrl/auth/${provider.name.lowercase()}?flow=native"
        act.startActivity(WebAuthActivity.intent(act, url))
        return try {
            deferred.await()
        } finally {
            WebAuthCoordinator.clearIf(deferred)
        }
    }

    companion object {
        fun launch(activity: Activity, url: String) {
            CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(url))
        }
    }
}
