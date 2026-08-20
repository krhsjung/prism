package kr.hs.jung.prism.feature.auth.social

import android.app.Activity
import kr.hs.jung.prism.core.network.ApiError

/**
 * provider 네이티브 SDK 로그인의 추상화 — 서버에 보낼 **토큰만** 얻어 온다.
 *
 * `AuthManager`가 구체 SDK가 아니라 이 인터페이스에 의존해, SDK 없이도 로직을 테스트할 수
 * 있고 provider별 SDK 세부는 이 아래에 격리된다. 반환값은 서버 `/auth/{provider}/native`가
 * 검증할 자격증명이다: Google=id_token, Kakao=access token.
 *
 * SDK UI(계정 선택·동의)는 Activity가 있어야 뜨므로 [activity]를 받는다. 사용자가 취소하면
 * `kotlinx.coroutines.CancellationException`을 던진다(오류가 아니라 조용한 복귀).
 */
interface SocialSignIn {
    suspend fun googleIdToken(activity: Activity): String
    suspend fun kakaoAccessToken(activity: Activity): String

    /** SDK/키 미설정 시의 기본 — 네이티브 경로를 막는다(데모만 동작). */
    object Unavailable : SocialSignIn {
        override suspend fun googleIdToken(activity: Activity): String =
            throw ApiError.providerUnavailable
        override suspend fun kakaoAccessToken(activity: Activity): String =
            throw ApiError.providerUnavailable
    }
}

/** Google/Kakao 클라이언트를 묶은 실제 구현. */
class AndroidSocialSignIn(
    private val google: GoogleSignInClient,
    private val kakao: KakaoSignInClient,
) : SocialSignIn {
    override suspend fun googleIdToken(activity: Activity): String = google.idToken(activity)
    override suspend fun kakaoAccessToken(activity: Activity): String = kakao.accessToken(activity)
}
