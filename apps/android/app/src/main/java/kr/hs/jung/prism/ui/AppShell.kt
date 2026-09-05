package kr.hs.jung.prism.ui

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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DrawerState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.launch
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.LocaleStore
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.core.theme.ThemeStore
import kr.hs.jung.prism.ui.component.PreferenceControls
import kr.hs.jung.prism.ui.component.PreferenceControlsPlacement
import kr.hs.jung.prism.ui.component.PrismAvatar
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant

/** 셸이 아는 페이지. 라우트가 늘면 여기가 먼저 걸린다. */
enum class ShellPage(@param:StringRes val title: Int) {
    DASHBOARD(R.string.dashboard_title),
    WEBRTC(R.string.webrtc_title),
}

/**
 * 앱 셸 — 상단 바 하나와 드로어 하나(시안 `MobileTopBar` · `Drawer Panel`).
 *
 * 상단 바에는 워드마크·아바타·햄버거만 두고, 내비게이션과 환경 설정·로그아웃은 드로어로
 * 내린다 — 좁은 폭에서 한 줄에 밀어 넣으면 글자가 세로로 쪼개진다(웹·iOS가 같은 이유로
 * 같은 배치를 쓴다).
 *
 * **통화 화면도 이 셸 안에 있다**(plan/webrtc.md §4). 몰입형 전체화면을 만들지 않는
 * 이유: 이 슬라이스가 증명하려는 것은 "같은 앱이 네 플랫폼에서 같게 동작한다"이고 셸이
 * 곧 그 앱이다. 통화만 셸을 벗어나면 드로어의 활성 항목이 사라져 지금 어디인지가 화면에서
 * 지워지고, 나가는 길을 컨트롤 바의 종료와 **둘** 설계해야 한다.
 *
 * 본문은 스스로 스크롤한다 — 대시보드는 당겨서 새로고침을, 통화는 바닥 고정 바를 갖기
 * 때문에 셸이 스크롤을 쥐면 둘 다 할 수 없다.
 */
@Composable
fun AppShell(
    page: ShellPage,
    userName: String,
    themeStore: ThemeStore,
    localeStore: LocaleStore,
    drawerState: DrawerState,
    onNavigate: (ShellPage) -> Unit,
    onSignOut: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = PrismTheme.colors
    val scope = rememberCoroutineScope()

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            DrawerContent(
                page = page,
                themeStore = themeStore,
                localeStore = localeStore,
                onNavigate = { target ->
                    if (target == page) {
                        // 같은 페이지 — 화면이 바뀌지 않으므로 닫는 일도 여기서 끝난다.
                        scope.launch { drawerState.close() }
                    } else {
                        // ⚠️ 옮겨 갈 때는 **여기서 닫지 않는다.** 이 스코프는 지금 화면의
                        // 것이라, 페이지가 바뀌면 화면과 함께 취소되어 닫기 애니메이션이
                        // 중간에 죽는다(드로어가 열린 채로 남는다). 닫는 일은 페이지를
                        // 쥐고 있는 쪽 — 두 화면보다 오래 사는 곳 — 이 맡는다.
                        onNavigate(target)
                    }
                },
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
                userName = userName,
                onOpenMenu = { scope.launch { drawerState.open() } },
            )
            content()
        }
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
    page: ShellPage,
    themeStore: ThemeStore,
    localeStore: LocaleStore,
    onNavigate: (ShellPage) -> Unit,
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
            ShellPage.entries.forEach { item ->
                NavItem(
                    label = stringResource(item.title),
                    active = item == page,
                    onClick = { onNavigate(item) },
                )
            }
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

/** 시안 `Atom/NavItem` — 활성은 soft blue 배경. */
@Composable
private fun NavItem(label: String, active: Boolean, onClick: () -> Unit) {
    val colors = PrismTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
        modifier = Modifier
            .fillMaxWidth()
            .height(PrismDimensions.navItemHeight)
            .clip(RoundedCornerShape(PrismDimensions.radiusMd))
            .background(if (active) colors.secondaryBackground else colors.card)
            // 목록에서 하나만 고르는 줄이다 — 스크린 리더가 "선택됨"을 읽도록 표시한다.
            .selectable(selected = active, onClick = onClick)
            .padding(horizontal = PrismDimensions.navItemPadding),
    ) {
        Text(
            text = label,
            color = if (active) colors.heading else colors.muted,
            fontSize = PrismDimensions.fontBody,
            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}
