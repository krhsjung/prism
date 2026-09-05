package kr.hs.jung.prism.feature.call

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DrawerState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.calling.CallMedia
import kr.hs.jung.prism.core.calling.MediaErrorKind
import kr.hs.jung.prism.core.i18n.LocaleStore
import kr.hs.jung.prism.core.i18n.withVars
import kr.hs.jung.prism.core.network.SessionSocket
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.core.theme.ThemeStore
import kr.hs.jung.prism.domain.model.CallEndReason
import kr.hs.jung.prism.domain.model.CallErrorCode
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.domain.model.SessionListItem
import kr.hs.jung.prism.domain.model.SessionRef
import kr.hs.jung.prism.domain.model.User
import kr.hs.jung.prism.feature.dashboard.SessionsApi
import kr.hs.jung.prism.feature.dashboard.deviceLabel
import kr.hs.jung.prism.ui.AppShell
import kr.hs.jung.prism.ui.ShellPage
import kr.hs.jung.prism.ui.component.PrismBadge
import kr.hs.jung.prism.ui.component.PrismBadgeVariant
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant
import kr.hs.jung.prism.ui.component.PrismCard
import kr.hs.jung.prism.ui.component.PrismErrorAlert
import kr.hs.jung.prism.ui.component.PrismInfoAlert

/**
 * 1:1 통화 화면 — 시안 `WebRTC / Mobile / Lobby`·`Ringing`·`In call`·`In call (diagnostics open)`.
 *
 * 로비와 통화가 **한 카드**다. 방이 없으므로 "들어간다/나온다"가 없고, 통화가 끝나면
 * 같은 카드가 다시 로비가 된다 — 그래서 부재중 목록도 필요 없다: 주소록이 곧 그 화면이다
 * (plan/webrtc.md §4).
 */
@Composable
fun WebRtcScreen(
    user: User,
    controller: CallController,
    socket: SessionSocket,
    themeStore: ThemeStore,
    localeStore: LocaleStore,
    drawerState: DrawerState,
    sessionsApi: SessionsApi,
    tokens: SessionTokens,
    onNavigate: (ShellPage) -> Unit,
    onSignOut: () -> Unit,
) {
    val state by controller.state.collectAsStateWithLifecycle()
    val localTrack by controller.localTrack.collectAsStateWithLifecycle()
    val remoteTrack by controller.remoteTrack.collectAsStateWithLifecycle()
    val socketReady by socket.isReady.collectAsStateWithLifecycle()
    val changed by socket.changed.collectAsStateWithLifecycle()
    val withMedia = rememberCallPermission(controller)

    // 목록은 대시보드와 **같은 HTTP 경로**에서 온다(GET /auth/sessions) — 소켓은 신호만
    // 준다. 이 화면이 목록을 주입받으면 스탬핑·회전 처리를 통째로 우회한다.
    var sessions by remember { mutableStateOf<List<SessionListItem>?>(null) }
    var loadFailed by remember { mutableStateOf(false) }
    val load: suspend (Boolean) -> Unit = { background ->
        val token = tokens.access()
        if (token != null) {
            runCatching { sessionsApi.list(token, background) }
                .onSuccess { sessions = it; loadFailed = false }
                .onFailure { loadFailed = true }
        }
    }
    var retry by remember { mutableStateOf(false) }
    LaunchedEffect(retry) { load(false) }
    // 소켓이 "바뀌었다"고 하면 다시 가져온다. **비우지 않는다** — 다른 기기가 하나
    // 붙었다고 목록이 "불러오는 중"으로 접혔다 펴지면 통째로 깜빡인다.
    var handled by remember { mutableStateOf(changed) }
    LaunchedEffect(changed) {
        if (changed != handled) {
            handled = changed
            load(true)
        }
    }

    // 로비에 들어온 것만으로 **카메라를 열지 않는다.** 이미 허용한 적이 있으면 장치
    // 목록만 읽어 선택 메뉴를 채운다(카메라는 켜지지 않는다).
    //
    // 화면을 벗어나면 **통화도 끝내고 장치도 놓는다** — 축소된 통화 UI가 없어서, 안
    // 그러면 보이지도 끊기지도 않는 유령 통화가 된다(§4).
    DisposableEffect(Unit) {
        controller.enterLobby()
        onDispose { controller.leaveLobby() }
    }

    val inCall = state.call != null

    AppShell(
        page = ShellPage.WEBRTC,
        userName = user.displayName,
        themeStore = themeStore,
        localeStore = localeStore,
        drawerState = drawerState,
        onNavigate = onNavigate,
        onSignOut = onSignOut,
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(
                    start = PrismDimensions.callCardInset,
                    end = PrismDimensions.callCardInset,
                    top = PrismDimensions.callBodyPadding,
                    bottom = PrismDimensions.spacingLg,
                ),
        ) {
            CallCard(
                state = state,
                localTrack = localTrack,
                remoteTrack = remoteTrack,
                eglBaseContext = controller.eglBaseContext,
                sessions = sessions,
                socketReady = socketReady,
                loadFailed = loadFailed,
                onRetryLoad = { loadFailed = false; retry = !retry },
                controller = controller,
                withMedia = withMedia,
            )
        }

        // 컨트롤 바는 **화면 바닥 고정**이다. 카드 안에 두면 진단을 폈을 때 바가 화면
        // 밖으로 밀려 **종료 버튼에 닿을 수 없다**(§4). 상태에 따라 자리를 옮기는 대신
        // 통화 중에는 늘 여기 둔다.
        if (inCall) BottomBar(state, controller)
    }
}

