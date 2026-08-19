//
//  RootView.swift
//  prism
//
//  Path: Presentation/Views/Pages/RootView.swift
//

import SwiftUI

/// 인증 상태가 화면을 고르는 자리.
///
/// 시작이 `checking`인 것이 중요하다 — Keychain에 토큰이 있다는 사실만으로 로그인된
/// 화면을 그리면, 원격에서 폐기된 세션이 한 프레임 통과한다(plan/auth.md §6:
/// 세션의 진실은 토큰이 아니라 서버에 있다).
struct RootView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(ThemeStore.self) private var theme
    @Environment(LocalizationStore.self) private var t
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        content
            .preferredColorScheme(theme.theme.colorScheme)
            .task { await auth.restoreSession() }
            .onChange(of: scenePhase) { previous, current in
                // 백그라운드에 있는 동안 세션이 만료되거나 다른 기기에서 폐기될 수 있다.
                // 복귀할 때 한 번 확인한다 — `.inactive`(알림 센터·전화 등)까지 포함하면
                // 잠깐 가려졌다 돌아올 때마다 불필요한 호출이 나간다.
                guard previous == .background, current == .active else { return }
                Task { await auth.restoreSession() }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch auth.state {
        case .checking:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(AppColor.surface)
                .accessibilityLabel(t(.commonLoading))
        case .signedOut:
            LoginView(authManager: auth)
        case .signedIn(let user):
            SignedInView(user: user) {
                await auth.signOut()
            }
        }
    }
}
