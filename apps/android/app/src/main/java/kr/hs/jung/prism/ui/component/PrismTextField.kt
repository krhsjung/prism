package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/**
 * 자유 입력 한 칸 — 시안 `Atom/Input`(웹 `.input`·`.textarea`, iOS `PrismTextField`).
 *
 * `OutlinedTextField`를 쓰지 않는다. 그쪽은 색을 넘기지 않으면 Material 기본(글자
 * onSurface, 테두리 outline, 초점 primary)으로 그려지고, 넘겨도 최소 높이 56과 안쪽
 * 여백 16이 붙어 시안의 16/10 칸보다 한참 크다 — 같은 화면이 웹·iOS와 다른 입력 칸이
 * 된다. 테두리·여백·자리 표시를 여기서 직접 그린다.
 */
@Composable
fun PrismTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = false,
    minLines: Int = 1,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
) {
    val colors = PrismTheme.colors
    val shape = RoundedCornerShape(PrismDimensions.radiusMd)
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val textStyle = TextStyle(color = colors.text, fontSize = PrismDimensions.fontBody)
    // 선택 손잡이·영역도 커서와 같은 Accent — 기본값은 Material primary(네이비)에서 온다.
    val selectionColors = TextSelectionColors(
        handleColor = colors.accent,
        backgroundColor = colors.accent.copy(alpha = 0.3f),
    )

    CompositionLocalProvider(LocalTextSelectionColors provides selectionColors) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            singleLine = singleLine,
            minLines = minLines,
            textStyle = textStyle,
            cursorBrush = SolidColor(colors.accent),
            keyboardOptions = keyboardOptions,
            interactionSource = interactionSource,
            modifier = modifier.alpha(if (enabled) 1f else PrismDimensions.inputDisabledAlpha),
            decorationBox = { innerTextField ->
                Box(
                    contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart,
                    modifier = Modifier
                        .background(if (enabled) colors.card else colors.secondaryBackground, shape)
                        // 테두리는 안쪽으로 그려져 굵기가 바뀌어도 글자가 밀리지 않는다.
                        .border(
                            width = if (focused) {
                                PrismDimensions.inputFocusedBorderWidth
                            } else {
                                PrismDimensions.inputBorderWidth
                            },
                            color = if (focused) colors.accent else colors.border,
                            shape = shape,
                        )
                        .padding(
                            horizontal = PrismDimensions.inputHorizontalPadding,
                            vertical = PrismDimensions.inputVerticalPadding,
                        ),
                ) {
                    if (value.isEmpty()) {
                        Text(text = placeholder, style = textStyle.copy(color = colors.muted))
                    }
                    innerTextField()
                }
            },
        )
    }
}
