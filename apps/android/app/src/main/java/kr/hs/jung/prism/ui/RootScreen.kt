package kr.hs.jung.prism.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import kr.hs.jung.prism.feature.dashboard.DashboardScreen
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
            is AuthManager.State.SignedOut -> {
                // 세션이 끝났으니 그 세션의 화면 상태도 지금 버린다 — 다음 로그인까지
                // 들고 있으면 끝난 세션의 ViewModel이 로그인 화면 내내 살아 있다.
                ClearSessionScope()
                LoginScreen(auth, container.themeStore, container.localeStore)
            }
            is AuthManager.State.SignedIn -> {
                // 로그인 뒤의 화면 상태는 **이 세션의 것**이다. 세션이 끝나면 함께 버리고,
                // 다시 로그인하면 새로 만든다 — 그러지 않으면 앞 세션의 목록이 그대로
                // 그려진다(ui/SessionScope.kt).
                SessionScope(current.generation) {
                    // 소켓도 **이 세션의 것**이다 — 세대가 바뀌면 ViewModel과 함께
                    // 버려지고 새로 만들어진다. 컨테이너에 두면 앱과 함께 살아
                    // 세션 N의 소켓이 세션 N+1까지 살아남는다.
                    val socket = remember(current.generation) {
                        container.createSessionSocket()
                    }
                    DashboardScreen(
                        user = current.user,
                        themeStore = container.themeStore,
                        localeStore = container.localeStore,
                        sessionsApi = container.sessionsApi,
                        tokens = container.sessionTokens,
                        socket = socket,
                        onSignOut = { scope.launch { auth.signOut() } },
                    )
                }
            }
        }
    }
}
