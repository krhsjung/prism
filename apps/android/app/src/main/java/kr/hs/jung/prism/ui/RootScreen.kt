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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.launch
import kr.hs.jung.prism.core.di.ServiceContainer
import kr.hs.jung.prism.core.session.SessionStore
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.feature.auth.AuthManager
import kr.hs.jung.prism.feature.auth.LoginScreen
import kr.hs.jung.prism.feature.call.CallController
import kr.hs.jung.prism.feature.call.IncomingCallDialog
import kr.hs.jung.prism.feature.call.rememberCallPermission
import kr.hs.jung.prism.feature.call.WebRtcScreen
import kr.hs.jung.prism.feature.dashboard.DashboardScreen
import kr.hs.jung.prism.core.network.SessionSocket
import kr.hs.jung.prism.core.push.PushDestination
import kr.hs.jung.prism.core.push.PushLinks
import kr.hs.jung.prism.core.push.PushRequest
import kr.hs.jung.prism.core.push.PushRegistration
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
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // 소켓은 **세션 스코프의 ViewModel**이 든다 — `remember`는 화면 회전에 죽어 새 소켓을
    // 만들지만, 같은 스코프에 사는 `SessionStore`는 처음 받은 소켓을 계속 듣는다. 그러면
    // 회전 뒤의 신호와 `notifyChanged`가 멈춘 소켓으로 간다. 로그아웃하면 스코프와 함께 닫힌다.
    val socket = viewModel<SessionSocketHolder>(
        factory = viewModelFactory {
            initializer { SessionSocketHolder(container.createSessionSocket()) }
        },
    ).socket
    // 세션 목록도 **이 세션의 것**이다 — 화면 셋이 나눠 쓰고, 소켓 신호를 듣는 자리는
    // 여기 아래 하나뿐이다(core/session/SessionStore.kt). ViewModel 저장소가
    // `SessionScope`의 것이라 로그아웃과 함께 버려진다.
    val sessionStore: SessionStore = viewModel(
        factory = viewModelFactory {
            initializer {
                SessionStore(
                    api = container.sessionsApi,
                    tokens = container.sessionTokens,
                    socket = socket,
                )
            }
        },
    )
    // 이 기기의 알림 등록도 **이 세션의 것**이다 — 로그인 직후의 되살리기, 앱이 앞으로
    // 올 때의 권한 재확인, 토큰 회전이 한 자리에서 맞춰진다(core/push/PushRegistration.kt).
    // 예전에는 되살리기가 여기, 해제가 푸시 화면에 따로 있어 둘이 겹쳐 돌 수 있었다.
    //
    // ⚠️ **store보다 뒤에 선다.** 붙이고 나면 목록을 다시 받아야 하는데, 그 목록은
    // store가 쥔다.
    val pushRegistration: PushRegistration = viewModel(
        factory = viewModelFactory {
            initializer {
                PushRegistration(
                    device = container.pushTokens,
                    pushApi = container.pushApi,
                    tokens = container.sessionTokens,
                    store = sessionStore,
                )
            }
        },
    )
    // 앱이 앞으로 올 때마다 맞춘다 — 로그인 직후가 첫 번째다. 사람은 설정에서 알림을
    // 끌 수 있고 FCM은 토큰을 돌리는데, 둘 다 앱이 뒤에 있는 동안 일어난다.
    LifecycleStartEffect(pushRegistration) {
        pushRegistration.reconcile()
        onStopOrDispose { }
    }

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
    // 회전·언어 변경의 `recreate()`에도 남는다 — 알림으로 옮겨 간 화면이 대시보드로 되돌아가지 않게.
    var page by rememberSaveable { mutableStateOf(ShellPage.DASHBOARD) }
    // 셸의 이동. 통화 화면을 **떠나면** 아직 묻지 못한 통화 요청을 버린다 — 남겨 두면 다시 붙는
    // 순간 통화 화면으로 끌려가고, 그때까지 화면 요청은 통화에 밀려 버려진다.
    // 묻지 못해 남긴 통화 요청.
    var retainedCall by remember { mutableStateOf<PushRequest?>(null) }
    val navigate: (ShellPage) -> Unit = { next ->
        page = next
        if (next != ShellPage.WEBRTC) {
            // 떠나는 순간 기다리던 통화 요청을 거둔다 — 묻지 못해 남긴 것도, 아직 묻지 못한 것(소켓이
            // 안 붙음)도. 남겨 두면 다시 붙는 순간 통화 화면으로 끌려간다. 그 순간의 값만 비우므로
            // (`compareAndSet`) 바로 뒤에 들어온 다른 통화는 남는다.
            (PushLinks.pending.value as? PushRequest.Call)?.let { PushLinks.dropCall(it) }
            retainedCall = null
        }
    }
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
    //
    // 알림의 링크가 우리 주소였으면 그 화면으로 옮긴다(딥링크). 통화와 화면은 **한 칸**에 하나만
    // 남고(통화 우선), 여기 한 효과가 처리하므로 둘이 서로를 덮지 않는다.
    val pending by PushLinks.pending.collectAsStateWithLifecycle()
    val socketReady by socket.isReady.collectAsStateWithLifecycle()
    LaunchedEffect(pending, socketReady) {
        when (val request = pending) {
            null -> Unit
            is PushRequest.Call -> {
                if (!socketReady) return@LaunchedEffect
                page = ShellPage.WEBRTC
                // 묻지 못했으면(준비된 듯 보였는데 그 사이 닫힘) 요청을 남긴다 — 다시 붙으면
                // `socketReady`가 바뀌어 여기가 다시 돈다.
                if (call.resumeCall(request.callId)) {
                    PushLinks.consume(request)
                    if (retainedCall == request) retainedCall = null
                } else {
                    retainedCall = request
                }
            }
            is PushRequest.Page -> {
                page = when (request.destination) {
                    PushDestination.DASHBOARD -> ShellPage.DASHBOARD
                    PushDestination.PUSH -> ShellPage.PUSH
                    PushDestination.WEBRTC -> ShellPage.WEBRTC
                }
                PushLinks.consume(request)
            }
        }
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
            store = sessionStore,
            drawerState = drawerState,
            onNavigate = navigate,
            onSignOut = { scope.launch { container.authManager.signOut() } },
        )
        ShellPage.PUSH -> PushScreen(
            user = current.user,
            themeStore = container.themeStore,
            localeStore = container.localeStore,
            store = sessionStore,
            pushApi = container.pushApi,
            pushTokens = container.pushTokens,
            tokens = container.sessionTokens,
            registration = pushRegistration,
            drawerState = drawerState,
            onNavigate = navigate,
            onSignOut = { scope.launch { container.authManager.signOut() } },
        )
        ShellPage.WEBRTC -> WebRtcScreen(
            user = current.user,
            controller = call,
            socket = socket,
            themeStore = container.themeStore,
            localeStore = container.localeStore,
            drawerState = drawerState,
            store = sessionStore,
            onNavigate = navigate,
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

/**
 * 세션 소켓을 세션 스코프(`SessionScope`)에 붙들어 둔다 — 화면 회전에 살아남고, 로그아웃이
 * 스코프를 비울 때 닫힌다. 컴포지션의 `remember`는 회전에 죽어 이 자리에 쓸 수 없다.
 */
class SessionSocketHolder(val socket: SessionSocket) : ViewModel() {
    override fun onCleared() {
        socket.stop()
    }
}
