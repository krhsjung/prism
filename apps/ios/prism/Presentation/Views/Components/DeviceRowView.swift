//
//  DeviceRowView.swift
//  prism
//
//  Path: Presentation/Views/Components/DeviceRowView.swift
//

import SwiftUI

/// 기기 한 줄 — 아이콘 칩 · 이름/짧은 세션 id · 오른쪽 동작.
///
/// **통화 로비와 푸시 화면이 같은 부품을 쓴다.** 같은 목록(`GET /auth/sessions`)을 두
/// 화면이 다르게 그리면 그것부터 설명해야 한다(plan/push.md §4). 다른 것은 오른쪽에
/// 무엇이 오느냐뿐이라 그 자리만 `trailing`으로 연다.
struct DeviceRowView<Trailing: View>: View {
    let device: DeviceKind
    let title: String
    let subtitle: String
    /// 닿을 수 없는 줄은 흐리게 — 회색 **버튼**을 남기는 대신 줄 전체가 상태를 말한다.
    let isMuted: Bool
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: AppDimension.Call.rowSpacing) {
            PrismGlyph.device(device)
                .prismStroke(size: AppDimension.Call.rowIconGlyph)
                .foregroundStyle(isMuted ? AppColor.muted : AppColor.heading)
                .frame(
                    width: AppDimension.Call.rowIconGlyph,
                    height: AppDimension.Call.rowIconGlyph,
                )
                .frame(
                    width: AppDimension.Call.rowIconTile,
                    height: AppDimension.Call.rowIconTile,
                )
                .background(
                    AppColor.secondaryBackground,
                    in: .rect(cornerRadius: AppDimension.Radius.md),
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: AppDimension.Call.rowLabelSpacing) {
                Text(title)
                    .font(.system(size: AppDimension.Call.fontRowTitle))
                    .foregroundStyle(isMuted ? AppColor.muted : AppColor.heading)
                Text(subtitle)
                    .font(.system(size: AppDimension.Call.fontCaption))
                    .foregroundStyle(AppColor.muted)
            }
            Spacer(minLength: AppDimension.Spacing.sm)
            trailing
        }
        .padding(.horizontal, AppDimension.Call.rowHorizontalPadding)
        .padding(.vertical, AppDimension.Call.rowVerticalPadding)
    }
}
