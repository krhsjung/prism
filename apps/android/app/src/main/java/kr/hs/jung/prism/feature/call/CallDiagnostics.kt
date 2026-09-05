package kr.hs.jung.prism.feature.call

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import android.content.ClipData
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.calling.CallStats
import kr.hs.jung.prism.core.calling.CandidateInfo
import kr.hs.jung.prism.core.calling.IcePath
import kr.hs.jung.prism.core.calling.MediaDeviceOption
import kr.hs.jung.prism.core.calling.SignalDirection
import kr.hs.jung.prism.core.calling.SignalLog
import kr.hs.jung.prism.core.calling.SignalLogEntry
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.ui.component.PrismBadge
import kr.hs.jung.prism.ui.component.PrismBadgeVariant
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant
import java.util.Locale

@StringRes
internal fun icePathLabel(path: IcePath): Int = when (path) {
    IcePath.DIRECT -> R.string.webrtc_ice_path_direct
    IcePath.REFLEXIVE -> R.string.webrtc_ice_path_reflexive
    IcePath.RELAY -> R.string.webrtc_ice_path_relay
    IcePath.LOOPBACK -> R.string.webrtc_ice_path_loopback
}

/** 릴레이는 **실패가 아니라 비싼 성공**이다 — 그래서 ERROR가 아니라 WARNING이다(§4). */
internal fun icePathVariant(path: IcePath): PrismBadgeVariant = when (path) {
    IcePath.DIRECT -> PrismBadgeVariant.SUCCESS
    IcePath.REFLEXIVE -> PrismBadgeVariant.INFO
    IcePath.RELAY -> PrismBadgeVariant.WARNING
    IcePath.LOOPBACK -> PrismBadgeVariant.NEUTRAL
}

/**
 * 통화 아래 접이식 진단 — 시안 `Organism/Diagnostics` `Breakpoint=Mobile`.
 *
 * **덮지 않고 민다**(plan/webrtc.md §4). 진단하려는 대상이 영상인데 그 위를 덮으면
 * 지표와 화면을 같이 볼 수 없다. 시트는 드래그 핸들·백드롭·스냅이 딸린 플랫폼 모양의
 * 새 컴포넌트라 iOS·Android에 각각 빚이 생긴다 — 접이식은 이미 세 번 만들어 본 모양이다.
 *
 * 절 순서는 **Quality · Connection · Settings · Signaling**: 지금 어떤가 → 왜 그런가 →
 * 바꿔 본다 → 무슨 일이 있었나. 375에서는 네 절을 1열로 쌓고 라벨 위·값 아래로 접는다.
 */
