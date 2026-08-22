package kr.hs.jung.prism.ui.component

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.popup
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.AppLocale
import kr.hs.jung.prism.core.i18n.LocaleStore
import kr.hs.jung.prism.core.theme.AppTheme
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.core.theme.ThemeStore

/**
 * 메뉴가 트리거의 어느 쪽으로 열리는지. 상단 바에서는 아래가 자연스럽지만, 좁고 긴
 * 드로어에서는 트리거가 바닥 가까이 앉아 아래로 열 자리가 없다 — 그 자리에서는 옆으로
 * 편다(웹 `.sidebar__footer .select__menu` · iOS `PreferenceMenuPlacement`와 같은 값).
 */
enum class PreferenceMenuPlacement {
    /** 트리거 아래. 셰브런은 `∨`. */
    BELOW,

    /** 트리거 오른쪽, 윗변을 맞춘다. 셰브런은 `>` — 펼침 방향을 그대로 가리킨다. */
    TRAILING,
}

/**
 * 테마 선택. 고르기 전에는 기기 설정을 따르고(system), 한 번 고르면 그 값이 저장되어
 * 기기 설정과 무관하게 유지된다. 트리거에는 **고른 값**을 그대로 보여준다 — system일 때
 * 지금 칠해진 색을 보여주면 무엇을 골랐는지 알 수 없게 된다(웹 ThemeSwitcher와 같은 규칙).
 *
 * 줄마다 아이콘이 붙는 것이 언어 선택과 다른 점이다(디자인의 `Molecule/ThemeMenu`).
 */
@Composable
fun ThemeSwitcher(
    store: ThemeStore,
    modifier: Modifier = Modifier,
    placement: PreferenceMenuPlacement = PreferenceMenuPlacement.BELOW,
) {
    var open by remember { mutableStateOf(false) }
    PreferenceMenu(
        icon = store.theme.iconRes,
        current = stringResource(store.theme.labelRes),
        contentDescription = stringResource(R.string.common_theme),
        expanded = open,
        onToggle = { open = !open },
        onDismiss = { open = false },
        modifier = modifier,
        placement = placement,
    ) {
        AppTheme.entries.forEach { theme ->
            PreferenceOption(
                label = stringResource(theme.labelRes),
                selected = theme == store.theme,
                icon = theme.iconRes,
                onClick = {
                    store.select(theme)
                    open = false
                },
            )
        }
    }
}

/**
 * 언어 선택. 기기 설정과 다른 언어로 보고 싶은 경우를 위한 탈출구이며, 고른 값은 저장되어
 * 다음 실행에도 유지된다. 각 언어 이름은 그 언어로 적는다(`AppLocale.label`).
 */
@Composable
fun LocaleSwitcher(
    store: LocaleStore,
    modifier: Modifier = Modifier,
    placement: PreferenceMenuPlacement = PreferenceMenuPlacement.BELOW,
) {
    var open by remember { mutableStateOf(false) }
    val activity = LocalContext.current.findActivity()
    PreferenceMenu(
        icon = R.drawable.ic_globe,
        current = store.locale.label,
        contentDescription = stringResource(R.string.common_language),
        expanded = open,
        onToggle = { open = !open },
        onDismiss = { open = false },
        modifier = modifier,
        placement = placement,
    ) {
        AppLocale.entries.forEach { locale ->
            PreferenceOption(
                label = locale.label,
                selected = locale == store.locale,
                onClick = {
                    open = false
                    store.select(locale)
                    // 리소스 언어는 attachBaseContext에서 정해지므로, 바꾸려면 Activity를
                    // 다시 만든다 — 그래야 화면·팝업이 모두 새 언어를 따른다. 세션 상태는
                    // Application 컨테이너에 있어 recreate로 사라지지 않는다.
                    activity?.recreate()
                },
            )
        }
    }
}

// Compose가 넘기는 Context는 ContextThemeWrapper라 Activity까지 벗겨 낸다.
private fun Context.findActivity(): Activity? {
    var context: Context? = this
    while (context is ContextWrapper) {
        if (context is Activity) return context
        context = context.baseContext
    }
    return null
}

