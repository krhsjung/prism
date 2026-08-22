//
//  PrismButton.swift
//  prism
//
//  Path: Presentation/Views/Components/PrismButton.swift
//

import SwiftUI

/// 웹 `.btn`과 같은 버튼. variant가 색을, 상태가 투명도를 정한다.
struct PrismButton: View {
    enum Variant {
        case primary
        case outline
        case secondary
        /// 판 없이 글자만(웹 `.btn--ghost` · 시안 `Atom/Button Variant=Ghost`). 목록 안의
        /// 인라인 액션이 쓴다 — 행마다 판이 깔리면 목록이 버튼밭이 된다.
        case ghost
        /// Kakao 브랜드 고정색(노랑 배경·검정 85%). 라이트/다크 공통이다.
        case kakao

        var background: Color {
            switch self {
            case .primary: AppColor.primary
            case .outline: AppColor.card
            case .secondary: AppColor.secondaryBackground
            case .ghost: .clear
            case .kakao: AppColor.kakao
            }
        }

        var foreground: Color {
            switch self {
            case .primary: AppColor.primaryForeground
            case .outline: AppColor.heading
            case .secondary: AppColor.secondaryForeground
            case .ghost: AppColor.primary
            case .kakao: AppColor.kakaoForeground
            }
        }

        /// 테두리는 outline에만 있다 — 카드 위에서 배경색이 같아 경계가 필요하다.
        var border: Color? {
            switch self {
            case .outline: AppColor.border
            case .primary, .secondary, .ghost, .kakao: nil
            }
        }
    }

    let title: String
    var variant: Variant = .primary
    var isEnabled: Bool = true
    /// 폭을 채울지. 로그인 화면처럼 **세로로 쌓는** 버튼은 채우고, 카드 안에서 다른
    /// 내용과 **나란히 앉는** 버튼(Sign out all · Revoke)은 글자 폭만 차지한다
    /// (웹 `.btn--compact`와 같은 구분). 채우는 쪽이 기본인 이유는 로그인 화면이 먼저
    /// 있었고 거기서는 그것이 맞기 때문이다 — 채워야 할 자리에서 빠뜨리면 눈에 띄지만,
    /// 그 반대는 옆의 글자를 한 글자씩 쪼개 놓는다.
    var fillsWidth: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: AppDimension.FontSize.body, weight: .semibold))
                .foregroundStyle(variant.foreground)
                .frame(maxWidth: fillsWidth ? .infinity : nil)
                .frame(height: AppDimension.Button.height)
                .padding(.horizontal, AppDimension.Button.horizontalPadding)
                .background(variant.background)
                .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
                .overlay {
                    if let border = variant.border {
                        RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                            .stroke(border, lineWidth: AppDimension.Button.borderWidth)
                    }
                }
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : AppDimension.Button.disabledOpacity)
    }
}

#Preview {
    VStack(spacing: AppDimension.Button.spacing) {
        PrismButton(title: "Continue with Google", variant: .outline) {}
        PrismButton(title: "Continue with Apple", variant: .primary) {}
        PrismButton(title: "Try the demo", variant: .secondary) {}
        PrismButton(title: "Connecting…", variant: .primary, isEnabled: false) {}
    }
    .padding(AppDimension.Card.padding)
    .background(AppColor.card)
}