@Composable
fun CallDiagnostics(
    stats: CallStats?,
    connectedAtMs: Long?,
    isLoopback: Boolean,
    log: List<SignalLogEntry>,
    icePolicy: IcePolicy,
    cameras: List<MediaDeviceOption>,
    microphones: List<MediaDeviceOption>,
    cameraId: String?,
    microphoneId: String?,
    onClearLog: () -> Unit,
    onIcePolicy: (IcePolicy) -> Unit,
    onSelectCamera: (String) -> Unit,
    onSelectMicrophone: (String) -> Unit,
) {
    val colors = PrismTheme.colors
    var open by remember { mutableStateOf(false) }
    val dash = stringResource(R.string.webrtc_stat_unavailable)
    // 루프백은 소켓을 지나지 않으므로 경로가 후보 쌍이 아니라 **사실**로 정해진다.
    val path = if (isLoopback) IcePath.LOOPBACK else stats?.path

    Column(modifier = Modifier.fillMaxWidth()) {
        HorizontalDivider(color = colors.border)

        // 접혀 있어도 **요약을 보여준다** — 아무 말도 안 하는 행은 열어 볼 이유를 화면이
        // 주지 못한다. 아직 연결이 없으면 옛 수치가 아니라 `—`다. 375에서는 두 값만 둔다.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
            modifier = Modifier
                .fillMaxWidth()
                .clickable { open = !open }
                .padding(
                    horizontal = PrismDimensions.callCardInset,
                    vertical = PrismDimensions.callHeadPadding,
                ),
        ) {
            Icon(
                // 셰브런은 **펴지는 방향**을 가리킨다(접혀 있으면 아래, 펴져 있으면 위).
                painter = painterResource(
                    if (open) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down,
                ),
                contentDescription = stringResource(
                    if (open) R.string.webrtc_diag_hide else R.string.webrtc_diag_show,
                ),
                tint = colors.heading,
                modifier = Modifier.size(PrismDimensions.iconSize),
            )
            Text(
                text = stringResource(R.string.webrtc_diagnostics),
                color = colors.heading,
                fontSize = PrismDimensions.fontBody,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = "${stats?.rttMs?.let { "$it ms" } ?: dash} · " +
                    (path?.let { stringResource(icePathLabel(it)) } ?: dash),
                color = colors.muted,
                fontSize = PrismDimensions.fontCodeSmall,
                fontFamily = FontFamily.Monospace,
            )
        }

        if (open) {
            HorizontalDivider(color = colors.border)
            Column(
                verticalArrangement = Arrangement.spacedBy(PrismDimensions.callDiagSectionSpacing),
                modifier = Modifier.padding(
                    horizontal = PrismDimensions.callDiagBodyInset,
                    vertical = PrismDimensions.callDiagBodyPadding,
                ),
            ) {
                Quality(stats, dash)
                Connection(stats, path, connectedAtMs, dash)
                HorizontalDivider(color = colors.border)
                Settings(
                    icePolicy = icePolicy,
                    cameras = cameras,
                    microphones = microphones,
                    cameraId = cameraId,
                    microphoneId = microphoneId,
                    onIcePolicy = onIcePolicy,
                    onSelectCamera = onSelectCamera,
                    onSelectMicrophone = onSelectMicrophone,
                )
                HorizontalDivider(color = colors.border)
                Signaling(log = log, isLoopback = isLoopback, onClearLog = onClearLog)
            }
        }
    }
}

/**
 * 여섯 지표. **없는 값은 0이 아니라 `—`다** — 없는 숫자를 0으로 그리면 화면이
 * "패킷 손실 0%"라고 거짓말을 한다(§4).
 */
