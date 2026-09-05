//
//  DashboardView.swift
//  prism
//
//  Path: Features/Dashboard/DashboardView.swift
//

import SwiftUI

/// 대시보드 — 로그인 이후의 화면. 시안 `Dashboard / Mobile / Default`·`Drawer (open)`.
///
/// 셸은 상단 바 하나와 드로어 하나다. 상단 바에는 워드마크·아바타·햄버거만 두고(시안),
/// 내비게이션과 환경 설정·로그아웃은 드로어로 내린다 — 좁은 폭에서 한 줄에 밀어 넣으면
/// 글자가 세로로 쪼개진다(웹·Android가 같은 이유로 같은 배치를 쓴다).
///
/// 콘텐츠는 **활성 세션 카드 하나**다. 인사말·통계·계정 상세는 의도적으로 뺐다
/// (plan/dashboard.md §2 — 집계할 도메인 데이터도, 저장하는 PII도 없다).
struct DashboardView: View {
    @Environment(LocalizationStore.self) private var t

    let user: User
    let onSignOut: () async -> Void
    /// 세션 소켓. 목록을 나르지 않고 "바뀌었다"는 신호와 "붙어 있다"만 알려 준다.
    let socket: SessionSocket
    /// 셸의 내비게이션 — 페이지 상태는 `RootView`가 쥔다(웹의 라우터 자리).
    let onNavigate: (ShellPage) -> Void

    @State private var viewModel: DashboardViewModel
    @State private var isConfirmingSignOutAll = false

    init(
        user: User,
        sessions: SessionsServicing,
        accessToken: @escaping () -> String?,
        socket: SessionSocket,
        onNavigate: @escaping (ShellPage) -> Void,
        onSignOut: @escaping () async -> Void,
    ) {
        self.user = user
        self.onSignOut = onSignOut
        self.socket = socket
        self.onNavigate = onNavigate
        _viewModel = State(
            initialValue: DashboardViewModel(
                service: sessions,
                accessToken: accessToken,
                // 전체 폐기·현재 세션 해제로 이 앱의 세션이 끝나면 로그아웃과 같은 자리로
                // 돌아간다 — 세션 상태의 진실은 AuthManager 하나뿐이다.
                onSessionEnded: onSignOut,
                notifyRevoked: { socket.send(.sessionsRevoked) },
            ),
        )
    }


    /// 배지가 말하는 것은 **연결 여부**지 세션의 유효성이 아니다(목록에는 유효한 세션만 온다).
    ///
    /// ⚠️ `socketReady`가 false면 `isConnected`를 믿지 않고 두 갈래로 물러난다.
    /// 내 소켓이 붙어 있지 않으면 서버가 내려준 빈 presence가 "아무도 안 붙었다"인지
    /// "소켓 서비스가 죽었다"인지 구별할 수 없고, 후자를 전자로 읽으면 멀쩡한 기기들을
    /// 전부 "비활성"이라고 지어내게 된다 — 모를 때는 지어내지 않는 쪽으로 실패한다.
    static func statusKey(
        _ session: SessionListItem,
        socketReady: Bool,
    ) -> MessageKey {
        if session.isCurrent { return .dashboardStatusCurrent }
        if !socketReady || session.isConnected { return .dashboardStatusActive }
        return .dashboardStatusInactive
    }

    static func statusVariant(
        _ session: SessionListItem,
        socketReady: Bool,
    ) -> PrismBadge.Variant {
        if session.isCurrent { return .success }
        if !socketReady || session.isConnected { return .info }
        return .neutral
    }

