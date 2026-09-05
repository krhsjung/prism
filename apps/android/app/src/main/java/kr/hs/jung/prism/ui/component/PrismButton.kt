package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/** 웹 `.btn` variant — 색이 갈리는 종류들(Kakao는 브랜드 고정색). */
enum class PrismButtonVariant {
    PRIMARY,
    OUTLINE,
    SECONDARY,

    /** 판 없이 글자만(웹 `.btn--ghost` · 시안 `Atom/Button Variant=Ghost`). 목록 안의
     *  인라인 액션이 쓴다 — 행마다 판이 깔리면 목록이 버튼밭이 된다. */
    GHOST,
    KAKAO,
}

/**
 * 웹 `.btn`과 같은 버튼. variant가 색을, `enabled`가 투명도를 정한다.
 * 테두리는 outline에만 있다 — 카드 위에서 배경색이 같아 경계가 필요하다.
 */
@Composable
fun PrismButton(
    text: String,
    variant: PrismButtonVariant,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    /**
     * 폭을 채울지. 로그인 화면처럼 **세로로 쌓는** 버튼은 채우고, 카드 안에서 다른
     * 내용과 **나란히 앉는** 버튼(모두 로그아웃 · 해제)은 글자 폭만 차지한다
     * (웹 `.btn--compact`와 같은 구분). 채우는 쪽을 기본으로 두는 이유는 로그인 화면이
     * 먼저 있었고 거기서는 그것이 맞기 때문이다 — 채워야 할 자리에서 빠뜨리면 눈에
     * 띄지만, 그 반대는 옆의 글자를 한 글자씩 쪼개 놓는다.
     */
    fillWidth: Boolean = true,
) {
    val colors = PrismTheme.colors
    val background: Color
    val foreground: Color
    var border: BorderStroke? = null
    when (variant) {
        PrismButtonVariant.PRIMARY -> {
            background = colors.primary
            foreground = colors.primaryForeground
        }
        PrismButtonVariant.OUTLINE -> {
            background = colors.card
            foreground = colors.heading
            border = BorderStroke(1.dp, colors.border)
        }
        PrismButtonVariant.SECONDARY -> {
            background = colors.secondaryBackground
            foreground = colors.secondaryForeground
        }
        PrismButtonVariant.GHOST -> {
            background = Color.Transparent
            foreground = colors.primary
        }
        PrismButtonVariant.KAKAO -> {
            background = colors.kakao
            foreground = colors.kakaoForeground
        }
    }

    Button(
        onClick = onClick,
        modifier = modifier
            .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
            .height(PrismDimensions.buttonHeight),
        // 폭을 채우지 않을 때는 Material 기본 좌우 여백(24)이 과하다 — 카드 안에서
        // 옆 내용의 자리를 뺏지 않게 줄인다.
        contentPadding = if (fillWidth) {
            ButtonDefaults.ContentPadding
        } else {
            PaddingValues(horizontal = PrismDimensions.buttonCompactPadding)
        },
        enabled = enabled,
        shape = RoundedCornerShape(PrismDimensions.radiusMd),
        border = border,
        colors = ButtonDefaults.buttonColors(
            containerColor = background,
            contentColor = foreground,
            // 비활성 상태에서도 같은 색을 쓰고 투명도만 낮춘다(웹 .btn:disabled).
            //
            // ⚠️ 알파를 **덮어쓰지 않고 곱한다.** `Color.Transparent`는 알파 0인 검정이라
            // 0.55로 덮어쓰면 투명이 아니라 **반투명 검정 판**이 된다 — 판 없는 Ghost가
            // 비활성일 때만 회색 판을 얻는다(진단의 `Copy log`·`Clear`가 그랬다).
            disabledContainerColor = background.dim(PrismDimensions.buttonDisabledAlpha),
            disabledContentColor = foreground.dim(PrismDimensions.buttonDisabledAlpha),
        ),
    ) {
        Text(text = text, fontSize = PrismDimensions.fontBody, fontWeight = FontWeight.SemiBold)
    }
}

private fun Color.dim(factor: Float): Color = copy(alpha = alpha * factor)
