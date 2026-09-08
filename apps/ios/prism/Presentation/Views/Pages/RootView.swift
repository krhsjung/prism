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

    /// 지금 보고 있는 페이지. **웹의 라우터가 앉는 자리**다 — 셸이 두 화면을 나눠 쓰므로
    /// 어느 쪽인지는 셸 바깥(여기)에서 쥔다.
    @State private var page: ShellPage = .dashboard

    /// 백그라운드를 다녀왔는가.
    ///
    /// ⚠️ **`previous == .background`로는 판단할 수 없다.** iOS는 복귀를
    /// `.background → .inactive → .active` **두 단계로** 알려 주므로, `.active`가 올 때
    /// previous는 `.inactive`다. 그 한 줄 때문에 소켓을 다시 붙이는 분기가 한 번도 돌지
    /// 않았고, 홈으로 한 번 나가면 다른 기기의 목록에서 이 기기가 **영구히 "비활성"으로
    /// 남았다**(다시 열어도 돌아오지 않았다).
    @State private var wasBackgrounded = false

    var body: some View {
        content
            // 걸려 온 통화는 **앱 위에** 뜬다 — 대시보드를 보고 있어도 마찬가지다
            // (plan/webrtc.md §4). 소켓이 앱 전역에 붙어 있는 것과 같은 이유다.
            .overlay { incomingCall }
            .preferredColorScheme(theme.theme.colorScheme)
            .task { await auth.restoreSession() }
            .onChange(of: scenePhase) { _, current in
                // `.inactive`(알림 센터·전화 등)는 양쪽 모두 무시한다 — 잠깐 가려졌다
                // 돌아올 때마다 세션을 확인하고 소켓을 여닫으면 요동만 친다.
                if current == .background {
                    wasBackgrounded = true
                    let container = ServiceContainer.shared
                    // ⚠️ **끊고 나서 닫는다 — 순서가 핵심이다.**
                    //
                    // 소켓을 먼저 닫으면 `hangup`이 나갈 통로가 사라진다. 그러면 서버는
                    // 소켓이 사라진 것을 보고 상대에게 `peer-gone`을 보내 통화를 끝내지만,
                    // **이쪽은 그 사실을 받을 소켓이 없어** 돌아왔을 때 이미 끝난 통화를
                    // 그대로 붙들고 있게 된다(끊을 방법도 없다).
                    //
                    // 백그라운드에서는 어차피 카메라가 멈춰 통화가 성립하지 않는다 —
                    // 축소된 통화 UI를 두지 않기로 한 것과 같은 결론이다(plan/webrtc.md §4).
                    if container.call.call != nil { container.call.hangUp() }
                    // 스스로 닫아 서버가 TTL을 기다리지 않고 presence를 지우게 한다.
                    // 기다리면 다른 기기의 목록에 최대 1분간 "붙어 있음"이 남는다.
                    container.sessionSocket.stop()
                    return
                }
                // 백그라운드에 있는 동안 세션이 만료되거나 다른 기기에서 폐기될 수 있다.
                // **복귀를 두 단계로 알려 주므로** 직전 단계가 아니라 "다녀왔는가"를 본다.
                guard current == .active, wasBackgrounded else { return }
                wasBackgrounded = false
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
            LoginView(authManager: auth, pushTokens: ServiceContainer.shared.pushTokens)
                // 로그아웃하면 소켓도 닫는다 — 서버가 TTL을 기다리지 않고 presence를
                // 지워, 다른 기기의 목록에서 이 기기가 곧바로 사라진다.
                .task {
                    // 세션이 끝났다 — 연결 이력까지 지운다(다음 로그인의 첫 연결이
                    // "재연결"로 읽히지 않게). 백그라운드의 `stop()`은 그러지 않는다.
                    ServiceContainer.shared.sessionSocket.stop(endingSession: true)
                    // 통화도 세션의 것이다 — 끝난 세션의 벨이 다음 로그인 화면에
                    // 남아 있으면 안 된다.
                    ServiceContainer.shared.call.reset()
                    page = .dashboard
                }
        case .signedIn(let user):
            // 소켓은 **로그인해 있는 동안** 열려 있다(대시보드 화면 수명이 아니라) —
            // 다른 화면을 보는 동안 내 기기가 스스로를 "비활성"으로 보고하면 안 된다.
            signedIn(user)
                // 로그인해 있는 **동안** 붙어 있다. 화면 수명이 아니라 인증 수명에
                // 매단다 — 다른 화면을 보는 동안 내 기기가 스스로를 "비활성"으로
                // 보고하면 안 된다.
                .task { ServiceContainer.shared.sessionSocket.start() }
                // 알림을 눌러 들어왔다 — 통화 화면으로 옮기고 **이 통화가 아직 살아
                // 있나**를 묻는다(§6). 소켓이 붙은 뒤에야 물을 수 있다.
                //
                // 살아 있으면 벨이 다시 울리고, 아니면 `Call expired`를 본다 — 그것이
                // 푸시 경로의 정상 결말이다(§8-10). 값은 **한 번만** 소비한다 —
                // 남겨 두면 화면을 되돌아올 때마다 다시 물어본다.
                .onChange(of: PushLinkTrigger(
                    callId: PushLinks.shared.pendingCallId,
                    socketReady: ServiceContainer.shared.sessionSocket.isReady,
                )) { _, trigger in
                    guard let callId = trigger.callId, trigger.socketReady else { return }
                    page = .webrtc
                    ServiceContainer.shared.call.resumeCall(callId)
                    PushLinks.shared.consume()
                }
                // 수락은 대시보드에서도 일어난다 — 통화는 통화 화면에서 그린다.
                .onChange(of: ServiceContainer.shared.call.wantsCallScreen) { _, wants in
                    guard wants else { return }
                    page = .webrtc
                    ServiceContainer.shared.call.consumeCallScreenRequest()
                }
        }
    }

    @ViewBuilder
    private func signedIn(_ user: User) -> some View {
        let container = ServiceContainer.shared
        // 세션 API도 로그인과 같은 Bearer를 쓴다 — 토큰의 보관 위치는 Keychain
        // 하나뿐이라 여기서 그때그때 읽는다(사본을 두지 않는다).
        let token = { container.keychain.load().credentials?.accessToken }
        switch page {
        case .dashboard:
            DashboardView(
                user: user,
                sessions: container.sessionsService,
                accessToken: token,
                socket: container.sessionSocket,
                onNavigate: { page = $0 },
            ) {
                await auth.signOut()
            }
        case .push:
            PushView(
                user: user,
                sessions: container.sessionsService,
                push: container.pushService,
                pushTokens: container.pushTokens,
                accessToken: token,
                onNavigate: { page = $0 },
            ) {
                await auth.signOut()
            }
        case .webrtc:
            WebRtcView(
                user: user,
                call: container.call,
                socket: container.sessionSocket,
                sessions: container.sessionsService,
                accessToken: token,
                onNavigate: { page = $0 },
            ) {
                await auth.signOut()
            }
        }
    }

    /// 받는 쪽의 창. **자동 수락은 두지 않는다** — 내 기기라도 카메라가 말없이 켜지면
    /// 안 된다(§4).
    @ViewBuilder
    private var incomingCall: some View {
        let call = ServiceContainer.shared.call
        if let incoming = call.incoming {
            IncomingCallDialog(
                from: incoming.from,
                onAccept: call.acceptIncoming,
                onDecline: call.declineIncoming,
            )
        }
    }
}

/// `onChange`가 볼 수 있는 한 값 — 알림이 가리키는 통화와 소켓의 준비 상태.
///
/// 둘 다 바뀔 수 있고 **둘이 함께 참일 때만** 물을 수 있어서, 하나로 묶어야 어느 쪽이
/// 나중에 오든 같은 자리에서 반응한다.
private struct PushLinkTrigger: Equatable {
    let callId: String?
    let socketReady: Bool
}
