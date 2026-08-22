package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/**
 * 상태 배지 — 디자인의 `Atom/Badge`.
 *
 * 세션 목록에서 "현재 세션"(Success)과 "그 밖의 활성 세션"(Info)을 가른다. 색만으로
 * 구분하지 않는다 — 배지 안의 문구가 같은 정보를 글로도 말한다(색각 이상·흑백 출력).
 */
enum class PrismBadgeVariant { SUCCESS, INFO }

@Composable
fun PrismBadge(
    text: String,
    variant: PrismBadgeVariant,
    modifier: Modifier = Modifier,
) {
    val colors = PrismTheme.colors
    val background = when (variant) {
        PrismBadgeVariant.SUCCESS -> colors.successBackground
        PrismBadgeVariant.INFO -> colors.secondaryBackground
    }
    val foreground = when (variant) {
        PrismBadgeVariant.SUCCESS -> colors.success
        // 웹 `.badge--info`와 같은 토큰이다 — secondaryForeground(네이비)를 쓰면
        // 같은 배지가 플랫폼마다 다른 파랑으로 나온다.
        PrismBadgeVariant.INFO -> colors.accent
    }
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            // 높이를 **고정한다**. 패딩만 주면 플랫폼마다 글자 상자의 여백이 달라
            // (Compose는 폰트 패딩을 더하고 SwiftUI는 더하지 않는다) 같은 배지가 서로
            // 다른 높이로 나온다. 시안(`Atom/Badge`)의 23으로 못박아 셋을 맞춘다.
            .height(PrismDimensions.badgeHeight)
            // 알약 모양 — 반지름을 높이보다 크게 줘서 양끝이 완전한 반원이 된다.
            .background(background, RoundedCornerShape(percent = 50))
            .padding(horizontal = PrismDimensions.badgeHorizontalPadding),
    ) {
        Text(
            text = text,
            color = foreground,
            fontSize = PrismDimensions.badgeFontSize,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
