package kr.hs.jung.prism.feature.dashboard

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.launch
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.LocaleStore
import kr.hs.jung.prism.core.network.SessionSocket
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.core.theme.ThemeStore
import kr.hs.jung.prism.domain.model.DeviceKind
import kr.hs.jung.prism.domain.model.SessionListItem
import kr.hs.jung.prism.domain.model.User
import kr.hs.jung.prism.ui.component.LocaleSwitcher
import kr.hs.jung.prism.ui.component.PreferenceControls
import kr.hs.jung.prism.ui.component.PreferenceControlsPlacement
import kr.hs.jung.prism.ui.component.PrismAvatar
import kr.hs.jung.prism.ui.component.PrismBadge
import kr.hs.jung.prism.ui.component.PrismBadgeVariant
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant
import kr.hs.jung.prism.ui.component.PrismCard
import kr.hs.jung.prism.ui.component.PrismConfirmDialog
import kr.hs.jung.prism.ui.component.PrismErrorAlert
import kr.hs.jung.prism.ui.component.ThemeSwitcher

/**
 * 대시보드 — 로그인 이후의 화면. 시안 `Dashboard / Mobile / Default`·`Drawer (open)`.
 *
 * 셸은 상단 바 하나와 드로어 하나다. 상단 바에는 워드마크·아바타·햄버거만 두고
 * (시안), 내비게이션과 환경 설정·로그아웃은 드로어로 내린다 — 좁은 폭에서 한 줄에
 * 밀어 넣으면 글자가 세로로 쪼개진다(웹이 같은 이유로 같은 배치를 쓴다).
 *
 * 콘텐츠는 **활성 세션 카드 하나**다. 인사말·통계·계정 상세는 의도적으로 뺐다
 * (plan/dashboard.md §2 — 집계할 도메인 데이터도, 저장하는 PII도 없다).
 */
@Composable
fun DashboardScreen(
    user: User,
    themeStore: ThemeStore,
    localeStore: LocaleStore,
    sessionsApi: SessionsApi,
    tokens: SessionTokens,
    socket: SessionSocket,
    onSignOut: () -> Unit,
) {
    // 이 ViewModel의 수명은 **세션**이다 — 로그아웃하면 저장소째 비워지고, 다시 로그인하면
    // 새로 만들어진다(`ui/SessionScope.kt`). 기본 저장소(Activity)에 그냥 두면 앞 세션의
    // 목록이 새 세션 화면에 그대로 그려진다.
    val viewModel: DashboardViewModel = viewModel(
        factory = viewModelFactory {
            initializer {
                DashboardViewModel(
                    api = sessionsApi,
                    tokens = tokens,
                    // 전체 폐기·현재 세션 해제로 이 앱의 세션이 끝나면 로그아웃과 같은
                    // 자리로 돌아간다 — 세션 상태의 진실은 AuthManager 하나뿐이다.
                    onSessionEnded = { onSignOut() },
                    // 소켓의 수명도 이 ViewModel과 같다 — 세션이 끝나면 함께 버려진다.
                    socket = socket,
                )
            }
        },
    )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = PrismTheme.colors
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    // 전체 로그아웃은 되돌릴 수 없다 — 누르면 바로 실행하지 않고 한 번 되묻는다.
    var confirmingSignOutAll by remember { mutableStateOf(false) }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            DrawerContent(
                themeStore = themeStore,
                localeStore = localeStore,
                onSignOut = onSignOut,
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.surface)
                // MainActivity가 enableEdgeToEdge를 켜 두었다 — 켜 두지 않으면 상단 바가
                // 상태바 아래로 들어가 워드마크가 시계와 겹친다.
                .systemBarsPadding(),
        ) {
            TopBar(
                userName = user.displayName,
                onOpenMenu = { scope.launch { drawerState.open() } },
            )
            // 세션 목록은 이 앱 밖에서도 바뀐다 — 다른 기기에서 로그인하거나 만료되면
            // 화면과 서버가 어긋난다. 당겨서 새로고침이 그것을 맞추는 사용자의 손잡이다.
            val pullState = rememberPullToRefreshState()
            PullToRefreshBox(
                isRefreshing = state.refreshing,
                onRefresh = viewModel::pullRefresh,
                state = pullState,
                indicator = {
                    // 기본 인디케이터는 material 기본 팔레트를 쓴다 — 우리는 몇 개 역할만
                    // 덮어썼기 때문에 그대로 두면 이 동그라미만 남의 색이 된다.
                    PullToRefreshDefaults.Indicator(
                        state = pullState,
                        isRefreshing = state.refreshing,
                        containerColor = colors.card,
                        color = colors.primary,
                        modifier = Modifier.align(Alignment.TopCenter),
                    )
                },
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(PrismDimensions.topBarHorizontalPadding),
                ) {
                    SessionsCard(
                        state = state,
                        onRevoke = viewModel::revoke,
                        onSignOutAll = { confirmingSignOutAll = true },
                        onRetry = viewModel::load,
                    )
                }
            }
        }
    }

    if (confirmingSignOutAll) {
        PrismConfirmDialog(
            title = stringResource(R.string.dashboard_sign_out_all_confirm_title),
            message = stringResource(R.string.dashboard_sign_out_all_confirm_body),
            confirmText = stringResource(R.string.dashboard_sign_out_all),
            cancelText = stringResource(R.string.common_cancel),
            busy = state.signingOutAll,
            onConfirm = {
                confirmingSignOutAll = false
                viewModel.signOutAll()
            },
            onCancel = { confirmingSignOutAll = false },
        )
    }
}

