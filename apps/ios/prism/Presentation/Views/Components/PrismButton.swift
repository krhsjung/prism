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
        /// Kakao 브랜드 고정색(노랑 배경·검정 85%). 라이트/다크 공통이다.
        case kakao

        var background: Color {
            switch self {
            case .primary: AppColor.primary
            case .outline: AppColor.card
            case .secondary: AppColor.secondaryBackground
            case .kakao: AppColor.kakao
            }
        }

        var foreground: Color {
            switch self {
            case .primary: AppColor.primaryForeground
            case .outline: AppColor.heading
            case .secondary: AppColor.secondaryForeground
            case .kakao: AppColor.kakaoForeground
            }
        }

        /// 테두리는 outline에만 있다 — 카드 위에서 배경색이 같아 경계가 필요하다.
        var border: Color? {
            switch self {
            case .outline: AppColor.border
            case .primary, .secondary, .kakao: nil
            }
        }
    }

    let title: String
    var variant: Variant = .primary
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: AppDimension.FontSize.body, weight: .semibold))
                .foregroundStyle(variant.foreground)
                .frame(maxWidth: .infinity)
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