/**
 * 카드 구조는 dashboard.md §4 규칙 그대로다 — 카드 `padding: 0`, 좌우 여백은 각 구획이
 * 갖고, **구분선은 각 구획의 위**에 둔다.
 */
@Composable
private fun CallCard(
    state: CallUiState,
    localTrack: VideoTrack?,
    remoteTrack: VideoTrack?,
    eglBaseContext: EglBase.Context,
    sessions: List<SessionListItem>?,
    socketReady: Boolean,
    loadFailed: Boolean,
    onRetryLoad: () -> Unit,
    controller: CallController,
    withMedia: (() -> Unit) -> Unit,
) {
    val colors = PrismTheme.colors
    val call = state.call
    val peerLabel = peerLabel(state)

    PrismCard(contentPadding = 0.dp, spacing = 0.dp) {
        Head(state, peerLabel)
        Notices(state, loadFailed, onRetryLoad)

        if (call != null) {
            Stage(
                state = state,
                peerLabel = peerLabel,
                localTrack = localTrack,
                remoteTrack = remoteTrack,
                eglBaseContext = eglBaseContext,
                onCancel = controller::cancelCall,
                onRetry = controller::retryCall,
            )
            CallDiagnostics(
                stats = state.stats,
                connectedAtMs = call.connectedAtMs,
                isLoopback = call.isLoopback,
                log = state.log,
                icePolicy = state.icePolicy,
                cameras = state.cameras,
                microphones = state.microphones,
                cameraId = state.cameraId,
                microphoneId = state.microphoneId,
                onClearLog = controller::clearLog,
                onIcePolicy = controller::setIcePolicy,
                onSelectCamera = controller::selectCamera,
                onSelectMicrophone = controller::selectMicrophone,
            )
        } else {
            LobbyBody(
                state = state,
                localTrack = localTrack,
                eglBaseContext = eglBaseContext,
                sessions = sessions,
                socketReady = socketReady,
                loadFailed = loadFailed,
                controller = controller,
                withMedia = withMedia,
            )
            // 미디어가 서버를 지나지 않는 것이 이 슬라이스의 핵심이라 화면에도 한 줄로
            // 적는다 — 카드 바닥의 제 구획이다(시안 Foot).
            HorizontalDivider(color = colors.border)
            Text(
                text = stringResource(R.string.webrtc_p2p_note),
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
                modifier = Modifier.padding(
                    horizontal = PrismDimensions.callCardInset,
                    vertical = PrismDimensions.callFootPadding,
                ),
            )
        }
    }
}

