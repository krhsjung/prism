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
    /**
     * 시안 `Atom/Avatar`의 `Size=sm`. 이 아톰은 sm 24 · md 40 · lg 64 셋뿐이라 32는
     * 어느 변형도 아니었다 — 위 주석이 줄곧 24라고 적어 둔 그 값이다.
     */
    val avatarSize = 24.dp
    /** 이니셜은 11 SemiBold(시안 `I3036:373;1798:3`) — 24 원 안에 두 글자가 든다. */
    val avatarFontSize = 11.sp
    val drawerWidth = 280.dp
    val navItemHeight = 48.dp
    val navItemPadding = 16.dp

    // 세션 카드 — 아이콘 타일 36 안에 18짜리 글리프(시안 SessionRow).
    val sessionIconTile = 36.dp
    val sessionIconGlyph = 18.dp
    val sessionRowPadding = 14.dp

    /**
     * 세션 카드의 좌우 여백. 카드가 아니라 **각 구획이** 갖는다 — 그래야 구분선이 카드
     * 폭을 가로지른다(웹 `.sessions__row { padding: 14px 24px }`와 같은 값).
     */
    val sessionCardInset = 24.dp

    /** 세션 카드 머리의 위아래 여백(웹 `.sessions__head { padding: 20px 24px }`). */
    val sessionHeadPadding = 20.dp
    /** 신원 줄과 날짜 덩어리 사이(시안 10). */
    val sessionBlockSpacing = 10.dp
    /** 시작↔만료 사이. 시안은 거의 붙어 있다(17px 줄 사이 1px). */
    val sessionWhenSpacing = 1.dp
    val badgeHorizontalPadding = 10.dp
    /** 시안 `Atom/Badge`의 높이. 패딩이 아니라 높이를 고정해 플랫폼별 글자 상자 여백
     *  차이가 배지 크기로 새어 나오지 않게 한다. */
    val badgeHeight = 23.dp
    val badgeFontSize = 12.sp
    // 통화 화면 — 시안 `WebRTC / Mobile / *`(375 폭)의 수치를 그대로 쓴다.

    /** 카드 좌우 여백. 대시보드(24)보다 좁다 — 시안이 무대에 폭을 더 준다. */
    /**
     * 푸시 화면의 카드. 값은 웹 `.push__*` 규칙과 1:1이다 — 같은 시안
     * (`Push / Mobile / Send`)을 세 플랫폼이 나눠 그리므로 한쪽만 바뀌면 어긋난다.
     * iOS `AppDimension.Push`와도 짝이다.
     */
    val pushCardInset = 24.dp
    val pushHeadPadding = 20.dp
    val pushBodyPadding = 24.dp
    val pushBodySpacing = 20.dp
    val pushFootPadding = 14.dp
    /** 권한 안내 상자(웹 `.push__permission { padding: 12px 14px }`). */
    val pushNoticeHorizontalPadding = 14.dp
    val pushNoticeVerticalPadding = 12.dp
    /** 샘플 이미지 칩(웹 `.push__sample { width: 44px; height: 28px }`). */
    val pushSampleWidth = 44.dp
    val pushSampleHeight = 28.dp
    /** 고른 칩의 테두리 — 웹은 `box-shadow: 0 0 0 1px`로 1px을 겹쳐 2px처럼 보인다. */
    val pushSampleSelectedBorder = 2.dp

    val callCardInset = 20.dp
    /** 통화 카드 머리의 위아래 여백(시안 14). 로비 머리만 16이다. */
    val callHeadPadding = 14.dp
    val callLobbyHeadPadding = 16.dp
    /** 로비 본문의 여백과 구획 사이 간격(시안 Body p20 · gap 16). */
    val callBodyPadding = 20.dp
    val callBodySpacing = 16.dp
    /** 카드 바닥 한 줄(시안 Foot px20 py14). */
    val callFootPadding = 14.dp

    /**
     * 무대 판의 안쪽 여백. **판은 surface, 타일은 stage다** — 판까지 어두우면 타일
     * 경계가 사라진다(plan/webrtc.md §4).
     */
    val callStagePadding = 12.dp
    /** 통화 중 타일 높이(시안 415) · 로비 프리뷰 높이(시안 221). */
    val callStageHeight = 415.dp
    val callPreviewHeight = 221.dp

    /**
     * 셀프 PiP — **우상단**이다. 우하단은 이름 칩·컨트롤과 겹치고 좌하단은 이름 칩
     * 자리다. 이름표를 달지 않고 테두리만 준다(96 폭에서 칩이 판을 다 먹는다).
     */
    val callPipWidth = 96.dp
    val callPipHeight = 128.dp
    val callPipInset = 12.dp
    val callPipBorderWidth = 2.dp

    /** 타일 안의 이름 칩(시안 Label chip) — 좌하단, 높이 23. */
    val callChipHeight = 23.dp
    val callChipHorizontalPadding = 10.dp
    /** 타일 가운데의 상태 줄과 그 아래 단 하나의 행동 사이(시안 12). */
    val callTileContentSpacing = 12.dp

    /** 컨트롤은 **48 원형**, 글리프 20 — iOS 44 · Android 48을 한 값으로 만족한다. */
    val callControlSize = 48.dp
    val callControlGlyph = 20.dp
    val callControlSpacing = 12.dp
    /**
     * 종료 앞의 24는 **안전 여백**이다 — 되돌릴 수 없는 버튼이 반복 조작하는 버튼에
     * 이어 붙으면 오탭이 생긴다(대시보드의 "모두 로그아웃"과 같은 규칙).
     */
    val callEndSpacing = 24.dp
    /** 바닥 고정 바(시안 pt12 · pb32). 아래쪽은 시스템 바 인셋이 맡는다. */
    val callBarTopPadding = 12.dp
    val callBarBottomPadding = 12.dp

    /**
     * 라벨과 그 아래 컨트롤 사이(웹 `.setup__field { gap: 6px }`, 시안 로비 6).
     *
     * 카드 머리의 [headSpacing](2)과 **다른 값이다** — 2는 제목과 부제처럼 같은 문단으로
     * 읽혀야 하는 사이고, 이쪽은 라벨과 누를 수 있는 것 사이다. 진단 패널의 설정은
     * 한 칸 더 넓은 8을 쓴다(웹 `.diag__setting`).
     */
    val callFieldSpacing = 6.dp

    /**
     * 기기 목록 — 테두리 하나에 구분선으로 나뉜 **한 판**이다(행마다 카드를 주면
     * 목록이 아니라 카드 더미로 읽힌다).
     */
    val callListVerticalPadding = 6.dp
    val callRowHorizontalPadding = 16.dp
    val callRowVerticalPadding = 12.dp
    val callRowSpacing = 12.dp
    val callRowIconTile = 36.dp
    val callRowIconGlyph = 20.dp
    /** 행의 이름과 부제 사이(시안 1). */
    val callRowLabelSpacing = 1.dp

    /** 진단 — 머리 px20 py14, 본문 px16 py24, 절 사이 24. */
    val callDiagBodyInset = 16.dp
    val callDiagBodyPadding = 24.dp
    val callDiagSectionSpacing = 24.dp
    /** 절 제목과 내용 사이 · 지표 칸 사이(시안 12). */
    val callDiagRowSpacing = 12.dp
    /** 라벨 위·값 아래(시안 2·4). */
    val callDiagLabelSpacing = 2.dp
    val callStatLabelSpacing = 4.dp
    val callStatPaddingH = 16.dp
    val callStatPaddingV = 12.dp
    /**
     * 로그만 **내부 스크롤**을 갖는다(모바일 160) — 유일하게 계속 자라는 영역이라
     * 페이지를 밀어내지 않게 한다.
     */
    val callLogHeight = 160.dp
    val callLogPadding = 12.dp
    val callLogLineSpacing = 2.dp
    val callLogColumnSpacing = 6.dp
    /** 로그 줄의 고정 열 — 자리가 흔들리면 값을 세로로 읽을 수 없다. */
    val callLogStampWidth = 60.dp
    val callLogArrowWidth = 10.dp
    val callLogTypeWidth = 84.dp
    /** 라디오(시안 `Atom/Radio` 18). */
    val callRadioSize = 18.dp

    /**
     * 모노(`Code`·`Code/Small`) — 값·타임스탬프·후보 문자열처럼 **자리가 흔들리면 안
     * 되는 것**에만 쓴다. 라벨은 본문 서체 그대로다.
     */
    val fontCode = 14.sp
    val fontCodeSmall = 12.sp
    /** 캡션(부제·힌트). */
    val fontCaption = 12.sp
    /** 목록 행의 이름(시안 16). */
    val fontRowTitle = 16.sp

    val fontLabel = 13.sp
    val fontSectionTitle = 20.sp
}
