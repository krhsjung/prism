package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/**
 * 되돌릴 수 없는 동작 앞에 세우는 확인 창.
 *
 * `AlertDialog`의 기본 껍데기를 쓰지 않는다 — 색·모서리·버튼 배치가 material 소유라 웹·iOS와
 * 나란히 놓으면 여기서만 튄다(선택 메뉴를 직접 그리는 것과 같은 이유,
 * `PreferenceMenu`). 창을 띄우는 일만 플랫폼에 맡기고(뒤로 가기·바깥 탭·포커스),
 * 그 안의 카드는 시안의 토큰으로 우리가 그린다.
 *
 * **취소가 먼저다.** 왼쪽에 두고 무게도 낮춘다 — 되돌릴 수 없는 쪽이 손에 먼저 걸리면
 * 확인 창을 세운 의미가 없다.
 */
@Composable
fun PrismConfirmDialog(
    title: String,
    message: String,
    confirmText: String,
    cancelText: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    /** 진행 중에는 두 번 눌리지 않게 잠근다 — 중복 호출이 곧 손해다. */
    busy: Boolean = false,
) {
    val colors = PrismTheme.colors
    Dialog(onDismissRequest = onCancel, properties = DialogProperties()) {
        Surface(
            shape = RoundedCornerShape(PrismDimensions.radiusLg),
            color = colors.card,
            border = BorderStroke(1.dp, colors.border),
            modifier = Modifier.widthIn(max = PrismDimensions.dialogWidth),
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
                modifier = Modifier.padding(PrismDimensions.spacingLg),
            ) {
                Text(
                    text = title,
                    color = colors.heading,
                    fontSize = PrismDimensions.fontSectionTitle,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = message,
                    color = colors.muted,
                    fontSize = PrismDimensions.fontBody,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(
                        PrismDimensions.spacingSm,
                        Alignment.End,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = PrismDimensions.spacingSm),
                ) {
                    // 취소는 테두리만, 확인은 채운 판 — 무게 차이가 곧 기본값의 표시다.
                    PrismButton(
                        text = cancelText,
                        variant = PrismButtonVariant.GHOST,
                        enabled = !busy,
                        onClick = onCancel,
                        fillWidth = false,
                    )
                    PrismButton(
                        text = confirmText,
                        variant = PrismButtonVariant.SECONDARY,
                        enabled = !busy,
                        onClick = onConfirm,
                        fillWidth = false,
                    )
                }
            }
        }
    }
}
