package kr.hs.jung.prism.feature.call

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.calling.MediaDeviceOption
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.domain.model.DeviceKind
import kr.hs.jung.prism.domain.model.SessionListItem
import kr.hs.jung.prism.feature.dashboard.deviceIcon
import kr.hs.jung.prism.feature.dashboard.deviceLabel
import kr.hs.jung.prism.ui.component.PrismBadge
import kr.hs.jung.prism.ui.component.PrismBadgeVariant
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * 타일 안의 한 줄. **연결 상태 배지는 여기 있지 않다** — 그것은 통화의 상태이지 어느
 * 타일의 상태가 아니라서 카드 머리에 산다(plan/webrtc.md §4).
 *
 * `FAILED`가 없는 것도 결정이다: 실패 타일은 문구를 갖지 않는다. 배지가 이미
 * "Connection failed"라고 말하고 있고 자세한 사정은 notice의 알림이 맡는다.
 */
enum class TileState {
    LIVE,

    /** 아직 카메라를 켜지 않았다 — **실패가 아니라 아직 묻지 않은 것**이다. */
    IDLE,
    RINGING,
    NOTIFIED,
    CONNECTING,
    RECONNECTING,
    CAMERA_OFF,
    NO_VIDEO,
    ;

    /** 영상이 실제로 그려지는 상태. 나머지는 어두운 판 위에 상태 줄이 온다. */
    val showsVideo: Boolean get() = this == LIVE || this == RECONNECTING
}

/**
 * 통화 타일 — 시안 `Molecule/VideoTile`.
 *
 * 크기는 변형이 아니라 **리사이즈**다(큰 타일도 PiP도 같은 컴포넌트). 다른 것은 PiP가
 * 이름표를 달지 않고 흰 테두리를 갖는다는 점뿐이다 — 96 폭에서 칩이 판을 다 먹고,
 * 배경 타일과 같은 `stage` 색이라 경계가 필요하다.
 */
@Composable
fun CallVideoTile(
    track: VideoTrack?,
    state: TileState,
    eglBaseContext: EglBase.Context,
    modifier: Modifier = Modifier,
    name: String? = null,
    /** 셀프만 미러링한다 — 상대가 든 글씨가 뒤집히면 안 된다(§4). */
    mirrored: Boolean = false,
    muted: Boolean = false,
    /** 상태 줄의 문구. 이미 번역해서 넘긴다. */
    message: String? = null,
    /** 화면 안에 겹쳐 놓는 작은 타일(모바일의 셀프 PiP). */
    pip: Boolean = false,
    /** 상태 줄 아래의 단 하나의 행동(호출 중의 `Cancel`, 로비의 `카메라 켜기`). */
    action: @Composable (() -> Unit)? = null,
) {
    val colors = PrismTheme.colors
    val shape = RoundedCornerShape(PrismDimensions.radiusMd)
    Box(
        modifier = modifier
            .clip(shape)
            .background(colors.stage)
            .then(
                if (pip) {
                    Modifier.border(PrismDimensions.callPipBorderWidth, Color.White.copy(alpha = 0.5f), shape)
                } else {
                    Modifier
                },
            ),
    ) {
        if (state.showsVideo && track != null) {
            VideoRenderer(
                track = track,
                mirrored = mirrored,
                eglBaseContext = eglBaseContext,
                // PiP는 피어 타일 **위에** 겹쳐 놓인다. `SurfaceView`는 창 밖에 제 표면을
                // 갖기 때문에 Compose의 그리기 순서를 따르지 않는다 — 이 표시가 없으면
                // 나중에 그린 PiP가 아래 표면에 구멍을 내고 투명하게 비친다.
                zOrderOnTop = pip,
                modifier = Modifier
                    .fillMaxSize()
                    // 재연결 중에는 마지막 프레임이 멈춰 있다 — 흐리게 해서 "지금 것이
                    // 아니다"를 말한다(시안 `State=Reconnecting`).
                    .alpha(if (state == TileState.RECONNECTING) 0.5f else 1f),
            )
        } else {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(
                    PrismDimensions.callTileContentSpacing,
                    Alignment.CenterVertically,
                ),
                modifier = Modifier
                    .fillMaxSize()
                    .padding(PrismDimensions.callStagePadding),
            ) {
                if (message != null) {
                    Text(
                        text = message,
                        color = colors.stageForeground,
                        fontSize = PrismDimensions.fontBody,
                    )
                }
                action?.invoke()
            }
        }

        // 이름표는 **좌하단**이다. 우상단은 PiP 자리이고, 우하단은 컨트롤과 겹친다.
        if (name != null && !pip) {
            NameChip(
                name = name,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(PrismDimensions.callPipInset),
            )
        }

        // 음소거 표시는 이름표 반대쪽 — 같은 모서리에 두면 긴 이름에서 겹친다.
        if (muted) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(PrismDimensions.callPipInset)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.45f))
                    .padding(PrismDimensions.spacingXs),
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_mic_off),
                    contentDescription = null,
                    tint = colors.stageForeground,
                    modifier = Modifier.size(PrismDimensions.callControlGlyph),
                )
            }
        }
    }
}

