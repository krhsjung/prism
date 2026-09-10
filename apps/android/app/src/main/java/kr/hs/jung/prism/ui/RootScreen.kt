package kr.hs.jung.prism.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import kr.hs.jung.prism.core.di.ServiceContainer
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.feature.auth.AuthManager
import kr.hs.jung.prism.feature.auth.LoginScreen
import kr.hs.jung.prism.feature.call.CallController
import kr.hs.jung.prism.feature.call.IncomingCallDialog
import kr.hs.jung.prism.feature.call.rememberCallPermission
import kr.hs.jung.prism.feature.call.WebRtcScreen
import kr.hs.jung.prism.feature.dashboard.DashboardScreen
import kr.hs.jung.prism.core.push.PushLinks
import kr.hs.jung.prism.feature.push.PushScreen
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
                LoginScreen(
                    auth,
                    container.themeStore,
                    container.localeStore,
                )
            }
            is AuthManager.State.SignedIn -> {
                // 로그인 뒤의 화면 상태는 **이 세션의 것**이다. 세션이 끝나면 함께 버리고,
                // 다시 로그인하면 새로 만든다 — 그러지 않으면 앞 세션의 목록이 그대로
                // 그려진다(ui/SessionScope.kt).
                SessionScope(current.generation) {
                    SignedIn(container, current)
                }
            }
        }
    }
}

/**
 * 로그인해 있는 동안의 화면들.
 *
 * 소켓도 통화도 **이 세션의 것**이다 — 세대가 바뀌면 함께 버려지고 새로 만들어진다.
 * 컨테이너에 두면 앱과 함께 살아 세션 N의 것이 세션 N+1까지 살아남는다.
 */