/**
 * 두 스위처가 공유하는 트리거 + 팝오버 껍데기 — 디자인의 `ThemeSelector`·`LanguageSelector`와
 * 그 짝인 `Menu` 컴포넌트에 해당하고, 웹에서는 SelectMenu 하나가 같은 자리를 맡는다
 * (apps/web/src/components/SelectMenu.tsx). 두 선택이 생김새를 공유해야 하므로 모양은
 * 여기에만 둔다.
 */
@Composable
private fun PreferenceMenu(
    @DrawableRes icon: Int,
    current: String,
    contentDescription: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    placement: PreferenceMenuPlacement = PreferenceMenuPlacement.BELOW,
    items: @Composable ColumnScope.() -> Unit,
) {
    val colors = PrismTheme.colors
    val shape = RoundedCornerShape(PrismDimensions.radiusMd)
    val density = LocalDensity.current
    // 트리거는 평소 배경 없이 앉아 있다가 열릴 때만 판이 생긴다(웹 .select__trigger).
    // 테두리 자리는 닫혀 있을 때도 투명으로 잡아 둔다 — 열릴 때 생기면 그만큼 폭이 늘어
    // 트리거가 흔들린다.
    val content = if (expanded) colors.text else colors.muted
    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
            modifier = modifier
                .clip(shape)
                .background(if (expanded) colors.secondaryBackground else Color.Transparent)
                .border(1.dp, if (expanded) colors.border else Color.Transparent, shape)
                .clickable(onClick = onToggle)
                .height(PrismDimensions.selectTriggerHeight)
                .padding(horizontal = PrismDimensions.selectTriggerPadding)
                // 트리거에 보이는 것은 지금 고른 값뿐이라, 무엇을 고르는 버튼인지는
                // 접근성 이름으로만 알 수 있다(웹의 시각적 숨김 라벨과 같은 역할).
                .semantics { this.contentDescription = contentDescription },
        ) {
            SelectIcon(icon, content)
            Text(
                text = current,
                color = content,
                fontSize = PrismDimensions.fontBody,
                fontWeight = FontWeight.SemiBold,
            )
            SelectIcon(
                when (placement) {
                    PreferenceMenuPlacement.BELOW -> R.drawable.ic_chevron_down
                    PreferenceMenuPlacement.TRAILING -> R.drawable.ic_chevron_right
                },
                content,
            )
        }

        if (expanded) {
            // `DropdownMenu`가 아니라 `Popup`을 직접 쓴다. 그쪽 배치 규칙은 "트리거 아래
            // 아니면 트리거 위"뿐이라, 세로 여백이 조금만 모자라도 메뉴가 트리거에서
            // **떨어져** 위로 날아간다(실기기에서 9px이 모자라 그렇게 떴다). 옆으로 여는
            // 메뉴는 트리거에 붙어 있는 것이 뜻이므로, 뒤집는 대신 화면 안으로 당긴다.
            Popup(
                popupPositionProvider = remember(placement, density) {
                    PreferenceMenuPosition(
                        placement = placement,
                        gap = with(density) { PrismDimensions.spacingSm.roundToPx() },
                        margin = with(density) { PrismDimensions.spacingSm.roundToPx() },
                    )
                },
                onDismissRequest = onDismiss,
                properties = PopupProperties(focusable = true),
            ) {
                Surface(
                    shape = shape,
                    color = colors.card,
                    border = BorderStroke(1.dp, colors.border),
                    // material3 `MenuDefaults.ShadowElevation`과 같은 값 — 껍데기를 직접
                    // 그리게 됐어도 그림자까지 달라지면 로그인 화면의 메뉴와 갈린다.
                    shadowElevation = PrismDimensions.selectMenuElevation,
                    modifier = Modifier
                        .width(PrismDimensions.selectMenuWidth)
                        .semantics { popup() },
                ) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(
                            PrismDimensions.selectOptionSpacing,
                        ),
                        modifier = Modifier.padding(PrismDimensions.selectMenuPadding),
                        content = items,
                    )
                }
            }
        }
    }
}