/** 시안 `Label chip` — 영상 위의 반투명 검정이라 라이트/다크 어느 쪽에서도 글자가 읽힌다. */
@Composable
private fun NameChip(name: String, modifier: Modifier = Modifier) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .height(PrismDimensions.callChipHeight)
            .clip(RoundedCornerShape(percent = 50))
            .background(Color.Black.copy(alpha = 0.45f))
            .padding(horizontal = PrismDimensions.callChipHorizontalPadding),
    ) {
        Text(
            text = name,
            color = PrismTheme.colors.stageForeground,
            fontSize = PrismDimensions.badgeFontSize,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/**
 * `VideoTrack`을 그리는 자리.
 *
 * **렌더러는 한 번만 만든다** — `AndroidView`의 factory가 다시 돌면 EGL 표면이 새로
 * 서고 그동안 화면이 검게 깜빡인다. 트랙 교체는 update에서 sink를 옮기는 것으로 끝낸다.
 */
@Composable
private fun VideoRenderer(
    track: VideoTrack,
    mirrored: Boolean,
    eglBaseContext: EglBase.Context,
    modifier: Modifier = Modifier,
    zOrderOnTop: Boolean = false,
) {
    // 지금 이 렌더러에 붙어 있는 트랙. 같은 것을 두 번 붙이면 프레임이 겹친다.
    val attached = remember { arrayOfNulls<VideoTrack>(1) }
    AndroidView(
        modifier = modifier,
        factory = { context ->
            SurfaceViewRenderer(context).apply {
                // ⚠️ **`init` 전에** 정해야 한다 — 표면이 선 뒤에는 z 순서를 바꿀 수 없다.
                if (zOrderOnTop) setZOrderMediaOverlay(true)
                init(eglBaseContext, null)
                // 타일을 채운다 — 레터박스를 두면 어두운 판 위에 또 다른 어두운 띠가
                // 생겨 타일 경계가 어디인지 읽히지 않는다.
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setEnableHardwareScaler(true)
            }
        },
        update = { renderer ->
            renderer.setMirror(mirrored)
            if (attached[0] !== track) {
                // 옛 트랙에서 **떼고 나서** 새 트랙에 붙인다 — 순서가 뒤집히면 한
                // 렌더러가 두 트랙에 걸려 프레임이 섞인다.
                attached[0]?.removeSink(renderer)
                runCatching { track.addSink(renderer) }
                attached[0] = track
            }
        },
        onRelease = { renderer ->
            attached[0]?.removeSink(renderer)
            attached[0] = null
            renderer.release()
        },
    )
}

/**
 * 음소거 · 카메라 · 종료 — 시안 `Molecule/CallControls`.
 *
 * **빨강은 종료에만 쓴다**(plan/webrtc.md §4). 음소거를 빨강으로 칠하는 관행이 있지만
 * 그러면 화면에 빨간 원이 둘 생기고 **되돌릴 수 있는 것과 없는 것**이 같은 색이 된다.
 * 꺼짐은 Warning(내가 지금 꺼 두었다는 알림), 종료는 Destructive.
 *
 * **보이는 라벨을 두지 않고 접근성 이름만 둔다** — 세 글리프는 관습이 굳었고, 라벨을
 * 달면 바 폭이 세 배가 되며 ko·ja에서 줄바꿈된다.
 */
@Composable
fun CallControls(
    micOn: Boolean,
    cameraOn: Boolean,
    /**
     * 종료 버튼을 둘 것인가(시안 `End` 불리언).
     *
     * 로비와 호출 중에는 **없앤다** — 끄는 것이 아니다. 아직 통화가 아니고, 나가는 길은
     * 호출 중이라면 `Cancel` 하나여야 한다. 흐린 빨간 원을 남기면 누를 수 있는 것처럼
     * 보이고, 무대 위에 빨강이 하나 더 생긴다.
     */
    end: Boolean,
    onToggleMic: () -> Unit,
    onToggleCamera: () -> Unit,
    onHangUp: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = PrismTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PrismDimensions.callEndSpacing),
        modifier = modifier,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PrismDimensions.callControlSpacing),
        ) {
            ControlButton(
                icon = if (micOn) R.drawable.ic_mic else R.drawable.ic_mic_off,
                isOff = !micOn,
                label = stringResource(if (micOn) R.string.webrtc_mute else R.string.webrtc_unmute),
                onClick = onToggleMic,
            )
            ControlButton(
                icon = if (cameraOn) R.drawable.ic_camera else R.drawable.ic_camera_off,
                isOff = !cameraOn,
                label = stringResource(
                    if (cameraOn) R.string.webrtc_camera_off else R.string.webrtc_camera_on,
                ),
                onClick = onToggleCamera,
            )
        }
        // 종료 앞의 24는 **안전 여백**이다 — 되돌릴 수 없는 버튼이 반복 조작하는 버튼에
        // 이어 붙으면 오탭이 생긴다(대시보드의 "모두 로그아웃"과 같은 규칙).
        if (end) {
            IconButton(
                onClick = onHangUp,
                modifier = Modifier
                    .size(PrismDimensions.callControlSize)
                    .clip(CircleShape)
                    .background(colors.error),
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_phone_off),
                    contentDescription = stringResource(R.string.webrtc_end_call),
                    // 하드코딩 흰색이면 다크의 밝은 빨강 위에서 대비가 나오지 않는다.
                    tint = colors.errorForeground,
                    modifier = Modifier.size(PrismDimensions.callControlGlyph),
                )
            }
        }
    }
}

