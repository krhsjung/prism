package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.BorderStroke
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
enum class PrismButtonVariant { PRIMARY, OUTLINE, SECONDARY, KAKAO }

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
        PrismButtonVariant.KAKAO -> {
            background = colors.kakao
            foreground = colors.kakaoForeground
        }
    }

    Button(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .height(PrismDimensions.buttonHeight),
        enabled = enabled,
        shape = RoundedCornerShape(PrismDimensions.radiusMd),
        border = border,
        colors = ButtonDefaults.buttonColors(
            containerColor = background,
            contentColor = foreground,
            // 비활성 상태에서도 같은 색을 쓰고 투명도만 낮춘다(웹 .btn:disabled).
            disabledContainerColor = background.copyAlpha(PrismDimensions.buttonDisabledAlpha),
            disabledContentColor = foreground.copyAlpha(PrismDimensions.buttonDisabledAlpha),
        ),
    ) {
        Text(text = text, fontSize = PrismDimensions.fontBody, fontWeight = FontWeight.SemiBold)
    }
}

private fun Color.copyAlpha(alpha: Float): Color = copy(alpha = alpha)
