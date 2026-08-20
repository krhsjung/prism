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

    enum Alert {
        static let horizontalPadding: CGFloat = 14
        static let verticalPadding: CGFloat = 12
        static let lineSpacing: CGFloat = 4
    }
}