@Composable
private fun Quality(stats: CallStats?, dash: String) {
    Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callDiagRowSpacing)) {
        SectionTitle(stringResource(R.string.webrtc_diag_quality))
        val cells = listOf(
            stringResource(R.string.webrtc_stat_rtt) to stats?.rttMs?.let { "$it ms" },
            stringResource(R.string.webrtc_stat_jitter) to stats?.jitterMs?.let { "$it ms" },
            stringResource(R.string.webrtc_stat_packet_loss) to
                stats?.packetLossPct?.let { "${trim(it)} %" },
            stringResource(R.string.webrtc_stat_sending) to stats?.sendingKbps?.let(::bitrate),
            stringResource(R.string.webrtc_stat_receiving) to stats?.receivingKbps?.let(::bitrate),
            stringResource(R.string.webrtc_stat_video) to stats?.video?.let {
                "${it.width}×${it.height}" + (it.fps?.let { fps -> " · $fps" } ?: "")
            },
        )
        // 375에서 두 칸씩 — 한 줄에 셋을 두면 값이 잘린다. LazyVerticalGrid를 쓰지 않는
        // 이유: 이 패널이 이미 세로 스크롤 안에 있어 중첩 스크롤이 된다.
        cells.chunked(2).forEach { row ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(PrismDimensions.callDiagRowSpacing),
                modifier = Modifier.fillMaxWidth(),
            ) {
                row.forEach { (label, value) ->
                    Stat(label, value ?: dash, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

/**
 * 지표 한 칸 — 시안 `Molecule/Stat`. 라벨은 Manrope, **값은 모노**다(1자리↔3자리 ms가
 * 매초 바뀌므로 자리가 흔들리면 안 된다).
 */
@Composable
private fun Stat(label: String, value: String, modifier: Modifier = Modifier) {
    val colors = PrismTheme.colors
    Column(
        verticalArrangement = Arrangement.spacedBy(PrismDimensions.callStatLabelSpacing),
        modifier = modifier
            .clip(RoundedCornerShape(PrismDimensions.radiusMd))
            .background(colors.secondaryBackground)
            .padding(
                horizontal = PrismDimensions.callStatPaddingH,
                vertical = PrismDimensions.callStatPaddingV,
            ),
    ) {
        Text(
            text = label.uppercase(Locale.getDefault()),
            color = colors.muted,
            fontSize = PrismDimensions.fontCodeSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = value,
            color = colors.text,
            fontSize = PrismDimensions.fontBody,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun Connection(
    stats: CallStats?,
    path: IcePath?,
    connectedAtMs: Long?,
    dash: String,
) {
    val hidden = stringResource(R.string.webrtc_ice_address_hidden)
    Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callDiagRowSpacing)) {
        SectionTitle(stringResource(R.string.webrtc_diag_connection))

        Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callDiagLabelSpacing)) {
            RowLabel(stringResource(R.string.webrtc_ice_path))
            if (path != null) {
                PrismBadge(stringResource(icePathLabel(path)), icePathVariant(path))
            } else {
                MonoValue(dash)
            }
        }
        // 후보는 **타입·전송까지만**. 주소는 마스킹한다(§7).
        DiagRow(stringResource(R.string.webrtc_ice_local), candidate(stats?.local, hidden) ?: dash)
        DiagRow(stringResource(R.string.webrtc_ice_remote), candidate(stats?.remote, hidden) ?: dash)
        DiagRow(stringResource(R.string.webrtc_ice_state), stats?.iceState ?: dash)
        // DTLS 한 줄이 **미디어가 암호화됐다는 증거**다.
        DiagRow(stringResource(R.string.webrtc_dtls_state), stats?.dtlsState ?: dash)

        Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callDiagLabelSpacing)) {
            RowLabel(stringResource(R.string.webrtc_connected_for))
            if (connectedAtMs != null) Elapsed(connectedAtMs) else MonoValue(dash)
        }
    }
}

/** 통화가 이어진 시간. **초 단위로만 센다** — 밀리초는 읽기 전에 바뀐다. */
@Composable
private fun Elapsed(sinceMs: Long) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(sinceMs) {
        while (true) {
            delay(1_000)
            now = System.currentTimeMillis()
        }
    }
    val seconds = ((now - sinceMs) / 1_000).coerceAtLeast(0)
    MonoValue(String.format(Locale.US, "%02d:%02d", seconds / 60, seconds % 60))
}

/**
 * **바꿀 수 있는 것은 두 가지뿐이다** — ICE 정책과 장치(§4). 나머지 KVS 설정은 전부
 * 읽기 전용 값으로 바뀌었다.
 */
