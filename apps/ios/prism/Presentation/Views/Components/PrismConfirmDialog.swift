//
//  PrismConfirmDialog.swift
//  prism
//
//  Path: Presentation/Views/Components/PrismConfirmDialog.swift
//

import SwiftUI

/// 되돌릴 수 없는 동작 앞에 세우는 확인 창.
///
/// 시스템 `.alert`을 쓰지 않는다 — 껍데기 색·모서리·버튼 배치가 플랫폼 소유라 웹·Android와
/// 나란히 놓으면 여기서만 튄다(선택 메뉴를 직접 그리는 것과 같은 이유,
/// `PreferenceSwitchers`). 카드 모양은 시안의 `Card` 토큰을 그대로 쓴다.
///
/// **취소가 먼저다.** 왼쪽에 두고 무게도 낮춘다 — 되돌릴 수 없는 쪽이 손에 먼저 걸리면
/// 확인 창을 세운 의미가 없다.
struct PrismConfirmDialog: View {
    let title: String
    let message: String
    let confirmTitle: String
    let cancelTitle: String
    /// 진행 중에는 두 번 눌리지 않게 잠근다 — 중복 호출이 곧 손해다.
    var isBusy = false
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            // 스크림 — 바깥을 누르면 닫힌다(취소와 같다).
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture(perform: onCancel)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: AppDimension.Spacing.sm) {
                Text(title)
                    .font(.system(size: AppDimension.FontSize.sectionTitle, weight: .bold))
                    .foregroundStyle(AppColor.heading)
                Text(message)
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.muted)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: AppDimension.Spacing.sm) {
                    Spacer()
                    // 취소는 테두리만, 확인은 채운 판 — 무게 차이가 곧 기본값의 표시다.
                    PrismButton(
                        title: cancelTitle,
                        variant: .ghost,
                        isEnabled: !isBusy,
                        fillsWidth: false,
                        action: onCancel,
                    )
                    PrismButton(
                        title: confirmTitle,
                        variant: .secondary,
                        isEnabled: !isBusy,
                        fillsWidth: false,
                        action: onConfirm,
                    )
                }
                .padding(.top, AppDimension.Spacing.sm)
            }
            .padding(AppDimension.Dashboard.horizontalPadding)
            .frame(maxWidth: AppDimension.Dashboard.dialogWidth)
            .background(AppColor.card, in: .rect(cornerRadius: AppDimension.Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: AppDimension.Radius.lg)
                    .stroke(AppColor.border, lineWidth: 1)
            }
            .padding(AppDimension.Dashboard.horizontalPadding)
            // 창 안을 눌러도 스크림의 탭이 먹지 않게 막는다.
            .contentShape(.rect)
            .onTapGesture {}
        }
        // 스크린 리더가 뒤쪽 화면 대신 이 창부터 읽게 한다.
        .accessibilityAddTraits(.isModal)
    }
}
