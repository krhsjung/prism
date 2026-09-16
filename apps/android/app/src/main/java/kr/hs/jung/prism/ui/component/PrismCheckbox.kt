package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/**
 * 체크박스의 **그림** — 시안 `Atom/Checkbox`(웹 `.check__box`, iOS `PrismCheckboxStyle`).
 *
 * Material `Checkbox`는 테마의 primary·onSurfaceVariant로 그려 꺼진 칸이 두꺼운 회색
 * 테두리가 되고 모서리·크기도 시안과 다르다. 누르는 동작과 접근성 역할은 **줄**이
 * `toggleable(role = Checkbox)`로 갖고, 여기서는 18 정사각 하나만 그린다.
 */
@Composable
fun PrismCheckbox(
    checked: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = PrismTheme.colors
    val primary = colors.primary
    val mark = colors.primaryForeground
    val fill = if (enabled) colors.card else colors.secondaryBackground
    val border = colors.border
    Canvas(
        modifier
            .size(PrismDimensions.checkboxSize)
            .alpha(if (enabled) 1f else PrismDimensions.checkboxDisabledAlpha),
    ) {
        val radius = PrismDimensions.radiusSm.toPx()
        if (checked) {
            drawRoundRect(color = primary, cornerRadius = CornerRadius(radius))
            // 시안의 체크 벡터(18 격자의 M4 9.64 L7.71 13.5 L14.5 5)를 비율로 옮긴 선.
            val unit = size.width / 18f
            val path = Path().apply {
                moveTo(4f * unit, 9.64f * unit)
                lineTo(7.71f * unit, 13.5f * unit)
                lineTo(14.5f * unit, 5f * unit)
            }
            drawPath(
                path = path,
                color = mark,
                style = Stroke(
                    width = PrismDimensions.checkboxCheckWidth.toPx(),
                    cap = StrokeCap.Round,
                    join = StrokeJoin.Round,
                ),
            )
        } else {
            drawRoundRect(color = fill, cornerRadius = CornerRadius(radius))
            // 선은 가운데에 걸려 그려진다 — 반 굵기만큼 안으로 들여 칸 안에 1dp를 온전히 둔다.
            val stroke = 1f * density
            drawRoundRect(
                color = border,
                topLeft = Offset(stroke / 2, stroke / 2),
                size = Size(size.width - stroke, size.height - stroke),
                cornerRadius = CornerRadius(radius - stroke / 2),
                style = Stroke(width = stroke),
            )
        }
    }
}
