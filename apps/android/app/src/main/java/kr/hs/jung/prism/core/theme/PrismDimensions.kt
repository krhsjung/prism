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

    /** 카드 제목과 부제 사이(웹 `.sessions__desc { margin-top: 2px }`). */
    val headSpacing = 2.dp

    /** 확인 창의 최대 너비(웹 `.confirm { width: min(360px, 100%) }`). */
    val dialogWidth = 360.dp
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

    /** 폭을 채우지 않는 버튼의 좌우 여백(웹 `.btn--compact`). */
    val buttonCompactPadding = 14.dp

    // 선택 메뉴(웹 .select__*) — 테마·언어 스위처가 공유한다.
    //
    // 웹의 트리거는 36, 메뉴 한 줄은 위아래 8 패딩(≈36)이지만, 여기서는 둘 다 손가락이
    // 누르는 표적이라 최소 터치 크기(48)까지 키운다. 나머지 수치(너비·패딩·간격)는
    // 웹과 같다 — 생김새가 갈라지는 것은 높이 하나뿐이다.
    val selectTriggerHeight = 48.dp
    val selectTriggerPadding = 12.dp
    val selectMenuWidth = 184.dp
    val selectMenuPadding = 4.dp

    // 메뉴 껍데기를 직접 그리게 되면서(PreferenceMenu의 Popup) 그림자도 직접 준다 —
    // material3 `MenuDefaults.ShadowElevation`과 같은 값이라 생김새는 그대로다.
    val selectMenuElevation = 3.dp
    val selectOptionHeight = 48.dp
    val selectOptionPadding = 12.dp
    val selectOptionSpacing = 2.dp
    val iconSize = 16.dp

    // 알림(웹 .alert).
    val alertHorizontalPadding = 14.dp
    val alertVerticalPadding = 12.dp

    // 대시보드 셸 — 시안 `Dashboard / Mobile`(375 폭 기준)의 수치를 그대로 쓴다.
    // 예외는 터치 표적뿐이다: 햄버거·아바타를 24로 그리되 누르는 영역은 48까지 넓힌다.
    val topBarHeight = 59.dp
    val topBarHorizontalPadding = 20.dp
    val topBarIconSize = 24.dp
    val topBarTouchTarget = 48.dp
    val avatarSize = 32.dp
    val drawerWidth = 280.dp
    val navItemHeight = 48.dp
    val navItemPadding = 16.dp

    // 세션 카드 — 아이콘 타일 36 안에 18짜리 글리프(시안 SessionRow).
    val sessionIconTile = 36.dp
    val sessionIconGlyph = 18.dp
    val sessionRowPadding = 14.dp
    /** 신원 줄과 날짜 덩어리 사이(시안 10). */
    val sessionBlockSpacing = 10.dp
    /** 시작↔만료 사이. 시안은 거의 붙어 있다(17px 줄 사이 1px). */
    val sessionWhenSpacing = 1.dp
    val badgeHorizontalPadding = 10.dp
    /** 시안 `Atom/Badge`의 높이. 패딩이 아니라 높이를 고정해 플랫폼별 글자 상자 여백
     *  차이가 배지 크기로 새어 나오지 않게 한다. */
    val badgeHeight = 23.dp
    val badgeFontSize = 12.sp
    val fontLabel = 13.sp
    val fontSectionTitle = 20.sp
}