    var body: some View {
        AppShellView(
            page: .dashboard,
            user: user,
            onNavigate: onNavigate,
            onSignOut: onSignOut,
        ) {
            ScrollView {
                sessionsCard
                    .padding(AppDimension.Dashboard.horizontalPadding)
            }
            // 세션 목록은 이 앱 밖에서도 바뀐다 — 다른 기기에서 로그인하거나 만료되면
            // 화면과 서버가 어긋난다. 당겨서 새로고침이 그것을 맞추는 손잡이다.
            // `load()`가 아니라 `refresh()`인 것이 중요하다: 인디케이터가 이미 "받았다"를
            // 말하고 있어, 목록까지 비우면 화면만 흔들린다.
            .refreshable { await viewModel.refresh() }
            // 카드 하나뿐이라 내용이 화면보다 짧다 — 그대로 두면 당길 여지가 없어
            // 제스처 자체가 일어나지 않는다.
            .scrollBounceBehavior(.always)
        }
        .task { await viewModel.load() }
        // 소켓이 "바뀌었다"고 하면 다시 가져온다.
        //
        // **비우지 않는다**(load가 아니라 refresh) — 다른 기기가 하나 붙었다고 카드가
        // "불러오는 중"으로 접혔다 펴지면 목록 전체가 깜빡인다(plan/dashboard.md §4).
        // changed는 0에서 시작하고 소켓의 첫 ready가 1로 올리므로, 위 `.task`의 첫
        // 조회와 겹치지 않는다.
        .onChange(of: socket.changed) { _, _ in
            // 소켓이 시킨 재조회다 — 사용자가 한 일이 아니므로 유휴 창을 밀지 않는다.
            Task { await viewModel.refresh(background: true) }
        }
        .overlay {
            if isConfirmingSignOutAll {
                PrismConfirmDialog(
                    title: t(.dashboardSignOutAllConfirmTitle),
                    message: t(.dashboardSignOutAllConfirmBody),
                    confirmTitle: t(.dashboardSignOutAll),
                    cancelTitle: t(.commonCancel),
                    isBusy: viewModel.isSigningOutAll,
                ) {
                    isConfirmingSignOutAll = false
                    Task { await viewModel.signOutAll() }
                } onCancel: {
                    isConfirmingSignOutAll = false
                }
            }
        }
    }

    /// 시안 `SessionsCard` — 제목 · 요약 · 세션 행들.
    private var sessionsCard: some View {
        // 여백을 카드가 아니라 **각 구획**이 갖는다 — 그래야 구분선이 카드 폭을 가로지른다
        // (웹 `.sessions { padding: 0 }`와 같은 구조).
        PrismCard(padding: 0, spacing: 0) {
            VStack(alignment: .leading, spacing: AppDimension.Dashboard.headSpacing) {
                Text(t(.dashboardActiveSessions))
                    .font(.system(size: AppDimension.FontSize.sectionTitle, weight: .heavy))
                    .foregroundStyle(AppColor.heading)
                Text(t(.dashboardActiveSessionsDesc))
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, AppDimension.Dashboard.sessionCardInset)
            .padding(.vertical, AppDimension.Dashboard.sessionHeadPadding)

            if let key = viewModel.actionErrorKey {
                PrismErrorAlert(message: t(key))
                    .padding(.horizontal, AppDimension.Dashboard.sessionCardInset)
                    .padding(.bottom, AppDimension.Dashboard.sessionHeadPadding)
            }

            sessionsBody

            // "모두 로그아웃"의 자리는 **목록 아래**다 — 무엇이 끊기는지 다 본 뒤에 전체에
            // 대한 행동을 하게 된다. 목록이 마지막 행 아래에 이미 구분선을 긋고 있어 그것이
            // 그대로 경계가 된다. 폭을 채우는 것이 중요하다: 행마다 오른쪽에 있는 "해제"
            // 기둥에 이어 붙으면 "행 하나 더"로 읽히고 오탭 표적도 겹친다.
            // (나 말고 다른 세션이 있을 때만 의미가 있다)
            if viewModel.hasOthers {
                cardDivider
                PrismButton(
                    title: t(viewModel.isSigningOutAll
                        ? .dashboardSigningOutAll : .dashboardSignOutAll),
                    variant: .secondary,
                    isEnabled: !viewModel.isSigningOutAll,
                ) {
                    // 되돌릴 수 없다 — 바로 실행하지 않고 한 번 되묻는다.
                    isConfirmingSignOutAll = true
                }
                .padding(.horizontal, AppDimension.Dashboard.sessionCardInset)
                .padding(.vertical, AppDimension.Dashboard.sessionRowPadding)
            }
        }
    }

