package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/**
 * 바닥에 잠깐 떠서 스스로 사라지는 한 줄 알림(시안 `Molecule/Toast`).
 *
 * 인라인 배너 대신 이것을 쓰는 이유는 **레이아웃을 건드리지 않기 때문**이다. 좁은 자리
 * (드로어)에 문구를 펼치면 항목들이 밀려나며 화면이 흔들리고, 실패를 알리는 순간
 * 사용자의 눈은 방금 닫힌 확인 창이 있던 화면 가운데에 있다(plan/auth.md §8-1).
 *
 * ⚠️ **플랫폼의 `android.widget.Toast`를 쓰지 않는다.** 확인 창을 플랫폼 것으로 두지 않은
 * 것과 같은 이유다 — 세 클라이언트가 같아 보여야 하고, 그것이 이 프로젝트가 보이려는
 * 것이다. 시스템 토스트는 색도 위치도 우리 토큰을 따르지 않는다.
 *
 * @param onDismiss 스스로 사라진 뒤 호출된다. 부모가 상태를 내려 이 뷰를 걷어낸다.
 */
@Composable
fun PrismToast(
    message: String,
    onDismiss: () -> Unit,
    durationMillis: Long = 5_000L,
) {
    val colors = PrismTheme.colors

    // 문구가 바뀌면 타이머도 새로 시작한다 — 남은 시간을 물려받으면 두 번째 알림이
    // 첫 번째의 잔여 시간만큼만 보인다. `key`가 message라 그 재시작이 공짜다.
    LaunchedEffect(message) {
        delay(durationMillis)
        onDismiss()
    }

    Box(
        modifier = Modifier.fillMaxSize().padding(PrismDimensions.toastScreenInset),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Text(
            text = message,
            color = colors.error,
            fontSize = PrismDimensions.fontBody,
            modifier = Modifier
                .widthIn(max = PrismDimensions.toastMaxWidth)
                .padding(bottom = PrismDimensions.toastBottomInset)
                // 떠 있다는 것은 그림자가 말한다. 배경보다 먼저 얹어야 모서리를 따라간다.
                .shadow(
                    elevation = PrismDimensions.toastElevation,
                    shape = RoundedCornerShape(PrismDimensions.toastCornerRadius),
                )
                .background(colors.errorBackground, RoundedCornerShape(PrismDimensions.toastCornerRadius))
                .border(1.dp, colors.error, RoundedCornerShape(PrismDimensions.toastCornerRadius))
                .padding(
                    horizontal = PrismDimensions.toastHorizontalPadding,
                    vertical = PrismDimensions.toastVerticalPadding,
                ),
        )
    }
}
