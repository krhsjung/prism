package kr.hs.jung.prism.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import kr.hs.jung.prism.core.di.ServiceContainer
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.feature.auth.AuthManager
import kr.hs.jung.prism.feature.auth.LoginScreen
import kr.hs.jung.prism.ui.main.SignedInScreen
import androidx.compose.runtime.rememberCoroutineScope

/**
 * 인증 상태가 화면을 고르는 자리.
 *
 * 시작이 `Checking`인 것이 중요하다 — 쿠키가 있다는 사실만으로 로그인된 화면을 그리면,
 * 원격에서 폐기된 세션이 한 프레임 통과한다(plan/auth.md §6: 세션의 진실은 서버에 있다).
 */
@Composable
fun RootScreen(container: ServiceContainer) {
    val auth = container.authManager
    val state by auth.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // 앱 시작·포그라운드 복귀마다 저장된 쿠키로 세션을 확인한다 — 백그라운드에 있는 동안
    // 세션이 만료되거나 다른 기기에서 폐기될 수 있다. restoreSession은 멱등하므로(쿠키가
    // 없으면 즉시 SignedOut) 매 resume 호출이 안전하다.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { scope.launch { auth.restoreSession() } }

    Box(modifier = Modifier.fillMaxSize().background(PrismTheme.colors.surface)) {
        when (val current = state) {
            is AuthManager.State.Checking ->
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            is AuthManager.State.SignedOut ->
                LoginScreen(auth, container.themeStore, container.localeStore)
            is AuthManager.State.SignedIn ->
                SignedInScreen(
                    user = current.user,
                    themeStore = container.themeStore,
                    localeStore = container.localeStore,
                    onSignOut = { scope.launch { auth.signOut() } },
                )
        }
    }
}
