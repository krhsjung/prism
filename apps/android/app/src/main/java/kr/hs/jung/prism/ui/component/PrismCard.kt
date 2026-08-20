package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.ui.draw.shadow
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/** 웹 `.card`와 같은 표면 — 로그인·대시보드가 공유하는 컨테이너. */
@Composable
fun PrismCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val colors = PrismTheme.colors
    val shape = RoundedCornerShape(PrismDimensions.radiusLg)
    Column(
        modifier = modifier
            .widthIn(max = PrismDimensions.cardMaxWidth)
            .fillMaxWidth()
            // 웹 --shadow-lg. 다크에서도 카드와 바탕의 명도 차 + 테두리가 경계를 만든다.
            .shadow(8.dp, shape, clip = false)
            .clip(shape)
            .background(colors.card)
            .border(1.dp, colors.border, shape)
            .padding(PrismDimensions.cardPadding),
        verticalArrangement = Arrangement.spacedBy(PrismDimensions.cardSpacing),
        content = content,
    )
}

/** 웹 `.alert--error`. 아이콘 없이 색만으로 구분한다(웹과 같은 구성). */
@Composable
fun PrismErrorAlert(message: String, modifier: Modifier = Modifier) {
    val colors = PrismTheme.colors
    Text(
        text = message,
        color = colors.error,
        fontSize = PrismDimensions.fontBody,
        textAlign = TextAlign.Start,
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PrismDimensions.radiusMd))
            .background(colors.errorBackground)
            .padding(
                horizontal = PrismDimensions.alertHorizontalPadding,
                vertical = PrismDimensions.alertVerticalPadding,
            )
            // 오류는 나타나는 순간 읽혀야 한다 — 시각적으로만 알리면 스크린리더 사용자는
            // 버튼이 반응 없는 것으로 느낀다(웹 role="alert"에 대응).
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}