/**
 * 카드 머리는 **지금 무엇을 하는 중인가**를 말한다. 붙은 뒤에는 부제를 두지 않는다 —
 * 상대가 누구인지는 타일의 이름표가 이미 말하고, 상태는 오른쪽 배지가 말한다(시안 Head).
 */
@Composable
private fun Head(state: CallUiState, peerLabel: String) {
    val colors = PrismTheme.colors
    val call = state.call
    val title = when {
        call == null -> stringResource(R.string.webrtc_lobby_title)
        call.status == CallStatus.RINGING ->
            stringResource(R.string.webrtc_calling).withVars("device" to peerLabel)
        else -> stringResource(R.string.webrtc_in_call)
    }
    // 상한(45초)은 **이 한 줄에만** 둔다 — 만료 화면에서 되풀이하지 않는다(§4).
    val subtitle = when {
        call == null -> stringResource(R.string.webrtc_lobby_desc)
        call.status == CallStatus.RINGING -> stringResource(R.string.webrtc_ring_timeout_note)
        else -> null
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
        modifier = Modifier.fillMaxWidth().padding(
            horizontal = PrismDimensions.callCardInset,
            vertical = if (call == null) {
                PrismDimensions.callLobbyHeadPadding
            } else {
                PrismDimensions.callHeadPadding
            },
        ),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PrismDimensions.headSpacing),
            modifier = Modifier.weight(1f),
        ) {
            Text(
                text = title,
                color = colors.heading,
                fontSize = PrismDimensions.fontSectionTitle,
                fontWeight = FontWeight.SemiBold,
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    color = colors.muted,
                    fontSize = if (call == null) {
                        PrismDimensions.fontBody
                    } else {
                        PrismDimensions.fontCaption
                    },
                )
            }
        }
        // 연결 상태 배지는 **카드 머리**에 둔다 — 그것은 통화의 상태이지 어느 타일의
        // 상태가 아니다(§4).
        if (call != null) {
            PrismBadge(stringResource(statusLabel(call.status)), statusVariant(call.status))
        }
    }
}

/**
 * 알림 한 줄 — 거절·종료·오류·만료가 여기로 온다. 통화가 끝난 뒤 남는 것은 이것뿐이고,
 * 기록은 남기지 않는다(§2). **닫기 버튼을 두지 않는다** — 다시 걸 수 있는 목록이 바로
 * 아래에 있고, 다음 통화를 시작하면 사라진다.
 */
@Composable
private fun ColumnScope.Notices(
    state: CallUiState,
    loadFailed: Boolean,
    onRetryLoad: () -> Unit,
) {
    val colors = PrismTheme.colors
    val mediaError = state.mediaError
    val notice = state.notice

    if (mediaError != null) {
        val message = stringResource(mediaErrorLabel(mediaError))
        val inset = Modifier
            .padding(horizontal = PrismDimensions.callCardInset)
            .padding(bottom = PrismDimensions.callBodySpacing)
        if (mediaErrorIsError(mediaError)) {
            PrismErrorAlert(message = message, modifier = inset)
        } else {
            PrismInfoAlert(message = message, modifier = inset)
        }
    } else if (notice != null) {
        val described = describe(notice)
        if (described.second) {
            PrismErrorAlert(
                message = described.first,
                modifier = Modifier
                    .padding(horizontal = PrismDimensions.callCardInset)
                    .padding(bottom = PrismDimensions.callBodySpacing),
            )
        } else {
            // 정보 알림 — 거절·상대 종료처럼 **오류가 아닌 사실 통지**다(§4).
            PrismInfoAlert(
                message = described.first,
                modifier = Modifier
                    .padding(horizontal = PrismDimensions.callCardInset)
                    .padding(bottom = PrismDimensions.callBodySpacing),
            )
        }
    }

    if (loadFailed) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
            modifier = Modifier
                .padding(horizontal = PrismDimensions.callCardInset)
                .padding(bottom = PrismDimensions.callBodySpacing),
        ) {
            PrismErrorAlert(message = stringResource(R.string.error_sessions_load_failed))
            PrismButton(
                text = stringResource(R.string.common_retry),
                variant = PrismButtonVariant.SECONDARY,
                onClick = onRetryLoad,
                fillWidth = false,
            )
        }
    }
}

