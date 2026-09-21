//
//  PrismToast.swift
//  prism
//
//  Path: Presentation/Views/Components/PrismToast.swift
//

import SwiftUI

/// 바닥에 잠깐 떠서 스스로 사라지는 한 줄 알림(시안 `Molecule/Toast`).
///
/// 인라인 배너 대신 이것을 쓰는 이유는 **레이아웃을 건드리지 않기 때문**이다. 좁은 자리
/// (드로어)에 문구를 펼치면 항목들이 밀려나며 화면이 흔들리고, 실패를 알리는 순간
/// 사용자의 눈은 방금 닫힌 확인 창이 있던 화면 가운데에 있다(plan/auth.md §8-1).
///
/// - Note: 플랫폼 기본 알림(`.alert`)을 쓰지 않는 것은 확인 창과 같은 이유다 — 세
///   클라이언트가 같아 보여야 하고, 그것이 이 프로젝트가 보이려는 것이다.
struct PrismToast: View {
    let message: String
    /// 스스로 사라진 뒤 호출된다. 부모가 상태를 내려 이 뷰를 걷어낸다.
    let onDismiss: () -> Void
    var duration: Duration = .seconds(5)

    var body: some View {
        Text(message)
            .font(.system(size: AppDimension.FontSize.body))
            .foregroundStyle(AppColor.error)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, AppDimension.Toast.horizontalPadding)
            .padding(.vertical, AppDimension.Toast.verticalPadding)
            .background(
                RoundedRectangle(cornerRadius: AppDimension.Toast.cornerRadius)
                    .fill(AppColor.errorBackground)
                    .stroke(AppColor.error, lineWidth: 1)
            )
            // 떠 있다는 것은 그림자가 말한다.
            .shadow(color: .black.opacity(0.14), radius: 8, y: 8)
            .padding(.horizontal, AppDimension.Toast.screenInset)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .padding(.bottom, AppDimension.Toast.bottomInset)
            // 읽는 사람에게도 전해지되 하던 일을 끊지는 않는다.
            .accessibilityAddTraits(.isStaticText)
            .allowsHitTesting(false)
            // 문구가 바뀌면 타이머도 새로 시작한다 — 남은 시간을 물려받으면 두 번째
            // 알림이 첫 번째의 잔여 시간만큼만 보인다. `task(id:)`가 그 재시작을 맡는다.
            .task(id: message) {
                try? await Task.sleep(for: duration)
                guard !Task.isCancelled else { return }
                onDismiss()
            }
    }
}