/** 시안 `MobileTopBar` — 워드마크 · 아바타 · 햄버거. 페이지 이름은 드로어가 말한다. */
@Composable
private fun TopBar(userName: String, onOpenMenu: () -> Unit) {
    val colors = PrismTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(PrismDimensions.topBarHeight)
            .background(colors.card)
            .padding(horizontal = PrismDimensions.topBarHorizontalPadding),
    ) {
        // 워드마크는 번역하지 않는다 — 로고 텍스트는 언어와 무관한 고유명사다.
        Text(
            text = "Prism",
            color = colors.heading,
            fontSize = PrismDimensions.fontSectionTitle,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier.weight(1f),
        )
        PrismAvatar(name = userName)
        IconButton(
            onClick = onOpenMenu,
            // 아이콘은 24로 그리되 누르는 영역은 48까지 넓힌다(최소 터치 크기).
            modifier = Modifier.size(PrismDimensions.topBarTouchTarget),
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_menu),
                contentDescription = stringResource(R.string.dashboard_open_menu),
                tint = colors.heading,
                modifier = Modifier.size(PrismDimensions.topBarIconSize),
            )
        }
    }
    HorizontalDivider(color = colors.border)
}

/**
 * 시안 `Drawer Panel` — 브랜드 + 내비게이션. 그 아래 환경 설정·로그아웃은 시안에
 * 그려져 있지 않지만, 모바일 상단 바에서 밀려난 것들이 갈 곳이 여기뿐이다.
 */