    @ViewBuilder
    private var sessionsBody: some View {
        if let key = viewModel.loadErrorKey {
            VStack(alignment: .leading, spacing: AppDimension.Spacing.md) {
                PrismErrorAlert(message: t(key))
                PrismButton(title: t(.commonRetry), variant: .secondary, fillsWidth: false) {
                    Task { await viewModel.load() }
                }
            }
            .padding(.horizontal, AppDimension.Dashboard.sessionCardInset)
            .padding(.bottom, AppDimension.Dashboard.sessionHeadPadding)
        } else if let sessions = viewModel.sessions {
            // 현재 세션은 항상 하나 있으므로 "0건"은 없다 — 1건이 "나 혼자"다.
            if sessions.count == 1 {
                Text(t(.dashboardOnlyThisSession))
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.muted)
                    .padding(.horizontal, AppDimension.Dashboard.sessionCardInset)
                    .padding(.bottom, AppDimension.Dashboard.sessionHeadPadding)
            } else {
                ForEach(sessions) { session in
                    // 선은 행의 **위**에 둔다. 그러면 첫 행 위(= 카드 머리 아래)에도
                    // 한 줄이 생기고, 마지막 행 아래에는 생기지 않는다 — 거기는 카드
                    // 끝이거나 자기 선을 가진 푸터다(웹 `.session { border-top }`).
                    cardDivider
                    sessionRow(session)
                }
            }
        } else {
            Text(t(.commonLoading))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.muted)
                .padding(.horizontal, AppDimension.Dashboard.sessionCardInset)
                .padding(.bottom, AppDimension.Dashboard.sessionHeadPadding)
        }
    }

    /// 카드 폭을 가로지르는 1px 구분선.
    private var cardDivider: some View {
        Rectangle().fill(AppColor.border).frame(height: 1)
    }

    /// 세션 한 줄 — 시안 `SessionRow`.
    ///
    /// 시안은 기기 이름과 브라우저·위치를 보여주지만 **계약에 그런 값이 없다**(UA·IP
    /// 미저장, plan/dashboard.md §5). 그 자리에 "현재 세션 / 로그인된 세션"과 짧은 세션
    /// id를 그린다 — 시안의 라벨은 시각적 밀도를 잡기 위한 자리표시로 읽는다.
    private func sessionRow(_ session: SessionListItem) -> some View {
        VStack(alignment: .leading, spacing: AppDimension.Dashboard.blockSpacing) {
            HStack(spacing: AppDimension.Spacing.md) {
                PrismGlyph.device(session.device)
                    .prismStroke(size: AppDimension.Dashboard.sessionIconGlyph)
                    .foregroundStyle(AppColor.heading)
                    .frame(
                        width: AppDimension.Dashboard.sessionIconGlyph,
                        height: AppDimension.Dashboard.sessionIconGlyph,
                    )
                    .frame(
                        width: AppDimension.Dashboard.sessionIconTile,
                        height: AppDimension.Dashboard.sessionIconTile,
                    )
                    .background(
                        AppColor.secondaryBackground,
                        in: .rect(cornerRadius: AppDimension.Radius.md),
                    )
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(t(DashboardView.deviceLabel(session.device)))
                        .font(.system(size: AppDimension.FontSize.body, weight: .semibold))
                        .foregroundStyle(AppColor.heading)
                    // 기기명·브라우저·위치는 저장하지 않으므로(§5) 부제에는 짧은 세션
                    // id만 둔다. "현재/로그인된 세션"은 바로 옆 배지가 이미 말하고 있어,
                    // 함께 적으면 같은 말이 두 번 나오고 좁은 폭에서 줄바꿈까지 만든다.
                    Text("#\(session.id.prefix(8))")
                        .font(.system(size: AppDimension.FontSize.label))
                        .foregroundStyle(AppColor.muted)
                }
                Spacer()
                PrismBadge(
                    title: t(Self.statusKey(session, socketReady: socket.isReady)),
                    variant: Self.statusVariant(session, socketReady: socket.isReady),
                )
            }

            // 시안에서 시작·만료는 **붙은 한 덩어리**이고(17pt 줄 사이 1pt), 해제 버튼은
            // 그 덩어리 오른쪽에 세로 가운데로 선다. 만료 줄에만 붙이면 시작 줄 쪽이 빈다.
            HStack {
                VStack(alignment: .leading, spacing: AppDimension.Dashboard.whenSpacing) {
                    Text("\(t(.dashboardColStarted)) \(DashboardTimestamp.format(session.startedAt, locale: t.locale))")
                        .font(.system(size: AppDimension.FontSize.label))
                        .foregroundStyle(AppColor.muted)
                    Text("\(t(.dashboardColExpires)) \(DashboardTimestamp.format(session.expiresAt, locale: t.locale))")
                        .font(.system(size: AppDimension.FontSize.label))
                        .foregroundStyle(AppColor.muted)
                }
                Spacer()
                // 현재 세션에는 해제 버튼을 두지 않는다 — 그건 로그아웃이고, 드로어에 있다.
                if !session.isCurrent {
                    PrismButton(
                        // 진행 중이라고 **글자를 바꾸지 않는다.** 버튼은 글자만큼만
                        // 차지하므로 "해제" → "해제하는 중…"이면 폭이 두 배가 되어 행이
                        // 통째로 밀린다 — 요청이 짧아 그 흔들림만 깜빡임으로 남는다.
                        // 진행 표시는 행 전체를 흐리게 하는 쪽이 맡는다(아래).
                        title: t(.dashboardRevoke),
                        // 손가락에는 hover가 없다 — 판 없는 ghost는 "눌리는 것"이라는
                        // 신호를 hover에 기대고 있어, 터치에서는 그냥 글자로 보인다.
                        // 그래서 터치 화면에서는 판을 깐다(웹도 좁은 폭에서 같다).
                        variant: .secondary,
                        isEnabled: viewModel.revokingID == nil && !viewModel.isSigningOutAll,
                        fillsWidth: false,
                    ) {
                        Task { await viewModel.revoke(session) }
                    }
                    // 목록에 "해제"가 여럿이라 버튼 글자만으로는 무엇을 끊는지 알 수 없다 —
                    // 화면에서 뺀 "현재/로그인된 세션"이 여기서 제 몫을 한다.
                    .accessibilityLabel(
                        "\(t(.dashboardRevoke)): \(t(DashboardView.deviceLabel(session.device)))"
                            + " · \(t(session.isCurrent ? .dashboardThisSession : .dashboardASession))"
                            + " · #\(session.id.prefix(8))",
                    )
                }
            }
        }
        .padding(.horizontal, AppDimension.Dashboard.sessionCardInset)
        .padding(.vertical, AppDimension.Dashboard.sessionRowPadding)
        // 끊기는 중인 행은 통째로 흐려진다. 바쁜 것은 버튼이 아니라 **이 세션**이고,
        // 곧 사라질 행이라 그 예고로도 읽힌다. 크기가 변하지 않아 목록이 흔들리지 않는다.
        .opacity(
            viewModel.revokingID == session.id ? AppDimension.Button.disabledOpacity : 1,
        )
    }


    /// 기기 종류 → 문구 키. 계약이 네 갈래뿐이라 `switch`가 전부를 덮고, 갈래가 늘면
    /// 컴파일에서 걸린다.
    static func deviceLabel(_ device: DeviceKind) -> MessageKey {
        switch device {
        case .iphone: .dashboardDeviceIphone
        case .ipad: .dashboardDeviceIpad
        case .galaxy: .dashboardDeviceGalaxy
        case .pixel: .dashboardDevicePixel
        case .android: .dashboardDeviceAndroid
        case .mac: .dashboardDeviceMac
        case .windows: .dashboardDeviceWindows
        case .desktop: .dashboardDeviceDesktop
        case .unknown: .dashboardDeviceUnknown
        }
    }
}