/**
 * 메뉴를 트리거에 걸어 두는 배치 규칙 — 웹의 `.select__menu`와 iOS `.popover`가 하는 일을
 * 그대로 옮긴 것이다.
 *
 * 축을 나눠 다루는 것이 핵심이다. **펼치는 축**은 자리가 모자라면 반대쪽으로 뒤집고(아래로
 * 열던 것은 위로, 오른쪽으로 열던 것은 왼쪽으로), **걸어 두는 축**은 뒤집지 않고 화면 안으로
 * 당긴다. 두 축을 같게 다루면 한쪽이 반드시 어색해진다 — 펼치는 축을 당기기만 하면 메뉴가
 * 트리거를 덮고, 걸어 두는 축을 뒤집으면 메뉴가 트리거에서 떨어져 어느 트리거가 연 것인지
 * 알 수 없게 된다(Compose 기본 `DropdownMenu`가 옆으로 열 때 그랬다).
 */
private class PreferenceMenuPosition(
    private val placement: PreferenceMenuPlacement,
    private val gap: Int,
    private val margin: Int,
) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset = when (placement) {
        // 트리거 가운데에 걸고 아래로 편다(웹 `.select__menu: top calc(100% + 8px)`).
        PreferenceMenuPlacement.BELOW -> IntOffset(
            x = (anchorBounds.left + (anchorBounds.width - popupContentSize.width) / 2)
                .clampInto(popupContentSize.width, windowSize.width),
            y = expand(
                after = anchorBounds.bottom + gap,
                before = anchorBounds.top - gap - popupContentSize.height,
                size = popupContentSize.height,
                available = windowSize.height,
            ),
        )

        // 트리거 윗변에 걸고 옆으로 편다(웹 `.sidebar__footer`의 `top: 0`).
        PreferenceMenuPlacement.TRAILING -> {
            val toRight = anchorBounds.right + gap
            val toLeft = anchorBounds.left - gap - popupContentSize.width
            val ltr = layoutDirection == LayoutDirection.Ltr
            IntOffset(
                x = expand(
                    after = if (ltr) toRight else toLeft,
                    before = if (ltr) toLeft else toRight,
                    size = popupContentSize.width,
                    available = windowSize.width,
                ),
                y = anchorBounds.top.clampInto(popupContentSize.height, windowSize.height),
            )
        }
    }

    /** 펼치는 축: 먼저 `after`, 거기서 넘치면 `before`, 둘 다 안 되면 화면 안으로 당긴다. */
    private fun expand(after: Int, before: Int, size: Int, available: Int): Int = when {
        after + size + margin <= available -> after
        before >= margin -> before
        else -> after.clampInto(size, available)
    }

    /** 걸어 두는 축: 화면을 벗어나면 안으로 당긴다. 창보다 큰 메뉴는 여백에 붙인다. */
    private fun Int.clampInto(size: Int, available: Int): Int =
        coerceIn(margin, (available - size - margin).coerceAtLeast(margin))
}


/**
 * 메뉴 한 줄(디자인의 `ThemeOption`·`LanguageOption`). 고른 항목은 **체크와 굵기**로
 * 구분한다 — 배경까지 쓰면 눌림 표시와 겹쳐 읽힌다(웹 .select__option과 같은 규칙).
 */
@Composable
private fun PreferenceOption(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    @DrawableRes icon: Int? = null,
) {
    val colors = PrismTheme.colors
    val content = if (selected) colors.text else colors.muted
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PrismDimensions.radiusSm))
            // 목록에서 하나만 고르는 줄이다 — 스크린 리더가 "선택됨"을 읽도록 라디오로 둔다
            // (웹의 role="menuitemradio"와 같은 자리).
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .height(PrismDimensions.selectOptionHeight)
            .padding(horizontal = PrismDimensions.selectOptionPadding),
    ) {
        icon?.let { SelectIcon(it, content) }
        Text(
            text = label,
            color = content,
            fontSize = PrismDimensions.fontBody,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.weight(1f),
        )
        // 체크는 강조색이다 — 줄 색(muted/text)과 달라야 한눈에 지금 값이 잡힌다.
        if (selected) SelectIcon(R.drawable.ic_check, colors.accent)
    }
}

/** 트리거·메뉴가 쓰는 16dp 선 아이콘. 색은 부르는 쪽이 정한다(획만 있는 드로어블). */
@Composable
private fun SelectIcon(@DrawableRes res: Int, tint: Color) {
    Icon(
        painter = painterResource(res),
        // 아이콘은 옆 글자를 되풀이할 뿐이라 접근성 트리에서 뺀다.
        contentDescription = null,
        tint = tint,
        modifier = Modifier.size(PrismDimensions.iconSize),
    )
}