/**
 * **판은 surface, 타일은 stage** — 판까지 어두우면 타일 경계가 사라진다(§4).
 *
 * 375에서는 두 타일을 나란히 두는 대신 **피어 전면 + 셀프 PiP(우상단)**다. 우하단은
 * 이름 칩·컨트롤과 겹치고 좌하단은 이름 칩 자리다 — 상태 배지를 카드 머리에 둔 결정이
 * 우상단을 비워 줬다.
 */
@Composable
private fun Stage(
    state: CallUiState,
    peerLabel: String,
    localTrack: VideoTrack?,
    remoteTrack: VideoTrack?,
    eglBaseContext: EglBase.Context,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
) {
    val colors = PrismTheme.colors
    val call = state.call ?: return
    val you = stringResource(R.string.webrtc_you)

    HorizontalDivider(color = colors.border)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surface)
            .padding(PrismDimensions.callStagePadding),
    ) {
        CallVideoTile(
            track = remoteTrack,
            state = peerTileState(call.status, remoteTrack != null),
            eglBaseContext = eglBaseContext,
            name = peerLabel,
            message = peerTileMessage(call.status, remoteTrack != null),
            modifier = Modifier
                .fillMaxWidth()
                .height(PrismDimensions.callStageHeight),
            // 타일의 행동은 **하나뿐이다.** 호출 중에는 나가는 길이 `Cancel` 하나여야
            // 해서 컨트롤 바에 종료를 그리지 않고 타일이 이 버튼을 갖고(§4), 실패에는
            // 문구가 없으므로 `Try again`만 남는다.
            action = when (call.status) {
                CallStatus.RINGING -> {
                    {
                        PrismButton(
                            text = stringResource(R.string.common_cancel),
                            variant = PrismButtonVariant.SECONDARY,
                            onClick = onCancel,
                            fillWidth = false,
                        )
                    }
                }
                CallStatus.FAILED -> {
                    {
                        PrismButton(
                            text = stringResource(R.string.common_retry),
                            variant = PrismButtonVariant.SECONDARY,
                            onClick = onRetry,
                            fillWidth = false,
                        )
                    }
                }
                else -> null
            },
        )

        // 셀프 PiP — 이름표 없이 흰 테두리만. **셀프만 미러링한다**(§4).
        CallVideoTile(
            track = localTrack,
            state = selfTileState(state),
            eglBaseContext = eglBaseContext,
            mirrored = true,
            muted = !state.micOn,
            pip = true,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(PrismDimensions.callPipInset)
                .size(PrismDimensions.callPipWidth, PrismDimensions.callPipHeight)
                .semantics { contentDescription = you },
        )
    }
}