/** 되돌릴 수 있는 토글 하나. 꺼져 있으면 Warning으로 물든다 — 색이 곧 "지금 꺼 뒀다"다. */
@Composable
private fun ControlButton(
    @DrawableRes icon: Int,
    isOff: Boolean,
    label: String,
    onClick: () -> Unit,
) {
    val colors = PrismTheme.colors
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(PrismDimensions.callControlSize)
            .clip(CircleShape)
            .background(if (isOff) colors.warningBackground else colors.secondaryBackground),
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = label,
            tint = if (isOff) colors.warning else colors.secondaryForeground,
            modifier = Modifier.size(PrismDimensions.callControlGlyph),
        )
    }
}

/**
 * 로비의 **내 기기 목록** — 시안 `Molecule/CallTarget` × `List`.
 *
 * 코드 입력란이 있던 자리다(plan/webrtc.md §4). 방 코드를 사람이 짓거나 받아 적는 대신
 * **이미 인증된 내 세션**을 고른다. 대시보드가 그리는 목록과 같은 데이터·같은 행
 * 구성이고, 기기명·브라우저·위치를 담지 않는 이유도 그대로 물려받는다.
 *
 * 목록은 **테두리 하나에 구분선으로 나뉜 한 판**이다 — 행마다 카드를 주면 기기 수만큼
 * 상자가 생겨 목록이 아니라 카드 더미로 읽힌다(시안 `List`).
 */
