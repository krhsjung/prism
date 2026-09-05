//
//  AppDimension.swift
//  prism
//
//  Path: Presentation/Views/Extensions/AppDimension.swift
//

import SwiftUI

/// 디자인 토큰 치수.
///
/// 색과 달리 치수는 Asset Catalog에 담을 자리가 없어 여기 모은다. 값은 웹의
/// `apps/web/src/index.css`와 같은 수치이며(`design/tokens`의 radius·spacing),
/// 화면이 갈라지지 않도록 뷰 안에 숫자를 직접 적지 않는다.
enum AppDimension {

    /// design/tokens/radius.json
    enum Radius {
        static let sm: CGFloat = 4
        static let md: CGFloat = 8
        static let lg: CGFloat = 16
    }

    /// design/tokens/spacing.json
    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
    }

    enum FontSize {
        /// 보조 라벨(세션 id · 시각 · 배지). 웹 13px.
        static let label: CGFloat = 13
        /// 카드 섹션 제목. 웹 20px.
        static let sectionTitle: CGFloat = 20
        /// 워드마크·카드 제목.
        static let title: CGFloat = 28
        static let body: CGFloat = 14
        /// 알림(alert) 본문 — 카드 안에서 한 단계 작다.
        static let small: CGFloat = 13
    }

    /// 로그인 화면 바깥 껍데기.
    enum Screen {
        /// 카드 최대 폭. 아이패드·가로 모드에서 카드가 늘어지지 않게 잡는다.
        static let cardMaxWidth: CGFloat = 440
        static let horizontalPadding: CGFloat = 24
        /// 워드마크 · 카드 · 환경 설정 줄 사이 간격.
        static let sectionSpacing: CGFloat = 32
    }

    enum Card {
        static let padding: CGFloat = 40
        static let spacing: CGFloat = 24
        static let borderWidth: CGFloat = 1
        /// 웹 `--shadow-lg`: 0 8px 16px.
        static let shadowRadius: CGFloat = 8
        static let shadowY: CGFloat = 8
    }

    enum Button {
        static let height: CGFloat = 44
        static let horizontalPadding: CGFloat = 20
        static let spacing: CGFloat = 12
        static let borderWidth: CGFloat = 1
        /// 비활성 상태의 투명도(웹 `.btn:disabled`).
        static let disabledOpacity: Double = 0.55
    }

    /// 선택 메뉴(웹 `.select__*`) — 테마·언어 스위처가 공유한다.
    ///
    /// 웹의 트리거는 36, 메뉴 한 줄은 위아래 8 패딩(≈36)이지만 여기서는 둘 다 손가락이
    /// 누르는 표적이라 최소 터치 크기(44, HIG)까지 키운다. 나머지 수치(너비·패딩·간격)는
    /// 웹과 같다 — 생김새가 갈라지는 것은 높이 하나뿐이다.
    enum Select {
        static let triggerHeight: CGFloat = 44
        static let triggerPadding: CGFloat = 12
        static let menuWidth: CGFloat = 184
        static let menuPadding: CGFloat = 4
        static let optionHeight: CGFloat = 44
        static let optionPadding: CGFloat = 12
        static let optionSpacing: CGFloat = 2
        static let borderWidth: CGFloat = 1
    }

    /// 대시보드 셸 — 시안 `Dashboard / Mobile`(375 폭)의 수치를 그대로 쓴다.
    /// 예외는 터치 표적뿐이다: 햄버거를 24로 그리되 누르는 영역은 44(HIG)까지 넓힌다.
    enum Dashboard {
        static let topBarHeight: CGFloat = 59
        static let horizontalPadding: CGFloat = 20
        static let iconSize: CGFloat = 24
        static let touchTarget: CGFloat = 44
        /// 시안 `Atom/Avatar`의 `Size=sm`. 이 아톰은 sm 24 · md 40 · lg 64 셋뿐이라
        /// 32는 어느 변형도 아니었다 — 대시보드 프레임의 아바타도 24다.
        static let avatarSize: CGFloat = 24
        /// 이니셜은 11 SemiBold(시안 `I3036:373;1798:3`) — 24 원 안에 두 글자가 든다.
        static let avatarFontSize: CGFloat = 11
        static let drawerWidth: CGFloat = 280
        static let navItemHeight: CGFloat = 44
        static let navItemPadding: CGFloat = 16
        /// 카드 제목과 부제 사이(웹 `.sessions__desc { margin-top: 2px }`).
        static let headSpacing: CGFloat = 2
        /// 세션 카드의 좌우 여백. 카드가 아니라 **각 구획이** 갖는다 — 그래야 구분선이
        /// 카드 폭을 가로지른다(웹 `.sessions__row { padding: 14px 24px }`와 같은 값).
        static let sessionCardInset: CGFloat = 24
        /// 세션 행의 위아래 여백(웹 `.sessions__row { padding: 14px 24px }`).
        static let sessionRowPadding: CGFloat = 14
        /// 세션 카드 머리의 위아래 여백(웹 `.sessions__head { padding: 20px 24px }`).
        static let sessionHeadPadding: CGFloat = 20
        /// 확인 창의 최대 너비(웹 `.confirm { width: min(360px, 100%) }`).
        static let dialogWidth: CGFloat = 360
        /// 세션 행 — 아이콘 타일 36 안에 18짜리 글리프(시안 SessionRow).
        static let sessionIconTile: CGFloat = 36
        static let sessionIconGlyph: CGFloat = 18
        /// 신원 줄과 날짜 덩어리 사이(시안 10).
        static let blockSpacing: CGFloat = 10
        /// 시작↔만료 사이. 시안은 거의 붙어 있다(17pt 줄 사이 1pt).
        static let whenSpacing: CGFloat = 1
        static let badgeHorizontalPadding: CGFloat = 10
        /// 시안 `Atom/Badge`의 높이. 패딩이 아니라 높이를 고정해 플랫폼별 글자 상자
        /// 여백 차이가 배지 크기로 새어 나오지 않게 한다.
        static let badgeHeight: CGFloat = 23
        static let badgeFontSize: CGFloat = 12
    }

    /// 통화 화면 — 시안 `WebRTC / Mobile / *`(375 폭)의 수치를 그대로 쓴다.
    enum Call {
        /// 카드 좌우 여백. 대시보드(24)보다 좁다 — 시안이 무대에 폭을 더 준다.
        static let cardInset: CGFloat = 20
        /// 통화 카드 머리의 위아래 여백(시안 14). 로비 머리만 16이다.
        static let headPadding: CGFloat = 14
        static let lobbyHeadPadding: CGFloat = 16
        /// 로비 본문의 여백과 구획 사이 간격(시안 Body p20 · gap 16).
        static let bodyPadding: CGFloat = 20
        static let bodySpacing: CGFloat = 16
        /// 카드 바닥 한 줄(시안 Foot px20 py14).
        static let footPadding: CGFloat = 14

        /// 무대 판의 안쪽 여백. **판은 Surface, 타일은 Stage다** — 판까지 어두우면
        /// 타일 경계가 사라진다(plan/webrtc.md §4).
        static let stagePadding: CGFloat = 12
        /// 통화 중 타일 높이(시안 415) · 로비 프리뷰 높이(시안 221).
        static let stageHeight: CGFloat = 415
        static let previewHeight: CGFloat = 221

        /// 셀프 PiP — **우상단**이다. 우하단은 이름 칩·컨트롤과 겹치고 좌하단은 이름 칩
        /// 자리다. 이름표를 달지 않고 테두리만 준다(96 폭에서 칩이 판을 다 먹는다).
        static let pipWidth: CGFloat = 96
        static let pipHeight: CGFloat = 128
        static let pipInset: CGFloat = 12
        static let pipBorderWidth: CGFloat = 2

        /// 타일 안의 이름 칩(시안 Label chip) — 좌하단, 높이 23.
        static let chipHeight: CGFloat = 23
        static let chipHorizontalPadding: CGFloat = 10
        /// 타일 가운데의 상태 줄과 그 아래 단 하나의 행동 사이(시안 12).
        static let tileContentSpacing: CGFloat = 12

        /// 컨트롤은 **48 원형**, 글리프 20 — iOS 44 · Android 48을 한 값으로 만족한다.
        static let controlSize: CGFloat = 48
        static let controlGlyph: CGFloat = 20
        static let controlSpacing: CGFloat = 12
        /// 종료 앞의 24는 **안전 여백**이다 — 되돌릴 수 없는 버튼이 반복 조작하는
        /// 버튼에 이어 붙으면 오탭이 생긴다(대시보드의 "모두 로그아웃"과 같은 규칙).
        static let endSpacing: CGFloat = 24
        /// 바닥 고정 바(시안 pt12 · pb32). 아래쪽은 홈 인디케이터를 피하는 몫이라
        /// 안전 영역이 있으면 그쪽에 맡기고 없을 때만 이 값을 쓴다.
        static let barTopPadding: CGFloat = 12
        static let barBottomPadding: CGFloat = 32

        /// 라벨과 그 아래 컨트롤 사이(웹 `.setup__field { gap: 6px }`, 시안 로비 6).
        ///
        /// 카드 머리의 `headSpacing`(2)과 **다른 값이다** — 2는 제목과 부제처럼 같은
        /// 문단으로 읽혀야 하는 사이고, 이쪽은 라벨과 누를 수 있는 것 사이다.
        /// 진단 패널의 설정은 한 칸 더 넓은 8을 쓴다(웹 `.diag__setting`).
        static let fieldSpacing: CGFloat = 6

        /// 기기 목록 — 테두리 하나에 구분선으로 나뉜 **한 판**이다(행마다 카드를 주면
        /// 목록이 아니라 카드 더미로 읽힌다).
        static let listVerticalPadding: CGFloat = 6
        static let rowHorizontalPadding: CGFloat = 16
        static let rowVerticalPadding: CGFloat = 12
        static let rowSpacing: CGFloat = 12
        static let rowIconTile: CGFloat = 36
        static let rowIconGlyph: CGFloat = 20
        /// 행의 이름과 부제 사이(시안 1).
        static let rowLabelSpacing: CGFloat = 1

        /// 셀렉트·목록 안의 인라인 버튼(시안 px20 py10). 좁은 폭에서 손가락 표적이라
        /// 높이는 44로 세운다.
        static let inlineButtonHeight: CGFloat = 44

        /// 진단 — 머리 px20 py14, 본문 px16 py24, 절 사이 24.
        static let diagHeadPadding: CGFloat = 14
        static let diagBodyInset: CGFloat = 16
        static let diagBodyPadding: CGFloat = 24
        static let diagSectionSpacing: CGFloat = 24
        /// 절 제목과 내용 사이 · 지표 칸 사이(시안 12).
        static let diagRowSpacing: CGFloat = 12
        /// 라벨 위·값 아래(시안 2·4).
        static let diagLabelSpacing: CGFloat = 2
        static let statLabelSpacing: CGFloat = 4
        static let statPaddingH: CGFloat = 16
        static let statPaddingV: CGFloat = 12
        /// 로그만 **내부 스크롤**을 갖는다(모바일 160) — 유일하게 계속 자라는 영역이라
        /// 페이지를 밀어내지 않게 한다.
        static let logHeight: CGFloat = 160
        static let logPadding: CGFloat = 12
        static let logLineSpacing: CGFloat = 2
        static let logColumnSpacing: CGFloat = 6
        /// 로그 줄의 고정 열 — 자리가 흔들리면 값을 세로로 읽을 수 없다.
        static let logStampWidth: CGFloat = 60
        static let logArrowWidth: CGFloat = 10
        static let logTypeWidth: CGFloat = 84
        /// 라디오(시안 `Atom/Radio` 18).
        static let radioSize: CGFloat = 18

        /// 모노(`Code`·`Code/Small`) — 값·타임스탬프·후보 문자열처럼 **자리가 흔들리면
        /// 안 되는 것**에만 쓴다. 라벨은 본문 서체 그대로다.
        static let fontCode: CGFloat = 14
        static let fontCodeSmall: CGFloat = 12
        /// 캡션(부제·힌트).
        static let fontCaption: CGFloat = 12
        /// 목록 행의 이름(시안 16).
        static let fontRowTitle: CGFloat = 16
    }

    enum Alert {
        static let horizontalPadding: CGFloat = 14
        static let verticalPadding: CGFloat = 12
        static let lineSpacing: CGFloat = 4
    }
}