/** 프리뷰(컨트롤이 **타일 위에 얹힌다**) + 카메라·마이크 + 기기 목록. */
@Composable
private fun LobbyBody(
    state: CallUiState,
    localTrack: VideoTrack?,
    eglBaseContext: EglBase.Context,
    sessions: List<SessionListItem>?,
    socketReady: Boolean,
    loadFailed: Boolean,
    controller: CallController,
    withMedia: (() -> Unit) -> Unit,
) {
    val colors = PrismTheme.colors
    HorizontalDivider(color = colors.border)
    Column(
        verticalArrangement = Arrangement.spacedBy(PrismDimensions.callBodySpacing),
        modifier = Modifier.padding(PrismDimensions.callBodyPadding),
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(PrismDimensions.callPreviewHeight)) {
            CallVideoTile(
                track = localTrack,
                state = selfTileState(state),
                eglBaseContext = eglBaseContext,
                name = stringResource(R.string.webrtc_you),
                mirrored = true,
                muted = !state.micOn,
                message = selfTileMessage(state),
                modifier = Modifier.fillMaxSize(),
                action = if (!state.hasMedia) {
                    {
                        // 미리 켜 보는 길. **자동으로는 켜지지 않는다** — 누르는 것이 곧
                        // 제스처다(§7). 아직 허용한 적이 없으면 이 버튼이 장치 이름을
                        // 얻는 유일한 길이기도 하다.
                        //
                        // ⚠️ **실패한 뒤에도 남는다.** 오류 문구가 하나같이 "고치고 다시"
                        // 라고 말하는데(권한 허용·다른 앱 종료·장치 연결) 버튼을 치우면 그
                        // 자리가 막다른 길이 된다. 라벨은 **상태와 무관하게 하나다** — 이
                        // 버튼이 하는 일은 어느 상태에서나 "카메라를 연다" 하나뿐이고,
                        // 무엇이 잘못됐는지는 알림과 타일 이름표가 이미 말한다(웹과 같은 규칙).
                        PrismButton(
                            text = stringResource(R.string.webrtc_preview_start),
                            variant = PrismButtonVariant.SECONDARY,
                            onClick = { withMedia(controller::startPreview) },
                            fillWidth = false,
                        )
                    }
                } else {
                    null
                },
            )
            // 로비에서는 컨트롤이 프리뷰 위에 얹힌다(시안 Preview).
            CallControls(
                micOn = state.micOn,
                cameraOn = state.cameraOn,
                // 로비에도, 호출 중에도 종료는 **없다**(§4).
                end = false,
                onToggleMic = controller::toggleMic,
                onToggleCamera = controller::toggleCamera,
                onHangUp = {},
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = PrismDimensions.callBodySpacing),
            )
        }

        // 장치 선택은 **고를 것이 생긴 뒤에** 나타난다. 권한을 통화 시작으로 미뤘으므로
        // 첫 통화 전에는 목록이 비어 있다 — 빈 셀렉트 위에 라벨만 띄우면 고칠 수 없는
        // 빈 자리가 된다.
        if (state.cameras.isNotEmpty()) {
            CallField(label = stringResource(R.string.webrtc_camera)) {
                CallDeviceSelect(
                    label = stringResource(R.string.webrtc_camera),
                    options = state.cameras,
                    selectedId = state.cameraId,
                    onSelect = controller::selectCamera,
                )
            }
        }
        if (state.microphones.isNotEmpty()) {
            CallField(label = stringResource(R.string.webrtc_microphone)) {
                CallDeviceSelect(
                    label = stringResource(R.string.webrtc_microphone),
                    options = state.microphones,
                    selectedId = state.microphoneId,
                    onSelect = controller::selectMicrophone,
                )
            }
        }

        when {
            sessions != null -> CallTargetList(
                sessions = sessions,
                socketReady = socketReady,
                busy = state.starting,
                onCall = { session ->
                    withMedia {
                        controller.startCall(SessionRef(session.id, session.device))
                    }
                },
                onLoopback = { withMedia(controller::startLoopback) },
            )
            !loadFailed -> Text(
                text = stringResource(R.string.common_loading),
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
            )
        }
    }
}

/**
 * 시안 `BottomBar (fixed)` — 카드 색 판에 위 테두리. 아래 여백은 시스템 바 인셋이
 * 이미 맡고 있다(`AppShell`의 `systemBarsPadding`).
 */
@Composable
private fun BottomBar(state: CallUiState, controller: CallController) {
    val colors = PrismTheme.colors
    HorizontalDivider(color = colors.border)
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.card)
            .padding(
                top = PrismDimensions.callBarTopPadding,
                bottom = PrismDimensions.callBarBottomPadding,
            ),
    ) {
        CallControls(
            micOn = state.micOn,
            cameraOn = state.cameraOn,
            // 호출 중에는 종료를 **아예 그리지 않는다** — 나가는 길은 타일의 `Cancel`
            // 하나여야 한다(§4).
            end = state.call?.status != CallStatus.RINGING,
            onToggleMic = controller::toggleMic,
            onToggleCamera = controller::toggleCamera,
            onHangUp = controller::hangUp,
        )
    }
}

