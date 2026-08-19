//
//  PrismCard.swift
//  prism
//
//  Path: Presentation/Views/Components/PrismCard.swift
//

import SwiftUI

/// 웹 `.card`와 같은 표면 — 로그인·대시보드가 공유하는 컨테이너.
struct PrismCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: AppDimension.Card.spacing) {
            content
        }
        .padding(AppDimension.Card.padding)
        .frame(maxWidth: AppDimension.Screen.cardMaxWidth)
        .background(AppColor.card)
        .clipShape(.rect(cornerRadius: AppDimension.Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: AppDimension.Radius.lg)
                .stroke(AppColor.border, lineWidth: AppDimension.Card.borderWidth)
        }
        // 웹 `--shadow-lg`. 다크에서도 같은 그림자를 쓰면 배경에 묻히지만, 카드와 바탕의
        // 명도 차이가 이미 경계를 만들고 있어 테두리와 함께면 충분하다.
        .shadow(
            color: .black.opacity(0.1),
            radius: AppDimension.Card.shadowRadius,
            y: AppDimension.Card.shadowY,
        )
    }
}

/// 웹 `.alert--error`. 아이콘 없이 색만으로 구분한다(웹과 같은 구성).
struct PrismErrorAlert: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.system(size: AppDimension.FontSize.small))
            .lineSpacing(AppDimension.Alert.lineSpacing)
            .foregroundStyle(AppColor.error)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, AppDimension.Alert.horizontalPadding)
            .padding(.vertical, AppDimension.Alert.verticalPadding)
            .background(AppColor.errorBackground)
            .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
            // 오류는 화면에 나타나는 순간 읽혀야 한다 — 시각적으로만 알리면 스크린리더
            // 사용자는 버튼이 아무 반응 없는 것으로 느낀다(웹의 role="alert"에 대응).
            .accessibilityAddTraits(.isStaticText)
            .accessibilityLabel(message)
    }
}

#Preview {
    PrismCard {
        Text("Welcome back")
            .font(.system(size: AppDimension.FontSize.title, weight: .heavy))
            .foregroundStyle(AppColor.heading)
        PrismErrorAlert(message: "Couldn’t sign you in. Try again or use another method.")
    }
    .padding(AppDimension.Screen.horizontalPadding)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(AppColor.surface)
}