@Composable
fun CallTargetList(
    sessions: List<SessionListItem>,
    /** 내 소켓이 붙어 있는가. 아니면 **아무도 부를 수 없다** — 시그널링이 이 소켓뿐이다. */
    socketReady: Boolean,
    /** 통화 중이면 목록 전체를 잠근다 — 서버도 세션당 한 통화만 허락한다. */
    busy: Boolean,
    onCall: (SessionListItem) -> Unit,
    onLoopback: () -> Unit,
) {
    val colors = PrismTheme.colors
    val current = sessions.firstOrNull { it.isCurrent }
    val others = sessions.filter { !it.isCurrent }

    Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callFieldSpacing)) {
        Text(
            text = stringResource(R.string.webrtc_devices),
            color = colors.text,
            fontSize = PrismDimensions.fontBody,
        )
        Text(
            text = stringResource(R.string.webrtc_devices_desc),
            color = colors.muted,
            fontSize = PrismDimensions.fontCaption,
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PrismDimensions.radiusMd))
                .background(colors.card)
                .border(
                    1.dp,
                    colors.border,
                    RoundedCornerShape(PrismDimensions.radiusMd),
                )
                // 판 **안쪽**의 위아래 여백이다 — 테두리 바깥에 주면 첫 행과 마지막 행이
                // 선에 붙는다(웹 `.targets { padding: 6px 0 }`).
                .padding(vertical = PrismDimensions.callListVerticalPadding),
        ) {
            if (current != null) {
                // 현재 세션 줄만 할 수 있는 일이 있다 — 대시보드에서는 `Revoke`를 갖지
                // 않는 그 줄이 여기서는 **루프백 시험**이다(§4).
                TargetRow(
                    device = current.device,
                    title = stringResource(R.string.webrtc_this_tab),
                    subtitle = stringResource(R.string.webrtc_loopback),
                    dimmed = false,
                ) {
                    PrismButton(
                        text = stringResource(R.string.webrtc_test),
                        variant = PrismButtonVariant.OUTLINE,
                        enabled = !busy,
                        onClick = onLoopback,
                        fillWidth = false,
                    )
                }
            }
            others.forEach { session ->
                // 소켓이 없으면 서버가 `unreachable`로 거절한다. 푸시로 깨우는 경로는
                // push 슬라이스와 함께 붙고(§8-11), 그때까지 이 줄은 알림이 꺼진 줄이다.
                val reachable = socketReady && session.isConnected
                HorizontalDivider(color = colors.border)
                TargetRow(
                    device = session.device,
                    title = stringResource(deviceLabel(session.device)),
                    subtitle = "#${session.id.take(8)}",
                    dimmed = !reachable,
                ) {
                    if (reachable) {
                        PrismButton(
                            text = stringResource(R.string.webrtc_call),
                            // 손가락에는 hover가 없다 — 목록 안의 인라인 액션은
                            // Ghost가 아니라 Secondary다(시안 `Atom/Button` 설명).
                            variant = PrismButtonVariant.SECONDARY,
                            enabled = !busy,
                            onClick = { onCall(session) },
                            fillWidth = false,
                        )
                    } else {
                        // **닿지 않는 줄만 버튼을 잃는다.** 회색 버튼을 남기면 눌러 볼 수
                        // 있는 것처럼 보이고, 벨이 끝날 때까지 기다린 뒤에야 이유를 안다.
                        PrismBadge(
                            text = stringResource(R.string.webrtc_notifications_off),
                            variant = PrismBadgeVariant.NEUTRAL,
                        )
                    }
                }
            }
        }

        // 목록이 비면 빈 상태 대신 **다음에 할 일**을 적는다(§4).
        if (others.isEmpty()) {
            Text(
                text = stringResource(R.string.webrtc_no_other_devices),
                color = colors.muted,
                fontSize = PrismDimensions.fontCaption,
                // 목록에서 한 칸 더 떨어진다(웹 `.setup__hint--after`).
                modifier = Modifier.padding(top = PrismDimensions.headSpacing),
            )
        }
    }
}

