package kr.hs.jung.prism.feature.auth.social

import android.app.Activity
import com.kakao.sdk.auth.model.OAuthToken
import com.kakao.sdk.common.model.AuthError
import com.kakao.sdk.common.model.ClientError
import com.kakao.sdk.common.model.ClientErrorCause
import com.kakao.sdk.user.UserApiClient
import com.kakao.sdk.common.model.ApiError as KakaoApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.util.AppLog
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Kakao 네이티브 로그인 — 카카오톡 앱 로그인을 먼저 시도하고, 불가/실패 시 카카오계정
 * 웹 로그인으로 폴백한다(Kakao 표준 패턴). 결과 [OAuthToken.accessToken]을 서버에 보낸다.
 *
 * SDK는 앱 시작 시 `KakaoSdk.init(context, nativeAppKey)`로 초기화돼 있어야 한다
 * (PrismApplication). access token은 서명 없는 불투명 문자열이라, 서버가 access_token_info로
 * 발급 앱(app_id)을 대조해 검증한다(plan/auth.md §5).
 */
class KakaoSignInClient {

    suspend fun accessToken(activity: Activity): String =
        suspendCancellableCoroutine { cont ->
            // 카카오톡 앱 로그인은 취소를 제외한 오류 시 계정 로그인으로 폴백한다.
            val talkCallback: (OAuthToken?, Throwable?) -> Unit = { token, error ->
                when {
                    error != null -> {
                        if (error is ClientError && error.reason == ClientErrorCause.Cancelled) {
                            cont.resumeWithException(CancellationException("kakao login cancelled"))
                        } else {
                            AppLog.d(
                                "kakaotalk login failed (${describe(error)}) — falling back to account",
                            )
                            UserApiClient.instance.loginWithKakaoAccount(
                                activity,
                                callback = accountCallback(cont),
                            )
                        }
                    }
                    token != null -> cont.resume(token.accessToken)
                    else -> cont.resumeWithException(ApiError.invalidResponse)
                }
            }

            if (UserApiClient.instance.isKakaoTalkLoginAvailable(activity)) {
                UserApiClient.instance.loginWithKakaoTalk(activity, callback = talkCallback)
            } else {
                UserApiClient.instance.loginWithKakaoAccount(
                    activity,
                    callback = accountCallback(cont),
                )
            }
        }

    private fun accountCallback(
        cont: kotlinx.coroutines.CancellableContinuation<String>,
    ): (OAuthToken?, Throwable?) -> Unit = { token, error ->
        when {
            error != null -> {
                if (error is ClientError && error.reason == ClientErrorCause.Cancelled) {
                    cont.resumeWithException(CancellationException("kakao login cancelled"))
                } else {
                    // Kakao SDK 오류 객체(스택·응답 본문)는 라이브러리 제어라 남기지 않는다 —
                    // SDK가 정의한 원인 enum만 남긴다(사용자 데이터가 아니고, 키 해시 미등록
                    // 같은 설정 오류와 일시적 실패를 가르는 유일한 단서다).
                    AppLog.e("kakao account login failed (${describe(error)})")
                    cont.resumeWithException(
                        ApiError(0, kr.hs.jung.prism.domain.model.AuthErrorCode.SIGNIN_FAILED),
                    )
                }
            }
            token != null -> cont.resume(token.accessToken)
            else -> cont.resumeWithException(ApiError.invalidResponse)
        }
    }

    /**
     * Kakao 오류를 로그에 남길 **카테고리 문자열**로 줄인다 — SDK가 정의한 enum과 상태
     * 코드만 쓰고, 응답 본문·메시지는 담지 않는다(무엇을 남기지 않는가가 규칙의 절반이다).
     */
    private fun describe(error: Throwable): String = when (error) {
        is ClientError -> "ClientError:${error.reason}"
        is AuthError -> "AuthError:${error.reason}/${error.statusCode}${detail(error)}"
        is KakaoApiError -> "ApiError:${error.reason}/${error.statusCode}"
        else -> error.javaClass.simpleName
    }

    /**
     * 응답에서 **식별자만** 뽑는다 — OAuth `error` 값과 Kakao 오류 코드(`KOEnnn`)뿐이고,
     * 설명 본문은 남기지 않는다.
     *
     * `reason`만으로는 부족하다: 카카오톡 앱 로그인은 콘솔 설정 문제를 redirect(302)로
     * 돌려주는데, SDK가 그 `error` 문자열을 아는 원인으로 매핑하지 못하면 `Unknown`이 되어
     * 무엇이 잘못됐는지가 전부 사라진다. 그때 남는 단서가 이 둘이다.
     */
    private fun detail(error: AuthError): String {
        val koe = KOE_CODE.find("${error.response.errorDescription}")?.value
        return "/${error.response.error}" + koe?.let { "/$it" }.orEmpty()
    }

    private companion object {
        val KOE_CODE = Regex("KOE\\d+")
    }
}