/**
 * 통화가 시작되는 순간(`Call`·`Accept`·`Test`)에만 권한을 묻는 문.
 *
 * 화면이 이것을 쥐는 이유: 런타임 권한은 Activity의 결과 계약이라 컨트롤러가 부를 수
 * 없다. 이미 허용돼 있으면 곧바로 실행하고, 아니면 물어본 뒤 그 답에 따라 이어간다.
 */
@Composable
fun rememberCallPermission(controller: CallController): (() -> Unit) -> Unit {
    val context = LocalContext.current
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        val granted = CallMedia.PERMISSIONS.all { result[it] == true }
        if (granted) pending?.invoke() else controller.reportPermissionDenied()
        pending = null
    }
    return remember(launcher) {
        { action ->
            val granted = CallMedia.PERMISSIONS.all {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            }
            if (granted) {
                action()
            } else {
                pending = action
                launcher.launch(CallMedia.PERMISSIONS)
            }
        }
    }
}

// ── 상태 → 화면 ─────────────────────────────────────────────────────────────

/** 배지는 `Atom/Badge`의 **기존 변형을 그대로** 쓴다 — 새 변형 없음(§4). */
@StringRes
internal fun statusLabel(status: CallStatus): Int = when (status) {
    CallStatus.RINGING -> R.string.webrtc_status_ringing
    CallStatus.CONNECTING -> R.string.webrtc_status_connecting
    CallStatus.CONNECTED -> R.string.webrtc_status_connected
    CallStatus.RECONNECTING -> R.string.webrtc_status_reconnecting
    CallStatus.FAILED -> R.string.webrtc_status_failed
}

internal fun statusVariant(status: CallStatus): PrismBadgeVariant = when (status) {
    CallStatus.RINGING -> PrismBadgeVariant.NEUTRAL
    CallStatus.CONNECTING -> PrismBadgeVariant.INFO
    CallStatus.CONNECTED -> PrismBadgeVariant.SUCCESS
    CallStatus.RECONNECTING -> PrismBadgeVariant.WARNING
    CallStatus.FAILED -> PrismBadgeVariant.ERROR
}

@StringRes
internal fun mediaErrorLabel(kind: MediaErrorKind): Int = when (kind) {
    MediaErrorKind.DENIED -> R.string.error_camera_permission_denied
    MediaErrorKind.NOT_FOUND -> R.string.error_camera_not_found
    MediaErrorKind.UNAVAILABLE -> R.string.error_camera_in_use
}

/**
 * 타일에 얹는 짧은 한 줄. **알림과 달리 갈래마다 다르다.**
 *
 * 하나로 뭉쳐 두었더니 영어가 "No camera access"였다 — 장치가 아예 없는 기기에는 접근
 * 권한 이야기가 틀린 말이다. 타일은 좁아서 이유를 담을 수 없으니 **알림이 설명하고
 * 타일은 이름표만 단다**(웹 `MEDIA_TILES`와 같은 표).
 */
@StringRes
internal fun mediaTileLabel(kind: MediaErrorKind): Int = when (kind) {
    MediaErrorKind.DENIED -> R.string.webrtc_tile_camera_denied
    MediaErrorKind.NOT_FOUND -> R.string.webrtc_tile_camera_missing
    MediaErrorKind.UNAVAILABLE -> R.string.webrtc_tile_camera_busy
}

/**
 * 이 갈래를 **빨강으로 말할 것인가.**
 *
 * ⚠️ 셋이 다 오류는 아니다. `NOT_FOUND`는 사용자가 만든 실패가 아니라 **기기의 사실**이고,
 * 고칠 것이 없는 사람에게 오류로 말하면 "뭔가 잘못했다"로 읽힌다. 나머지 둘은 손댈 자리가
 * 분명해서 그대로 오류다(웹 `MEDIA_ERRORS`와 같은 표).
 */
