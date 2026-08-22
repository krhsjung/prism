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

    @State private var viewModel: DashboardViewModel
    @State private var isDrawerOpen = false
    @State private var isSigningOut = false
    @State private var isConfirmingSignOutAll = false

    init(
        user: User,
        sessions: SessionsServicing,
        accessToken: @escaping () -> String?,
        onSignOut: @escaping () async -> Void,
    ) {
        self.user = user
        self.onSignOut = onSignOut
        _viewModel = State(
            initialValue: DashboardViewModel(
                service: sessions,
                accessToken: accessToken,
                // 전체 폐기·현재 세션 해제로 이 앱의 세션이 끝나면 로그아웃과 같은 자리로
                // 돌아간다 — 세션 상태의 진실은 AuthManager 하나뿐이다.
                onSessionEnded: onSignOut,
            ),
        )
    }

    var body: some View {
        ZStack(alignment: .leading) {
            VStack(spacing: 0) {
                topBar
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
            .background(AppColor.surface)

            if isDrawerOpen {
                // 스크림 — 탭하면 닫힌다. 드로어보다 먼저(아래에) 놓는다.
                Color.black.opacity(0.45)
                    .ignoresSafeArea()
                    .onTapGesture { isDrawerOpen = false }
                    .accessibilityHidden(true)
                    .transition(.opacity)
                drawer
                    .transition(.move(edge: .leading))
            }
        }
        .animation(.easeOut(duration: 0.25), value: isDrawerOpen)
        .task { await viewModel.load() }
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

    /// 시안 `MobileTopBar` — 워드마크 · 아바타 · 햄버거. 페이지 이름은 드로어가 말한다.
    private var topBar: some View {
        HStack(spacing: AppDimension.Spacing.md) {
            // 워드마크는 번역하지 않는다 — 로고 텍스트는 언어와 무관한 고유명사다.
            Text("Prism")
                .font(.system(size: AppDimension.FontSize.sectionTitle, weight: .heavy))
                .foregroundStyle(AppColor.heading)
            Spacer()
            PrismAvatar(name: user.displayName)
            Button {
                isDrawerOpen = true
            } label: {
                PrismGlyph.Menu()
                    .prismStroke(size: AppDimension.Dashboard.iconSize)
                    .foregroundStyle(AppColor.heading)
                    .frame(
                        width: AppDimension.Dashboard.iconSize,
                        height: AppDimension.Dashboard.iconSize,
                    )
                    // 아이콘은 24로 그리되 누르는 영역은 44까지 넓힌다(최소 터치 크기).
                    .frame(
                        width: AppDimension.Dashboard.touchTarget,
                        height: AppDimension.Dashboard.touchTarget,
                    )
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(t(.dashboardOpenMenu))
        }
        .padding(.horizontal, AppDimension.Dashboard.horizontalPadding)
        .frame(height: AppDimension.Dashboard.topBarHeight)
        .background(AppColor.card)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppColor.border).frame(height: 1)
        }
    }

    /// 시안 `Drawer Panel` — 브랜드 + 내비게이션. 그 아래 환경 설정·로그아웃은 시안에
    /// 그려져 있지 않지만, 모바일 상단 바에서 밀려난 것들이 갈 곳이 여기뿐이다.
    private var drawer: some View {
        VStack(alignment: .leading, spacing: AppDimension.Spacing.lg) {
            Text("Prism")
                .font(.system(size: AppDimension.FontSize.sectionTitle, weight: .heavy))
                .foregroundStyle(AppColor.heading)

            // 이름은 **내비 항목에만** 붙인다. 웹이 `<nav aria-label>`로 이 둘만 감싸고,
            // 아래 환경 설정·로그아웃은 그 밖에 두기 때문이다.
            //
            // `.contain`이 없으면 SwiftUI는 컨테이너의 레이블을 **자식 전부에 덮어씌운다** —
            // 실제로 드로어 전체에 붙였을 때 테마·언어·로그아웃이 모두 "내비게이션"으로
            // 읽혔다. `.contain`은 이 뷰를 영역으로만 이름 붙이고 자식은 제 이름을 지킨다.
            VStack(alignment: .leading, spacing: AppDimension.Spacing.lg) {
                navItem(t(.dashboardTitle), isActive: true, badge: nil)
                // WebRTC는 다음 슬라이스 — 자리만 잡아두고 비활성으로 둔다(plan/dashboard.md).
                navItem(t(.dashboardNavWebrtc), isActive: false, badge: t(.dashboardComingSoon))
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(t(.dashboardNavigation))

            Spacer()

            Rectangle().fill(AppColor.border).frame(height: 1)
            // 드로어는 좁고 길어 스위처가 바닥 가까이 앉는다 — 아래로 펼 자리가 없어
            // 옆으로 연다(웹 `.sidebar__footer`·Android 드로어와 같은 규칙).
            ThemeSwitcher(placement: .trailing)
            LocaleSwitcher(placement: .trailing)
            PrismButton(
                title: t(isSigningOut ? .dashboardLoggingOut : .dashboardLogOut),
                variant: .outline,
                isEnabled: !isSigningOut,
            ) {
                Task {
                    isSigningOut = true
                    // 성공하면 상태가 signedOut으로 바뀌어 이 뷰가 사라지고, 실패(극단)면
                    // 여기로 돌아와 버튼을 되살린다(재시도 가능).
                    await onSignOut()
                    isSigningOut = false
                }
            }
        }
        .padding(AppDimension.Dashboard.horizontalPadding)
        .frame(width: AppDimension.Dashboard.drawerWidth, alignment: .leading)
        .frame(maxHeight: .infinity)
        .background(AppColor.card)
    }

    /// 시안 `Atom/NavItem` — 활성은 soft blue 배경, 예약 항목은 muted + 배지.
    private func navItem(_ label: String, isActive: Bool, badge: String?) -> some View {
        HStack(spacing: AppDimension.Spacing.sm) {
            Text(label)
                .font(.system(
                    size: AppDimension.FontSize.body,
                    weight: isActive ? .semibold : .regular,
                ))
                .foregroundStyle(isActive ? AppColor.heading : AppColor.muted)
            if let badge {
                PrismBadge(title: badge, variant: .info)
            }
            Spacer()
        }
        .padding(.horizontal, AppDimension.Dashboard.navItemPadding)
        .frame(height: AppDimension.Dashboard.navItemHeight)
        .background(
            isActive ? AppColor.secondaryBackground : AppColor.card,
            in: .rect(cornerRadius: AppDimension.Radius.md),
        )
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
                PrismButton(title: t(.dashboardRetry), variant: .secondary, fillsWidth: false) {
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
                    title: t(session.isCurrent ? .dashboardStatusCurrent : .dashboardStatusActive),
                    variant: session.isCurrent ? .success : .info,
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