/** 기기 한 줄 — 아이콘 칩 · 이름/부제 · 행동. */
@Composable
private fun TargetRow(
    device: DeviceKind,
    title: String,
    subtitle: String,
    dimmed: Boolean,
    trailing: @Composable () -> Unit,
) {
    val colors = PrismTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PrismDimensions.callRowSpacing),
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                horizontal = PrismDimensions.callRowHorizontalPadding,
                vertical = PrismDimensions.callRowVerticalPadding,
            ),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(PrismDimensions.callRowIconTile)
                .clip(RoundedCornerShape(PrismDimensions.radiusMd))
                .background(colors.secondaryBackground),
        ) {
            Icon(
                painter = painterResource(deviceIcon(device)),
                contentDescription = null,
                tint = if (dimmed) colors.muted else colors.heading,
                modifier = Modifier.size(PrismDimensions.callRowIconGlyph),
            )
        }
        Column(
            verticalArrangement = Arrangement.spacedBy(PrismDimensions.callRowLabelSpacing),
            modifier = Modifier.weight(1f),
        ) {
            Text(
                text = title,
                color = if (dimmed) colors.muted else colors.heading,
                fontSize = PrismDimensions.fontRowTitle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitle,
                color = colors.muted,
                fontSize = PrismDimensions.fontCaption,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        trailing()
    }
}

/**
 * 라벨과 그 아래 컨트롤 한 벌(웹 `.setup__field`).
 *
 * **라벨은 컨트롤이 아니라 부르는 쪽이 그린다.** 로비는 셀렉트마다 제 이름을 얹지만
 * (`카메라`·`마이크`), 진단 패널은 둘 위에 `카메라 · 마이크` 하나를 얹는다 — 컨트롤이
 * 제 라벨을 그리면 진단에서 이름이 두 번 나온다(시안 `Devices` 프레임).
 *
 * @param spacing 로비는 6, 진단 설정은 8(웹 `.setup__field` · `.diag__setting`).
 */
@Composable
fun CallField(
    label: String,
    modifier: Modifier = Modifier,
    spacing: Dp = PrismDimensions.callFieldSpacing,
    content: @Composable () -> Unit,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(spacing),
        modifier = modifier,
    ) {
        Text(
            text = label,
            color = PrismTheme.colors.text,
            fontSize = PrismDimensions.fontBody,
        )
        content()
    }
}

/**
 * 카메라·마이크 선택(시안 `Molecule/Select`, `Leading icon` 꺼짐).
 *
 * 트리거는 48 — 375에서 손가락이 누르는 표적이라 시안의 39에서 키운다(대시보드의
 * 셀렉트가 같은 이유로 같은 값을 쓴다). 보이는 라벨은 `CallField`가 갖고, 여기서는
 * 화면 낭독기용 이름으로만 남는다(웹 `SelectMenu`의 `aria-label`).
 */
@Composable
fun CallDeviceSelect(
    /** 낭독기 전용 이름 — 화면에는 그리지 않는다. */
    label: String,
    options: List<MediaDeviceOption>,
    selectedId: String?,
    onSelect: (String) -> Unit,
) {
    val colors = PrismTheme.colors
    var open by remember { mutableStateOf(false) }
    val current = options.firstOrNull { it.id == selectedId } ?: options.firstOrNull()

    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
            modifier = Modifier
                .fillMaxWidth()
                .height(PrismDimensions.selectTriggerHeight)
                .clip(RoundedCornerShape(PrismDimensions.radiusMd))
                .background(if (open) colors.secondaryBackground else Color.Transparent)
                .selectable(selected = open, onClick = { open = true })
                .semantics { contentDescription = label }
                .padding(horizontal = PrismDimensions.selectTriggerPadding),
        ) {
            Text(
                text = current?.label ?: "—",
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(
                // 셰브런은 **펴지는 방향**을 가리킨다 — 아래로 펼치는 메뉴는 아래.
                painter = painterResource(
                    if (open) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down,
                ),
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier.size(PrismDimensions.iconSize),
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = {
                        Text(
                            text = option.label,
                            color = if (option.id == current?.id) colors.text else colors.muted,
                            fontSize = PrismDimensions.fontBody,
                            fontWeight = if (option.id == current?.id) {
                                FontWeight.SemiBold
                            } else {
                                FontWeight.Normal
                            },
                        )
                    },
                    onClick = {
                        onSelect(option.id)
                        open = false
                    },
                )
            }
        }
    }
}
