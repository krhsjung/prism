//
//  IncomingCallDialog.swift
//  prism
//
//  Path: Features/Call/IncomingCallDialog.swift
//

import SwiftUI

/// 걸려 온 통화 — 시안 `Organism/Modal` + `Molecule/ConfirmDialog` 골격.
///
/// **앱 어디에 있든 뜬다**(plan/webrtc.md §4) — 소켓이 이미 앱 전역에 붙어 있어서,
/// 대시보드를 보고 있어도 마찬가지다. 확인 창과 같은 무게의 결정(받는다/거절한다)이고,
/// 이미 만들어 둔 모양이다.
///
/// **자동 수락은 없다.** 내 기기라도 카메라가 말없이 켜지면 안 되고, 공유되는 데모
/// 계정에서는 더 그렇다(§7의 "미디어는 명시적 사용자 제스처 후"와 같은 줄).
///
/// 바깥을 눌러도 **닫히지 않는다** — 확인 창과 다른 점이다. 통화는 상대가 기다리고
/// 있어서, 실수로 흘려보내면 그쪽이 45초를 다 쓴다.
struct IncomingCallDialog: View {
    @Environment(LocalizationStore.self) private var t

    let from: SessionRef
    let onAccept: () -> Void
    let onDecline: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: AppDimension.Spacing.sm) {
                // 거는 쪽 이름은 **기기 종류**다. 계약에 그것밖에 없고, 그것으로
                // 충분하다 — 내 기기니까.
                PrismGlyph.device(from.device)
                    .prismStroke(size: AppDimension.Call.rowIconGlyph)
                    .foregroundStyle(AppColor.heading)
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

                Text(t(.webrtcIncomingTitle))
                    .font(.system(size: AppDimension.FontSize.sectionTitle, weight: .bold))
                    .foregroundStyle(AppColor.heading)
                Text(t(.webrtcIncomingBody, [
                    "device": t(DashboardView.deviceLabel(from.device)),
                ]))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: AppDimension.Spacing.sm) {
                    Spacer()
                    // 거절이 먼저다 — 실수로 눌렀을 때 카메라가 켜지면 안 된다
                    // (확인 창이 취소에서 시작하는 것과 같은 규칙, 여기서는 대가가 더 크다).
                    PrismButton(
                        title: t(.webrtcDecline),
                        variant: .ghost,
                        fillsWidth: false,
                        action: onDecline,
                    )
                    PrismButton(
                        title: t(.webrtcAccept),
                        variant: .secondary,
                        fillsWidth: false,
                        action: onAccept,
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
        }
        // 스크린 리더가 뒤쪽 화면 대신 이 창부터 읽게 한다.
        .accessibilityAddTraits(.isModal)
    }
}
