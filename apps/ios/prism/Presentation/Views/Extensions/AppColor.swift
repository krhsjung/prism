//
//  AppColor.swift
//  prism
//
//  Path: Presentation/Views/Extensions/AppColor.swift
//

import SwiftUI

/// 디자인 토큰 색상.
///
/// 값은 Asset Catalog(`Resources/Assets.xcassets/Colors`)에 라이트/다크 두 벌로 들어
/// 있어, 테마가 바뀌면 SwiftUI가 알아서 바꿔 칠한다. 이름은 웹의 CSS 변수와 1:1이라
/// (`--color-surface` ↔ `AppColor.surface`) 한쪽만 바뀌면 대조하기 쉽다.
///
/// 원천은 Figma → `design/tokens` → `apps/web/src/index.css` · 이 카탈로그 순서다.
/// 색을 새로 쓰려면 여기 추가하지 말고 토큰부터 늘린다.
///
/// 참조는 Xcode가 만드는 에셋 심볼(`.surface` 등)로 한다 — 문자열 이름은 오타가
/// 런타임까지 살아남아 아무 색도 아닌 값이 조용히 칠해진다.
enum AppColor {
    /// 화면 바탕(카드 뒤).
    static let surface = Color(.surface)
    /// 카드·시트 표면.
    static let card = Color(.card)
    static let border = Color(.border)

    /// 제목처럼 가장 진한 글자. 본문(`text`)보다 한 단계 강하다.
    static let heading = Color(.heading)
    static let text = Color(.text)
    /// 부제·캡션처럼 한 단계 물러난 글자.
    static let muted = Color(.muted)
    static let accent = Color(.accent)

    /// 토큰 이름은 `--color-primary`지만 에셋은 `BrandPrimary`다 —
    /// `Primary`로 두면 생성되는 심볼이 SwiftUI의 `Color.primary`와 충돌한다.
    static let primary = Color(.brandPrimary)
    static let primaryForeground = Color(.primaryForeground)
    /// 눌린 상태의 Primary.
    static let primaryPress = Color(.primaryPress)
    static let secondaryBackground = Color(.secondaryBackground)
    static let secondaryForeground = Color(.secondaryForeground)

    static let error = Color(.error)
    static let errorBackground = Color(.errorBackground)
    static let success = Color(.success)
    static let successBackground = Color(.successBackground)

    /// Kakao 브랜드 고정색(로그인 버튼 가이드 값). 테마와 무관하게 라이트/다크 공통이다 —
    /// 그래서 에셋도 단일 색으로 둔다.
    static let kakao = Color(.kakaoBrand)
    static let kakaoForeground = Color(.kakaoBrandForeground)
}
