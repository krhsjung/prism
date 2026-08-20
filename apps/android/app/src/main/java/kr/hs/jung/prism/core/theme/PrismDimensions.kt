package kr.hs.jung.prism.core.theme

import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 디자인 토큰 치수. 값은 웹의 `apps/web/src/index.css`와 같은 수치이며
 * (`design/tokens`의 radius·spacing), 화면이 갈라지지 않도록 뷰 안에 숫자를 직접 적지 않는다.
 */
object PrismDimensions {
    // design/tokens/radius.json
    val radiusSm = 4.dp
    val radiusMd = 8.dp
    val radiusLg = 16.dp

    // design/tokens/spacing.json
    val spacingXs = 4.dp
    val spacingSm = 8.dp
    val spacingMd = 16.dp
    val spacingLg = 24.dp
    val spacingXl = 32.dp

    // 워드마크·카드 제목.
    val fontTitle = 28.sp
    val fontBody = 14.sp

    // 로그인 화면 껍데기.
    val cardMaxWidth = 440.dp
    val screenHorizontalPadding = 24.dp

    // 카드.
    val cardPadding = 40.dp
    val cardSpacing = 24.dp

    // 버튼(웹 .btn: height 44, radius 8).
    val buttonHeight = 44.dp
    val buttonDisabledAlpha = 0.55f

    // 선택 메뉴(웹 .select__*) — 테마·언어 스위처가 공유한다.
    //
    // 웹의 트리거는 36, 메뉴 한 줄은 위아래 8 패딩(≈36)이지만, 여기서는 둘 다 손가락이
    // 누르는 표적이라 최소 터치 크기(48)까지 키운다. 나머지 수치(너비·패딩·간격)는
    // 웹과 같다 — 생김새가 갈라지는 것은 높이 하나뿐이다.
    val selectTriggerHeight = 48.dp
    val selectTriggerPadding = 12.dp
    val selectMenuWidth = 184.dp
    val selectMenuPadding = 4.dp
    val selectOptionHeight = 48.dp
    val selectOptionPadding = 12.dp
    val selectOptionSpacing = 2.dp
    val iconSize = 16.dp

    // 알림(웹 .alert).
    val alertHorizontalPadding = 14.dp
    val alertVerticalPadding = 12.dp
}
