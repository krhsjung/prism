package kr.hs.jung.prism.core.di

import android.content.Context
import kr.hs.jung.prism.BuildConfig
import kr.hs.jung.prism.core.i18n.LocaleStore
import kr.hs.jung.prism.core.network.ApiClient
import kr.hs.jung.prism.core.security.SecureSessionTokens
import kr.hs.jung.prism.core.security.SecureStore
import kr.hs.jung.prism.core.theme.ThemeStore
import kr.hs.jung.prism.feature.auth.AuthManager
import kr.hs.jung.prism.feature.auth.CustomTabsWebAuth
import kr.hs.jung.prism.feature.auth.HttpAuthApi
import kr.hs.jung.prism.feature.auth.social.AndroidSocialSignIn
import kr.hs.jung.prism.feature.auth.social.GoogleSignInClient
import kr.hs.jung.prism.feature.auth.social.KakaoSignInClient

/**
 * 앱의 의존성을 한 번만 만들고 이어 주는 곳.
 *
 * 각 타입이 싱글턴을 하나씩 들고 있으면 생성 순서가 코드 전체에 흩어지고, 테스트에서
 * 갈아 끼울 자리가 없어진다. 조립은 여기 한 곳에서만 한다(iOS ServiceContainer와 같은 역할).
 *
 * ```text
 * SecureStore → SessionTokens ─┐
 *                    ApiClient → HttpAuthApi ─┐
 *   GoogleSignInClient + KakaoSignInClient → AndroidSocialSignIn ─┴→ AuthManager
 * ```
 */
class ServiceContainer(context: Context) {
    private val secureStore = SecureStore(context)
    private val sessionTokens = SecureSessionTokens(secureStore)
    // 태블릿은 `Mobile` 토큰을 빼서 알린다 — 브라우저가 쓰는 구분과 같다.
    // 600dp는 Android가 태블릿 레이아웃을 가르는 관례적 경계다.
    private val isTablet = context.resources.configuration.smallestScreenWidthDp >= 600
    private val apiClient = ApiClient(
        userAgent = if (isTablet) "Prism (Android)" else "Prism (Android; Mobile)",
    )
    private val authApi = HttpAuthApi(apiClient)

    // 네이티브 소셜 로그인 클라이언트. 키가 비어 있으면 각 클라이언트가 providerUnavailable로
    // 막으므로(데모는 계속 동작), 키 미설정 빌드도 부팅에는 문제가 없다.
    private val social = AndroidSocialSignIn(
        google = GoogleSignInClient(BuildConfig.GOOGLE_SERVER_CLIENT_ID),
        kakao = KakaoSignInClient(),
    )

    val authManager = AuthManager(
        nativeApi = authApi,
        tokens = sessionTokens,
        social = social,
        // 웹 redirect(flow=native)를 브라우저 탭으로 연다. base URL은 API 주소와 같다.
        webAuth = CustomTabsWebAuth(BuildConfig.PRISM_API_URL),
    )
    val themeStore = ThemeStore(context)
    val localeStore = LocaleStore(context)
}
