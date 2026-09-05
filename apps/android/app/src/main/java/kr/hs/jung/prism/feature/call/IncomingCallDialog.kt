package kr.hs.jung.prism.feature.call

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.withVars
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.domain.model.SessionRef
import kr.hs.jung.prism.feature.dashboard.deviceIcon
import kr.hs.jung.prism.feature.dashboard.deviceLabel
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant

/**
 * 걸려 온 통화 — 시안 `Organism/Modal` + `Molecule/ConfirmDialog` 골격.
 *
 * **앱 어디에 있든 뜬다**(plan/webrtc.md §4) — 소켓이 이미 앱 전역에 붙어 있어서,
 * 대시보드를 보고 있어도 마찬가지다. 확인 창과 같은 무게의 결정(받는다/거절한다)이고,
 * 이미 만들어 둔 모양이다.
 *
 * **자동 수락은 없다.** 내 기기라도 카메라가 말없이 켜지면 안 되고, 공유되는 데모
 * 계정에서는 더 그렇다(§7의 "미디어는 명시적 사용자 제스처 후"와 같은 줄).
 *
 * 바깥을 눌러도 · 뒤로 가기로도 **닫히지 않는다** — 확인 창과 다른 점이다. 통화는 상대가
 * 기다리고 있어서, 실수로 흘려보내면 그쪽이 45초를 다 쓴다.
 */
@Composable
fun IncomingCallDialog(
    from: SessionRef,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    val colors = PrismTheme.colors
    val shape = RoundedCornerShape(PrismDimensions.radiusLg)
    Dialog(
        onDismissRequest = { /* 흘려보내지 않는다 — 거절은 명시적으로만 */ },
        properties = DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
        ),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
            modifier = Modifier
                .widthIn(max = PrismDimensions.dialogWidth)
                .clip(shape)
                .background(colors.card)
                .border(1.dp, colors.border, shape)
                .padding(PrismDimensions.topBarHorizontalPadding),
        ) {
            // 거는 쪽 이름은 **기기 종류**다. 계약에 그것밖에 없고, 그것으로 충분하다 —
            // 내 기기니까.
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(PrismDimensions.callRowIconTile)
                    .clip(RoundedCornerShape(PrismDimensions.radiusMd))
                    .background(colors.secondaryBackground),
            ) {
                Icon(
                    painter = painterResource(deviceIcon(from.device)),
                    contentDescription = null,
                    tint = colors.heading,
                    modifier = Modifier.size(PrismDimensions.callRowIconGlyph),
                )
            }

            Text(
                text = stringResource(R.string.webrtc_incoming_title),
                color = colors.heading,
                fontSize = PrismDimensions.fontSectionTitle,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = stringResource(R.string.webrtc_incoming_body)
                    .withVars("device" to stringResource(deviceLabel(from.device))),
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
                // 거절이 먼저다 — 실수로 눌렀을 때 카메라가 켜지면 안 된다(확인 창이
                // 취소에서 시작하는 것과 같은 규칙, 여기서는 대가가 더 크다).
                PrismButton(
                    text = stringResource(R.string.webrtc_decline),
                    variant = PrismButtonVariant.GHOST,
                    onClick = onDecline,
                    fillWidth = false,
                )
                PrismButton(
                    text = stringResource(R.string.webrtc_accept),
                    variant = PrismButtonVariant.SECONDARY,
                    onClick = onAccept,
                    fillWidth = false,
                )
            }
        }
    }
}
