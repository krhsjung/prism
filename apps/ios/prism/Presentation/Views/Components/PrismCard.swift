//
//  PrismCard.swift
//  prism
//
//  Path: Presentation/Views/Components/PrismCard.swift
//

import SwiftUI

/// 웹 `.card`와 같은 표면 — 로그인·대시보드가 공유하는 컨테이너.
struct PrismCard<Content: View>: View {
    /// 내용 여백. **구분선이 카드 폭을 가로지르는** 카드(세션 목록)는 0으로 두고, 각
    /// 구획이 자기 여백을 갖는다 — 카드가 여백을 쥐면 선도 그만큼 안으로 들어온다
    /// (웹 `.sessions { padding: 0 }`와 같은 구조).
    var padding: CGFloat = AppDimension.Card.padding
    /// 구획 사이 간격. 구분선으로 나뉘는 카드는 0이다(간격은 각 구획의 여백이 만든다).
    var spacing: CGFloat = AppDimension.Card.spacing
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            content
        }
        .padding(padding)
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