@Composable
private fun Settings(
    icePolicy: IcePolicy,
    cameras: List<MediaDeviceOption>,
    microphones: List<MediaDeviceOption>,
    cameraId: String?,
    microphoneId: String?,
    onIcePolicy: (IcePolicy) -> Unit,
    onSelectCamera: (String) -> Unit,
    onSelectMicrophone: (String) -> Unit,
) {
    val colors = PrismTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callDiagRowSpacing)) {
        SectionTitle(stringResource(R.string.webrtc_diag_settings))

        // 진단에서는 셀렉트 둘 위에 **합친 라벨 하나**를 얹는다 — 컨트롤이 제 라벨을
        // 그리던 시절에는 `카메라 · 마이크` 밑에 다시 `카메라`가 나왔다(시안 `Devices`).
        // 간격은 8: 라벨과 누를 수 있는 것 사이다(웹 `.diag__setting`).
        Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm)) {
            RowLabel(stringResource(R.string.webrtc_ice_policy))
            // `TURN only`는 TURN을 v1부터 넣기로 한 결정이 값을 하는지 **화면에서
            // 증명하는 유일한 스위치**다 — 누르면 `Path`가 즉시 Relayed로 바뀐다.
            Radio(stringResource(R.string.webrtc_ice_policy_all), icePolicy == IcePolicy.ALL) {
                onIcePolicy(IcePolicy.ALL)
            }
            Radio(stringResource(R.string.webrtc_ice_policy_relay), icePolicy == IcePolicy.RELAY) {
                onIcePolicy(IcePolicy.RELAY)
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm)) {
            RowLabel(
                "${stringResource(R.string.webrtc_camera)} · " +
                    stringResource(R.string.webrtc_microphone),
            )
            if (cameras.isNotEmpty()) {
                CallDeviceSelect(
                    label = stringResource(R.string.webrtc_camera),
                    options = cameras,
                    selectedId = cameraId,
                    onSelect = onSelectCamera,
                )
            }
            if (microphones.isNotEmpty()) {
                CallDeviceSelect(
                    label = stringResource(R.string.webrtc_microphone),
                    options = microphones,
                    selectedId = microphoneId,
                    onSelect = onSelectMicrophone,
                )
            }
        }

        Text(
            text = stringResource(R.string.webrtc_ice_policy_note),
            color = colors.muted,
            fontSize = PrismDimensions.fontBody,
        )
    }
}

/** 시안 `Atom/Radio` — 18 원. 줄 전체가 표적이다. */
@Composable
private fun Radio(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = PrismTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, onClick = onClick),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(PrismDimensions.callRadioSize)
                .clip(CircleShape)
                .background(colors.card)
                .border(1.dp, if (selected) colors.primary else colors.border, CircleShape),
        ) {
            if (selected) {
                Box(
                    modifier = Modifier
                        .size(PrismDimensions.spacingSm)
                        .clip(CircleShape)
                        .background(colors.primary),
                )
            }
        }
        Text(text = label, color = colors.text, fontSize = PrismDimensions.fontBody)
    }
}

/**
 * 로그는 유일하게 계속 자라는 영역이라 맨 아래에 두고 **내부 스크롤**을 갖는다
 * (모바일 160). 레벨이 아니라 **방향**(→ 보냄 / ← 받음)으로 가른다.
 */
@Composable
private fun Signaling(
    log: List<SignalLogEntry>,
    isLoopback: Boolean,
    onClearLog: () -> Unit,
) {
    val colors = PrismTheme.colors
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callDiagRowSpacing)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingXs),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Box(modifier = Modifier.weight(1f)) {
                SectionTitle(stringResource(R.string.webrtc_diag_signaling))
            }
            PrismButton(
                text = stringResource(R.string.webrtc_log_copy),
                variant = PrismButtonVariant.GHOST,
                enabled = log.isNotEmpty(),
                // 사용자가 누를 때만 동작하고 **자동 전송은 없다**(§7).
                onClick = {
                    scope.launch {
                        clipboard.setClipEntry(
                            ClipEntry(ClipData.newPlainText("prism-signaling", SignalLog.format(log))),
                        )
                    }
                },
                fillWidth = false,
            )
            PrismButton(
                text = stringResource(R.string.webrtc_log_clear),
                variant = PrismButtonVariant.GHOST,
                enabled = log.isNotEmpty(),
                onClick = onClearLog,
                fillWidth = false,
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(PrismDimensions.callLogHeight)
                .clip(RoundedCornerShape(PrismDimensions.radiusMd))
                .background(colors.secondaryBackground)
                .border(1.dp, colors.border, RoundedCornerShape(PrismDimensions.radiusMd))
                .padding(PrismDimensions.callLogPadding),
        ) {
            if (log.isEmpty()) {
                Text(
                    // 루프백은 시그널링을 타지 않으므로 **비어 있는 것이 정상이다**(§4).
                    text = stringResource(
                        if (isLoopback) R.string.webrtc_log_loopback else R.string.webrtc_log_empty,
                    ),
                    color = colors.muted,
                    fontSize = PrismDimensions.fontCodeSmall,
                )
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(PrismDimensions.callLogLineSpacing),
                ) {
                    items(log, key = { it.id }) { entry -> LogLine(entry) }
                }
            }
        }
    }
}