@Composable
private fun SignedIn(container: ServiceContainer, current: AuthManager.State.SignedIn) {
    // 이 기기가 **받기로 해 뒀으면** 조용히 다시 붙인다(§5-16).
    //
    // 등록은 세션에 붙어 로그아웃과 함께 사라진다. 그때마다 사람이 다시 누르게 하면
    // 토글이 "켜 두는 것"이 아니라 "매번 켜는 것"이 된다. 권한 창은 뜨지 않는다 —
    // 이미 허용된 경우에만 토큰을 받는다. 회전된 토큰도 여기서 함께 낫는다.
    LaunchedEffect(Unit) {
        val push = container.pushTokens
        if (!push.wanted() || !push.enabled || !push.permissionGranted()) return@LaunchedEffect
        val fcm = push.current() ?: return@LaunchedEffect
        val access = container.sessionTokens.access() ?: return@LaunchedEffect
        // 실패해도 화면은 사실을 말한다 — 그 줄이 `Notifications off`로 남는다.
        runCatching { container.pushApi.register(access, fcm) }
    }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val socket = remember(current.generation) { container.createSessionSocket() }
    // 통화는 소켓 위에 얹힌다 — 소켓의 통화 수신구를 컨트롤러가 가져가므로 듣는 쪽이
    // 하나여야 한다(SessionSocket.onCallMessage).
    val call = remember(current.generation) { CallController(context, socket) }
    DisposableEffect(call) { onDispose { call.dispose() } }

    // 소켓은 **앱이 앞에 있는 동안** 열려 있다. 세 플랫폼이 같은 규칙을 쓴다:
    // *클라이언트가 실제로 살아 있는 동안 붙어 있고, 없으면 푸시로 깨운다*(plan/webrtc.md §4).
    // 브라우저 탭은 숨어도 살아 있어 웹은 계속 붙어 있지만(`SessionSocketProvider`),
    // 모바일은 OS가 앱을 재운다.
    //
    // ⚠️ **백그라운드에서 붙들고 있으려 하지 않는다.** 실제로 재 보니 홈으로 내린 뒤
    // 4초 만에 연결이 끊기고, 그 뒤로는 `connecting → 즉시 종료`를 되풀이하는 재시도
    // 폭풍만 남았다(서버에 presence를 지켜 주지도 못하면서 배터리를 쓴다). 스스로 닫으면
    // 서버가 TTL을 기다리지 않고 presence를 지우고, 다른 기기의 목록이 곧바로 정확해진다 —
    // iOS `RootView`가 같은 이유로 같은 일을 한다.
    LifecycleStartEffect(socket) {
        socket.start(scope)
        onStopOrDispose {
            // **끊고 나서 닫는다 — 순서가 핵심이다.** 먼저 닫으면 `hangup`이 나갈 통로가
            // 없어, 서버가 상대에게 `peer-gone`을 보내 끝낸 통화를 이쪽만 붙들고 있게 된다
            // (돌아왔을 때 끊을 방법도 없다). 백그라운드에서는 카메라도 멈춰 통화가
            // 성립하지 않는다.
            if (call.state.value.call != null) call.hangUp()
            socket.stop()
        }
    }

    val callState by call.state.collectAsStateWithLifecycle()
    // 수락도 **통화가 시작되는 순간**이다 — `Call`·`Test`와 같은 문을 지나야 한다.
    // 이것 없이 컨트롤러를 바로 부르면, 아직 권한이 없는 기기에서 수락이 조용히
    // 거절로 끝난다(화면에는 "받기를 눌렀는데 거절됐다"로 보인다).
    val withMedia = rememberCallPermission(call)
    // 지금 보고 있는 페이지. **웹의 라우터가 앉는 자리**다 — 셸이 두 화면을 나눠 쓰므로
    // 어느 쪽인지는 셸 바깥(여기)에서 쥔다.
    var page by remember { mutableStateOf(ShellPage.DASHBOARD) }
    // 드로어는 두 화면이 **하나를 나눠 쓴다** — 페이지마다 따로 두면 옮겨 간 화면의
    // 드로어가 닫힌 채로 새로 서서 애니메이션이 끊긴다.
    val drawerState = rememberDrawerState(DrawerValue.Closed)

    // 옮겨 간 뒤 드로어를 닫는다. **화면이 아니라 여기서** 닫는 이유: 화면의 스코프는
    // 페이지가 바뀌는 순간 함께 취소되어, 거기서 시작한 닫기가 중간에 죽는다.
    LaunchedEffect(page) { drawerState.close() }

    // 알림을 눌러 들어왔다 — 통화 화면으로 옮기고 **이 통화가 아직 살아 있나**를 묻는다.
    //
    // 소켓이 붙은 뒤에야 물을 수 있다(`socketReady`). 살아 있으면 벨이 다시 울리고,
    // 아니면 `Call expired`를 본다 — 그것이 푸시 경로의 정상 결말이다(§8-10).
    // 값은 **한 번만** 소비한다 — 남겨 두면 화면을 되돌아올 때마다 다시 물어본다.
    val pendingCallId by PushLinks.pendingCallId.collectAsStateWithLifecycle()
    val socketReady by socket.isReady.collectAsStateWithLifecycle()
    LaunchedEffect(pendingCallId, socketReady) {
        val callId = pendingCallId ?: return@LaunchedEffect
        if (!socketReady) return@LaunchedEffect
        page = ShellPage.WEBRTC
        call.resumeCall(callId)
        PushLinks.consume()
    }

    // 수락은 대시보드에서도 일어난다 — 통화는 통화 화면에서 그린다.
    LaunchedEffect(callState.wantsCallScreen) {
        if (callState.wantsCallScreen) {
            page = ShellPage.WEBRTC
            call.consumeCallScreenRequest()
        }
    }

    when (page) {
        ShellPage.DASHBOARD -> DashboardScreen(
            user = current.user,
            themeStore = container.themeStore,
            localeStore = container.localeStore,
            sessionsApi = container.sessionsApi,
            tokens = container.sessionTokens,
            socket = socket,
            drawerState = drawerState,
            onNavigate = { page = it },
            onSignOut = { scope.launch { container.authManager.signOut() } },
        )
        ShellPage.PUSH -> PushScreen(
            user = current.user,
            themeStore = container.themeStore,
            localeStore = container.localeStore,
            sessionsApi = container.sessionsApi,
            pushApi = container.pushApi,
            pushTokens = container.pushTokens,
            tokens = container.sessionTokens,
            drawerState = drawerState,
            onNavigate = { page = it },
            onSignOut = { scope.launch { container.authManager.signOut() } },
        )
        ShellPage.WEBRTC -> WebRtcScreen(
            user = current.user,
            controller = call,
            socket = socket,
            themeStore = container.themeStore,
            localeStore = container.localeStore,
            drawerState = drawerState,
            sessionsApi = container.sessionsApi,
            tokens = container.sessionTokens,
            onNavigate = { page = it },
            onSignOut = { scope.launch { container.authManager.signOut() } },
        )
    }

    // 걸려 온 통화는 **앱 위에** 뜬다 — 대시보드를 보고 있어도 마찬가지다(§4).
    // 소켓이 세션 전체에 붙어 있는 것과 같은 이유다.
    callState.incoming?.let { incoming ->
        IncomingCallDialog(
            from = incoming.from,
            onAccept = { withMedia { call.acceptIncoming() } },
            onDecline = call::declineIncoming,
        )
    }
}
