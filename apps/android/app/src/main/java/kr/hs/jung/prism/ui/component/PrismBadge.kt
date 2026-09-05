package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/**
 * 상태 배지 — 디자인의 `Atom/Badge`.
 *
 * 세션 목록에서 "현재 세션"(Success) · "붙어 있는 세션"(Info) · "붙어 있지 않은
 * 세션"(Neutral)을 가른다. 색만으로 구분하지 않는다 — 배지 안의 문구가 같은 정보를
 * 글로도 말한다(색각 이상·흑백 출력).
 */
enum class PrismBadgeVariant {
    SUCCESS,
    INFO,
    NEUTRAL,

    /**
     * 되돌릴 수 있는 나쁨 — 재연결 중이거나, 릴레이를 지나는 통화. **릴레이는 실패가
     * 아니라 비싼 성공이라** ERROR가 아니라 여기다(plan/webrtc.md §4).
     */
    WARNING,

    /** 통화가 끝내 붙지 못했다. 배지가 이 말을 하므로 타일은 문구를 갖지 않는다. */
    ERROR,
}

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
        // surface는 카드보다 한 톤 눌린 배경이라 라이트/다크 모두에서 카드 위에 얹힌다.
        // 새 토큰을 만들지 않고 있는 것으로 세 번째 갈래를 만든다(웹 `.badge--neutral`과 같다).
        PrismBadgeVariant.NEUTRAL -> colors.surface
        PrismBadgeVariant.WARNING -> colors.warningBackground
        PrismBadgeVariant.ERROR -> colors.errorBackground
    }
    val foreground = when (variant) {
        PrismBadgeVariant.SUCCESS -> colors.success
        // 웹 `.badge--info`와 같은 토큰이다 — secondaryForeground(네이비)를 쓰면
        // 같은 배지가 플랫폼마다 다른 파랑으로 나온다.
        PrismBadgeVariant.INFO -> colors.accent
        PrismBadgeVariant.NEUTRAL -> colors.muted
        PrismBadgeVariant.WARNING -> colors.warning
        PrismBadgeVariant.ERROR -> colors.error
    }
    // 라이트에서 surface와 카드의 차이가 작아 알약 윤곽이 흐리다 — 테두리로 세운다.
    // (웹은 inset box-shadow로 같은 일을 한다)
    val border = if (variant == PrismBadgeVariant.NEUTRAL) colors.border else null
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            // 높이를 **고정한다**. 패딩만 주면 플랫폼마다 글자 상자의 여백이 달라
            // (Compose는 폰트 패딩을 더하고 SwiftUI는 더하지 않는다) 같은 배지가 서로
            // 다른 높이로 나온다. 시안(`Atom/Badge`)의 23으로 못박아 셋을 맞춘다.
            .height(PrismDimensions.badgeHeight)
            // 알약 모양 — 반지름을 높이보다 크게 줘서 양끝이 완전한 반원이 된다.
            .background(background, RoundedCornerShape(percent = 50))
            .then(
                if (border != null) {
                    Modifier.border(1.dp, border, RoundedCornerShape(percent = 50))
                } else {
                    Modifier
                },
            )
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
