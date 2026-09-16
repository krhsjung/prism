//
//  PrismCheckbox.swift
//  prism
//
//  Path: Presentation/Views/Components/PrismCheckbox.swift
//

import SwiftUI

/// 체크박스 — 시안 `Atom/Checkbox`(웹 `.check__box`).
///
/// `Toggle`의 **스타일**로 둔다. 켜고 끄는 의미·접근성 특성은 `Toggle`이 그대로 갖고,
/// 모양만 시안의 18 정사각으로 바꾼다. iOS에는 체크박스가 없어 기본 스타일은 초록
/// 스위치가 된다 — 웹·Android의 체크박스와 한 목록을 두고 모양이 갈린다.
struct PrismCheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        PrismCheckbox(configuration: configuration)
    }
}

/// 스타일 안에서 활성 여부를 읽으려면 환경을 받는 뷰가 따로 있어야 한다.
private struct PrismCheckbox: View {
    let configuration: ToggleStyleConfiguration
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: AppDimension.Spacing.sm) {
                box
                configuration.label
            }
            .frame(minHeight: AppDimension.Checkbox.touchTarget)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation {
            Toggle(isOn: configuration.$isOn) { configuration.label }
        }
    }

    private var box: some View {
        let shape = RoundedRectangle(cornerRadius: AppDimension.Radius.sm)
        return ZStack {
            if configuration.isOn {
                shape.fill(AppColor.primary)
                CheckMark()
                    .stroke(
                        AppColor.primaryForeground,
                        style: StrokeStyle(
                            lineWidth: AppDimension.Checkbox.checkLineWidth,
                            lineCap: .round,
                            lineJoin: .round,
                        ),
                    )
            } else {
                shape.fill(isEnabled ? AppColor.card : AppColor.secondaryBackground)
                shape.strokeBorder(AppColor.border, lineWidth: 1)
            }
        }
        .frame(width: AppDimension.Checkbox.size, height: AppDimension.Checkbox.size)
        .opacity(isEnabled ? 1 : AppDimension.Checkbox.disabledOpacity)
    }
}

/// 시안의 체크 벡터(18 격자의 `M4 9.64 L7.71 13.5 L14.5 5`)를 비율로 옮긴 선.
private struct CheckMark: Shape {
    func path(in rect: CGRect) -> Path {
        let unit = rect.width / 18
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + 4 * unit, y: rect.minY + 9.64 * unit))
        path.addLine(to: CGPoint(x: rect.minX + 7.71 * unit, y: rect.minY + 13.5 * unit))
        path.addLine(to: CGPoint(x: rect.minX + 14.5 * unit, y: rect.minY + 5 * unit))
        return path
    }
}

extension ToggleStyle where Self == PrismCheckboxStyle {
    static var prismCheckbox: PrismCheckboxStyle { PrismCheckboxStyle() }
}

#Preview {
    @Previewable @State var on = true
    @Previewable @State var off = false
    VStack(alignment: .leading, spacing: 16) {
        Toggle("Selected", isOn: $on).toggleStyle(.prismCheckbox)
        Toggle("Select", isOn: $off).toggleStyle(.prismCheckbox)
        Toggle("Disabled", isOn: $off).toggleStyle(.prismCheckbox).disabled(true)
    }
    .padding()
}
