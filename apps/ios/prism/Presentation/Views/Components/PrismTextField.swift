//
//  PrismTextField.swift
//  prism
//
//  Path: Presentation/Views/Components/PrismTextField.swift
//

import SwiftUI

/// 자유 입력 한 칸 — 시안 `Atom/Input`(웹 `.input`·`.textarea`).
///
/// `TextField`를 그대로 두면 글자는 시스템 라벨색, 자리 표시는 시스템 회색, 커서는 앱
/// 기본 tint로 나온다 — 같은 화면이 웹·Android와 다른 입력 칸이 된다. 색·여백·초점
/// 테두리를 여기서 한 번 정하고, 키보드 종류·자동 대문자 같은 **입력의 성격**은 호출부가
/// 이 뷰 바깥에 붙인다(환경으로 안쪽 `TextField`까지 내려간다).
struct PrismTextField: View {
    let placeholder: String
    @Binding var text: String
    /// `.vertical`이면 줄이 늘어난다 — 줄 수 상한은 호출부의 `.lineLimit`이 정한다.
    var axis: Axis = .horizontal

    @FocusState private var isFocused: Bool
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        TextField(
            placeholder,
            text: $text,
            prompt: Text(placeholder).foregroundStyle(AppColor.muted),
            axis: axis,
        )
        .textFieldStyle(.plain)
        .font(.system(size: AppDimension.FontSize.body))
        .foregroundStyle(AppColor.text)
        .tint(AppColor.accent)
        .focused($isFocused)
        .padding(.horizontal, AppDimension.Input.horizontalPadding)
        .padding(.vertical, AppDimension.Input.verticalPadding)
        .background {
            // 칸의 여백을 눌러도 입력이 시작돼야 한다 — 글자 줄만 표적이면 칸이 반쯤 죽는다.
            // 제스처를 **바탕에만** 건다: 칸 전체에 걸면 글자 사이를 눌러 커서를 옮기는
            // 동작과 부딪힌다.
            RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                .fill(isEnabled ? AppColor.card : AppColor.secondaryBackground)
                .onTapGesture { isFocused = true }
        }
        .overlay {
            // 굵기가 바뀌어도 글자가 밀리지 않게 **안쪽으로** 긋는다.
            RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                .strokeBorder(
                    isFocused ? AppColor.accent : AppColor.border,
                    lineWidth: isFocused
                        ? AppDimension.Input.focusedBorderWidth
                        : AppDimension.Input.borderWidth,
                )
        }
        .opacity(isEnabled ? 1 : AppDimension.Input.disabledOpacity)
    }
}

#Preview {
    @Previewable @State var title = ""
    @Previewable @State var message = "Hello"
    VStack(spacing: 16) {
        PrismTextField(placeholder: "Title", text: $title)
        PrismTextField(placeholder: "Message", text: $message, axis: .vertical)
            .lineLimit(3...5)
        PrismTextField(placeholder: "Disabled", text: $title)
            .disabled(true)
    }
    .padding()
}