@Composable
private fun DrawerContent(
    themeStore: ThemeStore,
    localeStore: LocaleStore,
    onSignOut: () -> Unit,
) {
    val colors = PrismTheme.colors
    ModalDrawerSheet(
        drawerContainerColor = colors.card,
        modifier = Modifier.width(PrismDimensions.drawerWidth),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                // 드로어 시트도 상태바·내비게이션바를 피한다(본문과 같은 이유).
                .systemBarsPadding()
                .padding(PrismDimensions.topBarHorizontalPadding),
            verticalArrangement = Arrangement.spacedBy(PrismDimensions.spacingLg),
        ) {
            Text(
                text = "Prism",
                color = colors.heading,
                fontSize = PrismDimensions.fontSectionTitle,
                fontWeight = FontWeight.ExtraBold,
            )
            NavItem(label = stringResource(R.string.dashboard_title), active = true)
            // WebRTC는 다음 슬라이스 — 자리만 잡아두고 비활성으로 둔다(plan/dashboard.md).
            NavItem(
                label = stringResource(R.string.dashboard_nav_webrtc),
                active = false,
                trailing = stringResource(R.string.dashboard_coming_soon),
            )
            Box(modifier = Modifier.weight(1f))
            HorizontalDivider(color = colors.border)
            PreferenceControls(themeStore, localeStore, PreferenceControlsPlacement.DRAWER)
            PrismButton(
                text = stringResource(R.string.dashboard_log_out),
                variant = PrismButtonVariant.OUTLINE,
                onClick = onSignOut,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** 시안 `Atom/NavItem` — 활성은 soft blue 배경, 예약 항목은 muted + 배지. */
@Composable
private fun NavItem(label: String, active: Boolean, trailing: String? = null) {
    val colors = PrismTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
        modifier = Modifier
            .fillMaxWidth()
            .height(PrismDimensions.navItemHeight)
            .background(
                if (active) colors.secondaryBackground else colors.card,
                RoundedCornerShape(PrismDimensions.radiusMd),
            )
            .padding(horizontal = PrismDimensions.navItemPadding),
    ) {
        Text(
            text = label,
            color = if (active) colors.heading else colors.muted,
            fontSize = PrismDimensions.fontBody,
            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        )
        if (trailing != null) {
            PrismBadge(text = trailing, variant = PrismBadgeVariant.INFO)
        }
    }
}

/**
 * 배지가 말하는 것은 **연결 여부**지 세션의 유효성이 아니다(목록에는 유효한 세션만 온다).
 *
 * ⚠️ [socketReady]가 false면 [SessionListItem.isConnected]를 믿지 않고 두 갈래로 물러난다.
 * 내 소켓이 붙어 있지 않으면 서버가 내려준 빈 presence가 "아무도 안 붙었다"인지
 * "소켓 서비스가 죽었다"인지 구별할 수 없고, 후자를 전자로 읽으면 멀쩡한 기기들을
 * 전부 "비활성"이라고 지어내게 된다 — 모를 때는 지어내지 않는 쪽으로 실패한다.
 */
@StringRes
internal fun statusLabel(session: SessionListItem, socketReady: Boolean): Int = when {
    session.isCurrent -> R.string.dashboard_status_current
    !socketReady || session.isConnected -> R.string.dashboard_status_active
    else -> R.string.dashboard_status_inactive
}

internal fun statusVariant(session: SessionListItem, socketReady: Boolean): PrismBadgeVariant =
    when {
        session.isCurrent -> PrismBadgeVariant.SUCCESS
        !socketReady || session.isConnected -> PrismBadgeVariant.INFO
        else -> PrismBadgeVariant.NEUTRAL
    }

/** 시안 `SessionsCard` — 제목 · 요약 · 세션 행들. */
@Composable
private fun SessionsCard(
    state: DashboardUiState,
    onRevoke: (String) -> Unit,
    onSignOutAll: () -> Unit,
    onRetry: () -> Unit,
) {
    val colors = PrismTheme.colors
    // 여백을 카드가 아니라 **각 구획**이 갖는다 — 그래야 구분선이 카드 폭을 가로지른다
    // (웹 `.sessions { padding: 0 }`와 같은 구조).
    PrismCard(contentPadding = 0.dp, spacing = 0.dp) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PrismDimensions.headSpacing),
            modifier = Modifier.padding(
                horizontal = PrismDimensions.sessionCardInset,
                vertical = PrismDimensions.sessionHeadPadding,
            ),
        ) {
            Text(
                text = stringResource(R.string.dashboard_active_sessions),
                color = colors.heading,
                fontSize = PrismDimensions.fontSectionTitle,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                text = stringResource(R.string.dashboard_active_sessions_desc),
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
            )
        }

        state.actionErrorRes?.let {
            PrismErrorAlert(
                message = stringResource(it),
                modifier = Modifier
                    .padding(horizontal = PrismDimensions.sessionCardInset)
                    .padding(bottom = PrismDimensions.sessionHeadPadding),
            )
        }

        when {
            state.loadErrorRes != null -> {
                Column(
                    verticalArrangement = Arrangement.spacedBy(PrismDimensions.spacingMd),
                    modifier = Modifier
                        .padding(horizontal = PrismDimensions.sessionCardInset)
                        .padding(bottom = PrismDimensions.sessionHeadPadding),
                ) {
                    PrismErrorAlert(message = stringResource(state.loadErrorRes))
                    PrismButton(
                        text = stringResource(R.string.common_retry),
                        variant = PrismButtonVariant.SECONDARY,
                        onClick = onRetry,
                        fillWidth = false,
                    )
                }
            }
            state.sessions == null -> Text(
                text = stringResource(R.string.common_loading),
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
                modifier = Modifier
                    .padding(horizontal = PrismDimensions.sessionCardInset)
                    .padding(bottom = PrismDimensions.sessionHeadPadding),
            )
            // 현재 세션은 항상 하나 있으므로 "0건"은 없다 — 1건이 "나 혼자"다.
            state.sessions.size == 1 -> Text(
                text = stringResource(R.string.dashboard_only_this_session),
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
                modifier = Modifier
                    .padding(horizontal = PrismDimensions.sessionCardInset)
                    .padding(bottom = PrismDimensions.sessionHeadPadding),
            )
            else -> state.sessions.forEach { session ->
                SessionRow(
                    session = session,
                    socketReady = state.socketReady,
                    revoking = state.revokingId == session.id,
                    enabled = state.revokingId == null && !state.signingOutAll,
                    onRevoke = { onRevoke(session.id) },
                )
            }
        }

        // "모두 로그아웃"의 자리는 **목록 아래**다 — 무엇이 끊기는지 다 본 뒤에 전체에 대한
        // 행동을 하게 된다. `SessionRow`가 마지막 행 아래에 이미 구분선을 긋고 있어 그것이
        // 그대로 경계가 된다. 폭을 채우는 것이 중요하다: 행마다 오른쪽에 있는 "해제" 기둥에
        // 이어 붙으면 "행 하나 더"로 읽히고 오탭 표적도 겹친다.
        // (나 말고 다른 세션이 있을 때만 의미가 있다)
        if (state.hasOthers) {
            HorizontalDivider(color = colors.border)
            PrismButton(
                text = stringResource(
                    if (state.signingOutAll) R.string.dashboard_signing_out_all
                    else R.string.dashboard_sign_out_all,
                ),
                variant = PrismButtonVariant.SECONDARY,
                enabled = !state.signingOutAll,
                // 되돌릴 수 없다 — 바로 실행하지 않고 한 번 되묻는다.
                onClick = onSignOutAll,
                modifier = Modifier.padding(
                    horizontal = PrismDimensions.sessionCardInset,
                    vertical = PrismDimensions.sessionRowPadding,
                ),
            )
        }
    }
}