internal fun mediaErrorIsError(kind: MediaErrorKind): Boolean =
    kind != MediaErrorKind.NOT_FOUND

/** 계약의 유니온을 키로 쓴다 — 오류 코드가 늘면 여기서 컴파일이 걸린다. */
@StringRes
internal fun callErrorLabel(code: CallErrorCode): Int = when (code) {
    CallErrorCode.UNREACHABLE -> R.string.error_device_unreachable
    CallErrorCode.BUSY -> R.string.error_device_busy
    CallErrorCode.UNKNOWN_SESSION -> R.string.error_device_offline
    // 루프백이 클라이언트 안에서 끝나므로 자기 자신을 소켓으로 부를 길은 없다 —
    // 여기까지 왔다면 우리 쪽 버그다.
    CallErrorCode.SELF -> R.string.error_call_failed
}

internal fun selfTileState(state: CallUiState): TileState = when {
    state.mediaError != null -> TileState.NO_VIDEO
    // 트랙이 없는 것은 **실패가 아니다** — 통화 전에는 열지 않기 때문이다.
    !state.hasMedia -> TileState.IDLE
    state.cameraOn -> TileState.LIVE
    else -> TileState.CAMERA_OFF
}

@Composable
private fun selfTileMessage(state: CallUiState): String? = when {
    state.mediaError != null -> stringResource(mediaTileLabel(state.mediaError))
    !state.hasMedia -> stringResource(R.string.webrtc_tile_camera_idle)
    state.cameraOn -> null
    else -> stringResource(R.string.webrtc_tile_camera_off)
}

internal fun peerTileState(status: CallStatus, hasTrack: Boolean): TileState = when {
    status == CallStatus.RINGING -> TileState.RINGING
    status == CallStatus.RECONNECTING -> TileState.RECONNECTING
    !hasTrack -> TileState.CONNECTING
    status == CallStatus.CONNECTED -> TileState.LIVE
    else -> TileState.CONNECTING
}

@Composable
private fun peerTileMessage(status: CallStatus, hasTrack: Boolean): String? = when {
    status == CallStatus.RINGING -> stringResource(R.string.webrtc_tile_ringing)
    status == CallStatus.RECONNECTING -> stringResource(R.string.webrtc_tile_reconnecting)
    // 실패 타일은 **문구를 갖지 않는다** — 배지가 이미 그 말을 한다(§4).
    status == CallStatus.FAILED -> null
    hasTrack -> null
    else -> stringResource(R.string.webrtc_tile_connecting)
}

/**
 * 상대 이름은 **기기 종류**다. 루프백에서는 두 타일이 같은 카메라를 나눠 쓰므로 이름표가
 * `Loopback`이다.
 */
@Composable
private fun peerLabel(state: CallUiState): String {
    val call = state.call ?: return ""
    if (call.isLoopback) return stringResource(R.string.webrtc_loopback_peer)
    val peer = call.peer ?: return ""
    return stringResource(deviceLabel(peer.device))
}

/** 로비에 남는 한 줄. 거절·상대 종료는 Info, 권한·통화 중·실패는 Error다(§4). */
@Composable
private fun describe(notice: CallNotice): Pair<String, Boolean> = when (notice) {
    is CallNotice.Declined -> stringResource(R.string.webrtc_declined) to false
    // 응답 없음만 오류다 — 사람이 끊은 것과 소켓이 사라진 것은 **그저 끝**이다.
    is CallNotice.Ended -> if (notice.reason == CallEndReason.TIMEOUT) {
        stringResource(R.string.error_no_answer) to true
    } else {
        stringResource(R.string.webrtc_peer_left) to false
    }
    is CallNotice.Expired -> if (notice.from == null) {
        stringResource(R.string.webrtc_expired_title) to false
    } else {
        stringResource(R.string.webrtc_expired_body)
            .withVars("device" to stringResource(deviceLabel(notice.from.device))) to false
    }
    is CallNotice.Error -> stringResource(callErrorLabel(notice.code)) to true
}
