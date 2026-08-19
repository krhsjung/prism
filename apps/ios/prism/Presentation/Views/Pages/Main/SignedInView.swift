//
//  SignedInView.swift
//  prism
//
//  Path: Presentation/Views/Pages/Main/SignedInView.swift
//

import SwiftUI

/// 로그인 뒤에 착지하는 자리 — **임시 화면**이다.
///
/// 대시보드(세션 목록·Revoke 등)는 별도 슬라이스이고(plan/dashboard.md §7), 여기서는
/// 로그인이 끝까지 갔는지 눈으로 확인하고 되돌아올 수 있는 최소한만 그린다.
/// 문구는 이미 마스터에 있는 대시보드 키를 그대로 쓴다.
struct SignedInView: View {
    @Environment(LocalizationStore.self) private var t

    let user: User
    /// 로그아웃 액션. 이 뷰가 async로 실행하고 완료 뒤 버튼을 되살린다 — 로그아웃이
    /// 상태를 바꾸지 못한 극단(Keychain 완전 장애로 signedIn 유지)에서도 버튼이
    /// "Logging out"으로 굳어 재시도가 막히지 않게 한다.
    let onSignOut: () async -> Void

    @State private var isSigningOut = false

    var body: some View {
        VStack(spacing: AppDimension.Screen.sectionSpacing) {
            PrismCard {
                Text(t(.dashboardTitle))
                    .font(.system(size: AppDimension.FontSize.title, weight: .heavy))
                    .foregroundStyle(AppColor.heading)

                Text(t(.dashboardSignedInAs, ["name": user.displayName]))
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.muted)

                Text(t(.dashboardPlaceholderBody))
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.muted)

                PrismButton(
                    title: t(isSigningOut ? .dashboardLoggingOut : .dashboardLogOut),
                    variant: .secondary,
                    isEnabled: !isSigningOut,
                ) {
                    Task {
                        isSigningOut = true
                        // 성공하면 상태가 signedOut으로 바뀌어 이 뷰가 사라지고, 실패(극단)면
                        // 여기로 돌아와 버튼을 되살린다(재시도 가능).
                        await onSignOut()
                        isSigningOut = false
                    }
                }
            }

            HStack(spacing: AppDimension.Spacing.sm) {
                ThemeSwitcher()
                LocaleSwitcher()
            }
        }
        .padding(.horizontal, AppDimension.Screen.horizontalPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppColor.surface)
    }
}