/**
 * 세션 한 줄 — 시안 `SessionRow`.
 *
 * 시안은 기기 이름과 브라우저·위치를 보여주지만 **계약에 그런 값이 없다**(UA·IP 미저장,
 * plan/dashboard.md §5). 그 자리에 "현재 세션 / 로그인된 세션"과 짧은 세션 id를 그린다 —
 * 시안의 라벨은 시각적 밀도를 잡기 위한 자리표시로 읽는다.
 */
@Composable
private fun SessionRow(
    session: SessionListItem,
    socketReady: Boolean,
    revoking: Boolean,
    enabled: Boolean,
    onRevoke: () -> Unit,
) {
    val colors = PrismTheme.colors
    // 선은 행의 **위**에 둔다. 그러면 첫 행 위(= 카드 머리 아래)에도 한 줄이 생기고,
    // 마지막 행 아래에는 생기지 않는다 — 거기는 카드 끝이거나 자기 선을 가진 푸터다
    // (웹 `.session { border-top }`). 선이 카드 폭을 가로지르도록 여백보다 **밖**에 둔다.
    HorizontalDivider(color = colors.border)
    Column(
        verticalArrangement = Arrangement.spacedBy(PrismDimensions.sessionBlockSpacing),
        modifier = Modifier
            .fillMaxWidth()
            // 끊기는 중인 행은 통째로 흐려진다. 바쁜 것은 버튼이 아니라 **이 세션**이고,
            // 곧 사라질 행이라 그 예고로도 읽힌다. 크기가 변하지 않아 목록이 흔들리지 않는다.
            .alpha(if (revoking) PrismDimensions.buttonDisabledAlpha else 1f)
            .padding(
                horizontal = PrismDimensions.sessionCardInset,
                vertical = PrismDimensions.sessionRowPadding,
            ),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingMd),
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(PrismDimensions.sessionIconTile)
                    .background(
                        colors.secondaryBackground,
                        RoundedCornerShape(PrismDimensions.radiusMd),
                    ),
            ) {
                Icon(
                    painter = painterResource(deviceIcon(session.device)),
                    contentDescription = null,
                    tint = colors.heading,
                    modifier = Modifier.size(PrismDimensions.sessionIconGlyph),
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(deviceLabel(session.device)),
                    color = colors.heading,
                    fontSize = PrismDimensions.fontBody,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    // 기기명·브라우저·위치는 저장하지 않으므로(§5) 부제에는 짧은 세션
                    // id만 둔다. "현재/로그인된 세션"은 바로 옆 배지가 이미 말하고 있어,
                    // 함께 적으면 같은 말이 두 번 나오고 좁은 폭에서 줄바꿈까지 만든다.
                    text = "#${session.id.take(8)}",
                    color = colors.muted,
                    fontSize = PrismDimensions.fontLabel,
                )
            }
            PrismBadge(
                text = stringResource(statusLabel(session, socketReady)),
                variant = statusVariant(session, socketReady),
            )
        }
        // 시안에서 시작·만료는 **붙은 한 덩어리**이고(17px 줄 사이 1px), 해제 버튼은
        // 그 덩어리 오른쪽에 세로 가운데로 선다. 만료 줄에만 붙이면 시작 줄 쪽이 빈다.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(
                verticalArrangement = Arrangement.spacedBy(PrismDimensions.sessionWhenSpacing),
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    text = "${stringResource(R.string.dashboard_col_started)} ${formatTimestamp(session.startedAt)}",
                    color = colors.muted,
                    fontSize = PrismDimensions.fontLabel,
                )
                Text(
                    text = "${stringResource(R.string.dashboard_col_expires)} ${formatTimestamp(session.expiresAt)}",
                    color = colors.muted,
                    fontSize = PrismDimensions.fontLabel,
                )
            }
            // 현재 세션에는 해제 버튼을 두지 않는다 — 그건 로그아웃이고, 드로어에 있다.
            if (!session.isCurrent) {
                // 진행 중이라고 **글자를 바꾸지 않는다.** 버튼은 글자만큼만 차지하므로
                // "해제" → "해제하는 중…"이면 폭이 두 배가 되어 행이 통째로 밀린다 —
                // 요청이 짧아 그 흔들림만 깜빡임으로 남는다. 진행 표시는 행 전체를
                // 흐리게 하는 쪽이 맡는다(SessionRow의 alpha).
                val label = stringResource(R.string.dashboard_revoke)
                val which = stringResource(
                    if (session.isCurrent) R.string.dashboard_this_session
                    else R.string.dashboard_a_session,
                )
                val device = stringResource(deviceLabel(session.device))
                PrismButton(
                    text = label,
                    // 손가락에는 hover가 없다 — 판 없는 ghost는 "눌리는 것"이라는 신호를
                    // hover에 기대고 있어, 터치에서는 그냥 글자로 보인다. 그래서 터치
                    // 화면에서는 판을 깐다(웹도 좁은 폭에서 같다).
                    variant = PrismButtonVariant.SECONDARY,
                    enabled = enabled,
                    onClick = onRevoke,
                    fillWidth = false,
                    // 목록에 "해제"가 여럿이라 버튼 글자만으로는 무엇을 끊는지 알 수 없다.
                    modifier = Modifier.semantics {
                        contentDescription = "$label: $device · $which · #${session.id.take(8)}"
                    },
                )
            }
        }
    }
}