/**
 * 시안 `Atom/LogLine` `Compact=Yes` — 375에서는 밀리초를 뺀다(초 단위로도 순서와 간격은
 * 읽힌다). 열 너비를 고정하는 것이 요점이다: 값이 세로로 읽혀야 한다.
 */
@Composable
private fun LogLine(entry: SignalLogEntry) {
    val colors = PrismTheme.colors
    val sent = entry.direction == SignalDirection.SENT
    val direction = stringResource(
        if (sent) R.string.webrtc_log_sent else R.string.webrtc_log_received,
    )
    Row(
        horizontalArrangement = Arrangement.spacedBy(PrismDimensions.callLogColumnSpacing),
        modifier = Modifier
            .fillMaxWidth()
            // 네 열이 따로 읽히면 "12:04:52", "→", "offer"가 남남이 된다 — 줄 전체를
            // 한 덩어리로 읽히게 하고, 화살표는 말로 옮긴다.
            .clearAndSetSemantics {
                contentDescription = "$direction ${entry.type} ${entry.detail.orEmpty()}"
            },
    ) {
        LogCell(
            SignalLog.stamp(entry.atMs, compact = true),
            colors.muted,
            Modifier.width(PrismDimensions.callLogStampWidth),
        )
        LogCell(
            if (sent) "→" else "←",
            // 보낸 줄만 강조색이다 — 받은 줄까지 물들이면 방향이 색으로 읽히지 않는다.
            if (sent) colors.accent else colors.muted,
            Modifier.width(PrismDimensions.callLogArrowWidth),
        )
        LogCell(
            entry.type,
            // 색은 **오류 줄에만** 쓴다(§4).
            if (entry.isError) colors.error else colors.text,
            Modifier.width(PrismDimensions.callLogTypeWidth),
        )
        LogCell(entry.detail ?: "", colors.muted, Modifier.weight(1f))
    }
}

@Composable
private fun LogCell(text: String, color: Color, modifier: Modifier) {
    Text(
        text = text,
        color = color,
        fontSize = PrismDimensions.fontCodeSmall,
        fontFamily = FontFamily.Monospace,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}

@Composable
private fun SectionTitle(title: String) {
    Text(
        text = title,
        color = PrismTheme.colors.heading,
        fontSize = PrismDimensions.fontBody,
    )
}

@Composable
private fun RowLabel(label: String) {
    Text(text = label, color = PrismTheme.colors.muted, fontSize = PrismDimensions.fontBody)
}

@Composable
private fun MonoValue(value: String) {
    Text(
        text = value,
        color = PrismTheme.colors.text,
        fontSize = PrismDimensions.fontCodeSmall,
        fontFamily = FontFamily.Monospace,
    )
}

@Composable
private fun DiagRow(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callDiagLabelSpacing)) {
        RowLabel(label)
        MonoValue(value)
    }
}

private fun bitrate(kbps: Int): String = if (kbps >= 1_000) {
    String.format(Locale.US, "%.1f Mbps", kbps / 1_000.0)
} else {
    "$kbps kbps"
}

/** 소수 첫째 자리까지만 — `0.1 %`처럼 시안의 자리수를 지킨다. */
private fun trim(value: Double): String = if (value == value.toLong().toDouble()) {
    value.toLong().toString()
} else {
    String.format(Locale.US, "%.1f", value)
}

private fun candidate(info: CandidateInfo?, hidden: String): String? {
    if (info == null) return null
    return listOfNotNull(info.type, info.protocol, hidden).joinToString(" · ")
}
