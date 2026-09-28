//
//  IcePolicyChoice.swift
//  prism
//
//  Path: Features/Call/IcePolicyChoice.swift
//

import SwiftUI

/// 경로를 고르는 라디오 한 벌 — **로비와 진단 패널이 같은 것을 쓴다**(plan/webrtc.md §4,
/// 웹 `components/webrtc/IcePolicyChoice.tsx`).
///
/// 두 자리에 두는 이유는 묻는 것이 다르기 때문이다: 로비에서는 "이번 통화를 어느 경로로
/// 걸까"이고, 통화 중에는 "지금 경로를 바꿔 보자"다. 뒤쪽을 없애면 `TURN만 사용`이 `Path`를
/// 즉시 `Relayed`로 바꾸는 것을 보여 줄 자리가 사라지고, 앞쪽이 없으면 벨이 울린 **뒤에야**
/// 경로를 고를 수 있다.
///
/// 값은 한 벌이다(`CallController`가 들고 있다) — 어느 쪽에서 바꾸든 다음 연결이 그 값으로 선다.
struct IcePolicyChoice: View {
    @Environment(LocalizationStore.self) private var t

    let value: IcePolicy
    let onChange: (IcePolicy) -> Void
    /// 통화가 서는 중에는 잠근다 — 협상 도중의 전환은 되돌릴 자리가 애매하다.
    var isDisabled = false

    var body: some View {
        VStack(alignment: .leading, spacing: AppDimension.Spacing.sm) {
            radio(t(.webrtcIcePolicyAll), isOn: value == .all) { onChange(.all) }
            radio(t(.webrtcIcePolicyRelay), isOn: value == .relay) { onChange(.relay) }
        }
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.5 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t(.webrtcIcePolicy))
    }

    /// 시안 `Atom/Radio` — 18 원. 줄 전체가 표적이다.
    private func radio(
        _ label: String,
        isOn: Bool,
        action: @escaping () -> Void,
    ) -> some View {
        Button(action: action) {
            HStack(spacing: AppDimension.Spacing.sm) {
                ZStack {
                    Circle()
                        .strokeBorder(isOn ? AppColor.primary : AppColor.border, lineWidth: 1)
                        .background(Circle().fill(AppColor.card))
                    if isOn {
                        Circle()
                            .fill(AppColor.primary)
                            .padding(AppDimension.Spacing.xs + 1)
                    }
                }
                .frame(width: AppDimension.Call.radioSize, height: AppDimension.Call.radioSize)
                Text(label)
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.text)
                Spacer(minLength: 0)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }
}