/**
 * 기기 종류 → 라벨. 계약이 네 갈래뿐이라 `when`이 전부를 덮고, 갈래가 늘면 컴파일에서 걸린다.
 */
@StringRes
private fun deviceLabel(device: DeviceKind): Int = when (device) {
    DeviceKind.IPHONE -> R.string.dashboard_device_iphone
    DeviceKind.IPAD -> R.string.dashboard_device_ipad
    DeviceKind.GALAXY -> R.string.dashboard_device_galaxy
    DeviceKind.PIXEL -> R.string.dashboard_device_pixel
    DeviceKind.ANDROID -> R.string.dashboard_device_android
    DeviceKind.MAC -> R.string.dashboard_device_mac
    DeviceKind.WINDOWS -> R.string.dashboard_device_windows
    DeviceKind.DESKTOP -> R.string.dashboard_device_desktop
    DeviceKind.UNKNOWN -> R.string.dashboard_device_unknown
}

/**
 * 기기 종류 → 아이콘. **브랜드 로고를 쓰지 않는다** — 상표를 앱에 심는 일이고, 목록에서
 * 필요한 것은 폰·태블릿·데스크톱이라는 형태 구분뿐이다. `unknown`은 모니터를 재사용한다:
 * 모르는 것에 특별한 그림을 주면 그 자체가 하나의 상태처럼 읽힌다.
 */
@DrawableRes
private fun deviceIcon(device: DeviceKind): Int = when (device) {
    DeviceKind.IPHONE, DeviceKind.GALAXY, DeviceKind.PIXEL, DeviceKind.ANDROID ->
        R.drawable.ic_phone
    DeviceKind.IPAD -> R.drawable.ic_tablet
    DeviceKind.MAC, DeviceKind.WINDOWS, DeviceKind.DESKTOP, DeviceKind.UNKNOWN ->
        R.drawable.ic_monitor
}
