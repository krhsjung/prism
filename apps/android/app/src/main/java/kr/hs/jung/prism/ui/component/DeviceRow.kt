package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kr.hs.jung.prism.domain.model.DeviceKind
import kr.hs.jung.prism.feature.dashboard.deviceIcon
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/**
 * 기기 한 줄 — 아이콘 타일 + 이름/짧은 세션 id + 오른쪽 동작.
 *
 * **통화 로비와 푸시 화면이 같은 부품을 쓴다.** 같은 목록(`GET /auth/sessions`)을 두
 * 화면이 다르게 그리면 그것부터 설명해야 한다(plan/push.md §4). 다른 것은 오른쪽에
 * 무엇이 오느냐뿐이라 그 자리만 `trailing`으로 연다.
 */
@Composable
fun DeviceRow(
    device: DeviceKind,
    title: String,
    subtitle: String,
    dimmed: Boolean,
    trailing: @Composable () -> Unit,
) {
    val colors = PrismTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PrismDimensions.callRowSpacing),
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                horizontal = PrismDimensions.callRowHorizontalPadding,
                vertical = PrismDimensions.callRowVerticalPadding,
            ),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(PrismDimensions.callRowIconTile)
                .clip(RoundedCornerShape(PrismDimensions.radiusMd))
                .background(colors.secondaryBackground),
        ) {
            Icon(
                painter = painterResource(deviceIcon(device)),
                contentDescription = null,
                tint = if (dimmed) colors.muted else colors.heading,
                modifier = Modifier.size(PrismDimensions.callRowIconGlyph),
            )
        }
        Column(
            verticalArrangement = Arrangement.spacedBy(PrismDimensions.callRowLabelSpacing),
            modifier = Modifier.weight(1f),
        ) {
            Text(
                text = title,
                color = if (dimmed) colors.muted else colors.heading,
                fontSize = PrismDimensions.fontRowTitle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitle,
                color = colors.muted,
                fontSize = PrismDimensions.fontCaption,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        trailing()
    }
}
