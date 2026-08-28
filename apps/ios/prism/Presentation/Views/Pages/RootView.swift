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
                // `.inactive`(알림 센터·전화 등)는 양쪽 모두 무시한다 — 잠깐 가려졌다
                // 돌아올 때마다 세션을 확인하고 소켓을 여닫으면 요동만 친다.
                if current == .background {
                    // 스스로 닫아 서버가 TTL을 기다리지 않고 presence를 지우게 한다.
                    // 기다리면 다른 기기의 목록에 최대 1분간 "붙어 있음"이 남는다.
                    ServiceContainer.shared.sessionSocket.stop()
                    return
                }
                // 백그라운드에 있는 동안 세션이 만료되거나 다른 기기에서 폐기될 수 있다.
                guard previous == .background, current == .active else { return }
                Task {
                    // ⚠️ **복원을 먼저 끝낸 뒤에** 소켓을 붙인다(순서가 핵심이다).
                    //
                    // 둘을 동시에 출발시키면, 백그라운드에서 액세스 토큰이 만료된 흔한
                    // 경우에 복원의 회전(사용자 활동 → 유휴 창을 민다)과 소켓 핸드셰이크의
                    // 회전(배경 → 밀지 않는다)이 **같은 single-flight 문을 두고 경합**한다.
                    // 어느 쪽이 먼저 닿느냐로 창이 밀리는지가 갈려, 앱을 다시 연 것이
                    // 활동으로 계산되지 않을 수 있다(plan/auth.md §6).
                    await auth.restoreSession()
                    // 복원 결과가 여전히 로그인 상태일 때만 붙인다 — 그사이 세션이 끝났다면
                    // 붙어 봐야 거절당하고, 그 거절이 다시 목록 재조회를 부른다.
                    if case .signedIn = auth.state {
                        ServiceContainer.shared.sessionSocket.start()
                    }
                }
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
                // 로그아웃하면 소켓도 닫는다 — 서버가 TTL을 기다리지 않고 presence를
                // 지워, 다른 기기의 목록에서 이 기기가 곧바로 사라진다.
                .task { ServiceContainer.shared.sessionSocket.stop() }
        case .signedIn(let user):
            // 소켓은 **로그인해 있는 동안** 열려 있다(대시보드 화면 수명이 아니라) —
            // 다른 화면을 보는 동안 내 기기가 스스로를 "비활성"으로 보고하면 안 된다.
            DashboardView(
                user: user,
                sessions: ServiceContainer.shared.sessionsService,
                // 세션 API도 로그인과 같은 Bearer를 쓴다 — 토큰의 보관 위치는
                // Keychain 하나뿐이라 여기서 그때그때 읽는다(사본을 두지 않는다).
                accessToken: { ServiceContainer.shared.keychain.load().credentials?.accessToken },
                socket: ServiceContainer.shared.sessionSocket,
            ) {
                await auth.signOut()
            }
            // 로그인해 있는 **동안** 붙어 있다. 화면 수명이 아니라 인증 수명에 매단다 —
            // 다른 화면을 보는 동안 내 기기가 스스로를 "비활성"으로 보고하면 안 된다.
            .task { ServiceContainer.shared.sessionSocket.start() }
        }
    }
}
