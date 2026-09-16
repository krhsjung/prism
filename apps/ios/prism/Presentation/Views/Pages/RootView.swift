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
    /// 알림이 가리킨 통화를 묻는 일의 주인 — 비동기 보내기와 사람의 이동이 겹치는 자리다.
    @State private var resumer = PushCallResumer(links: PushLinks.shared) { callId in
        await ServiceContainer.shared.call.resumeCall(callId)
    }
    /// 소켓이 준비될 때마다 오른다 — 다시 붙은 뒤의 계기가 옛 소켓의 보내기에 합류하지 않게.
    @State private var socketConnection = 0
    @State private var page: ShellPage = .dashboard

    /// 백그라운드를 다녀왔는가.
    ///
    /// ⚠️ **`previous == .background`로는 판단할 수 없다.** iOS는 복귀를
    /// `.background → .inactive → .active` **두 단계로** 알려 주므로, `.active`가 올 때
    /// previous는 `.inactive`다. 그 한 줄 때문에 소켓을 다시 붙이는 분기가 한 번도 돌지
    /// 않았고, 홈으로 한 번 나가면 다른 기기의 목록에서 이 기기가 **영구히 "비활성"으로
    /// 남았다**(다시 열어도 돌아오지 않았다).
    @State private var wasBackgrounded = false

    /// 셸의 이동. 통화 화면을 **떠나면** 아직 묻지 못한 통화 요청을 버린다 — 남겨 두면 다시
    /// 붙는 순간 통화 화면으로 끌려가고, 그때까지 화면 요청은 통화에 밀려 버려진다.
    private func navigate(_ next: ShellPage) {
        page = next
        if next != .webrtc { resumer.leaveCallScreen() }
    }

    var body: some View {
        content
            // 걸려 온 통화는 **앱 위에** 뜬다 — 대시보드를 보고 있어도 마찬가지다
            // (plan/webrtc.md §4). 소켓이 앱 전역에 붙어 있는 것과 같은 이유다.
            .overlay { incomingCall }
            .preferredColorScheme(theme.theme.colorScheme)
            .task { await auth.restoreSession() }
            // 알림 버튼 문구는 시스템에 등록해 둔 값이라 뷰처럼 다시 그려지지 않는다 — 언어를
            // 바꾸면 지금 언어로 다시 등록한다.
            .onChange(of: t.locale) { _, _ in
                PushCategories.register(localization: t)
            }
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
                        // 뒤에 있는 동안 사람은 설정에서 알림을 끌 수 있고 FCM은 토큰을
                        // 돌린다 — 돌아온 김에 등록을 맞춘다(PushRegistration).
                        ServiceContainer.shared.pushRegistration.reconcile()
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
                .task {
                    // 세션이 끝났다 — 연결 이력까지 지운다(다음 로그인의 첫 연결이
                    // "재연결"로 읽히지 않게). 백그라운드의 `stop()`은 그러지 않는다.
                    ServiceContainer.shared.sessionSocket.stop(endingSession: true)
                    // 통화도 세션의 것이다 — 끝난 세션의 벨이 다음 로그인 화면에
                    // 남아 있으면 안 된다.
                    ServiceContainer.shared.call.reset()
                    // 세션 목록도 마찬가지다 — 다음 사용자의 대시보드에 앞 사람의
                    // 기기 목록이 한 프레임이라도 그려지면 안 된다.
                    ServiceContainer.shared.sessions.reset()
                    // 등록도 세션의 것이다 — 진행 중이던 되살리기가 다음 세션에 붙지 못하게.
                    ServiceContainer.shared.pushRegistration.reset()
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
                // 목록도 **세션이 시작될 때 한 번** 받는다 — 화면마다 받으면 화면을
                // 오갈 때마다 같은 것을 다시 묻고, 화면마다 규칙이 갈린다.
                .task { await ServiceContainer.shared.sessions.load() }
                // 소켓이 "바뀌었다"고 하면 다시 가져온다 — **이 자리 하나뿐이다.**
                //
                // 화면이 아니라 세션에 매단 것이 핵심이다: 보고 있는 화면만 듣게 하면
                // 듣지 않는 화면이 생기고(푸시 화면이 그랬다), 화면을 하나 더 만들 때마다
                // 같은 규칙을 옮겨 적어야 한다. **비우지 않는다** — 다른 기기가 하나
                // 붙었다고 목록이 "불러오는 중"으로 접혔다 펴지면 통째로 깜빡인다.
                // 재연결의 첫 ready도 이 신호를 올리므로, 백그라운드를 다녀오는 동안
                // 놓친 변화가 복귀와 함께 따라온다(SessionSocket.handle).
                .onChange(of: ServiceContainer.shared.sessionSocket.changed) { _, _ in
                    Task {
                        await ServiceContainer.shared.sessions.refresh(background: true)
                    }
                }
                // 이 기기가 **받기로 해 뒀으면** 조용히 다시 붙인다(§5-16) — 등록의 수명을
                // 쥔 코디네이터가 로그인 직후 한 번 맞춘다. 권한 창은 뜨지 않는다.
                .task { ServiceContainer.shared.pushRegistration.reconcile() }
                // 내 줄의 등록 여부가 바뀌었다(목록 도착·다른 화면의 해제·서버가 죽은
                // 토큰을 뗌) — 그때도 한 번 맞춘다.
                .onChange(of: ServiceContainer.shared.sessions.sessions?
                    .first(where: \.isCurrent)?.pushRegistered
                ) { _, _ in
                    ServiceContainer.shared.pushRegistration.reconcile()
                }
                // 알림을 눌러 들어왔다 — 통화 화면으로 옮기고 **이 통화가 아직 살아
                // 있나**를 묻는다(§6). 소켓이 붙은 뒤에야 물을 수 있다.
                //
                // 살아 있으면 벨이 다시 울리고, 아니면 `Call expired`를 본다 — 그것이
                // 푸시 경로의 정상 결말이다(§8-10). 값은 **한 번만** 소비한다 —
                // 남겨 두면 화면을 되돌아올 때마다 다시 물어본다.
                .onChange(of: ServiceContainer.shared.sessionSocket.isReady, initial: true) { _, ready in
                    if ready { socketConnection += 1 }
                }
                .onChange(of: PushLinkTrigger(
                    callId: PushLinks.shared.pendingCallId,
                    seq: PushLinks.shared.callSeq,
                    connection: socketConnection,
                    socketReady: ServiceContainer.shared.sessionSocket.isReady,
                ), initial: true) { _, trigger in
                    guard let callId = trigger.callId, trigger.socketReady else { return }
                    page = .webrtc
                    // 묻는 일(겹침·실패 뒤 남기기·떠남)은 한 주인이 한다(`PushCallResumer`).
                    resumer.attempt(callId: callId, seq: trigger.seq, connection: trigger.connection)
                }
                // 알림의 링크가 우리 주소였다 — 그 화면으로 옮긴다(딥링크). 앱이 꺼진 채 눌렀으면
                // 이 뷰가 서기 전에 값이 들어와 있으므로 처음에도 본다(`initial`).
                .onChange(of: PushLinks.shared.pendingPage, initial: true) { _, destination in
                    guard let destination else { return }
                    page = switch destination {
                    case .dashboard: .dashboard
                    case .push: .push
                    case .webrtc: .webrtc
                    }
                    PushLinks.shared.consumePage()
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
                store: container.sessions,
                accessToken: token,
                socket: container.sessionSocket,
                onNavigate: navigate,
            ) {
                await auth.signOut()
            }
        case .push:
            PushView(
                user: user,
                store: container.sessions,
                push: container.pushService,
                pushTokens: container.pushTokens,
                registration: container.pushRegistration,
                accessToken: token,
                onNavigate: navigate,
            ) {
                await auth.signOut()
            }
        case .webrtc:
            WebRtcView(
                user: user,
                call: container.call,
                socket: container.sessionSocket,
                store: container.sessions,
                onNavigate: navigate,
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
    /// 같은 통화를 다시 열어 달라고 해도 새 값이 되게 — `PushLinks.callSeq`.
    let seq: Int
    /// 소켓이 준비된 횟수 — 다시 붙으면 새 값이 되게.
    let connection: Int
    let socketReady: Bool
}
