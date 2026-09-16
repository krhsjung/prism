//
//  AppShellView.swift
//  prism
//
//  Path: Presentation/Views/Pages/AppShellView.swift
//

import SwiftUI

/// 셸이 아는 페이지. 라우트가 늘면 여기가 먼저 걸린다.
enum ShellPage: Hashable {
    case dashboard
    case push
    case webrtc

    var title: MessageKey {
        switch self {
        case .dashboard: .dashboardTitle
        case .push: .pushTitle
        case .webrtc: .webrtcTitle
        }
    }
}

/// 앱 셸 — 상단 바 하나와 드로어 하나(시안 `MobileTopBar` · `Drawer Panel`).
///
/// 상단 바에는 워드마크·아바타·햄버거만 두고, 내비게이션과 환경 설정·로그아웃은 드로어로
/// 내린다 — 좁은 폭에서 한 줄에 밀어 넣으면 글자가 세로로 쪼개진다(웹·Android가 같은
/// 이유로 같은 배치를 쓴다).
///
/// **통화 화면도 이 셸 안에 있다**(plan/webrtc.md §4). 몰입형 전체화면을 만들지 않는
/// 이유: 이 슬라이스가 증명하려는 것은 "같은 앱이 네 플랫폼에서 같게 동작한다"이고 셸이
/// 곧 그 앱이다. 통화만 셸을 벗어나면 드로어의 활성 항목이 사라져 지금 어디인지가 화면에서
/// 지워지고, 나가는 길을 컨트롤 바의 종료와 **둘** 설계해야 한다.
///
/// 본문은 스스로 스크롤한다 — 대시보드는 당겨서 새로고침을, 통화는 바닥 고정 바를
/// 갖기 때문에 셸이 스크롤을 쥐면 둘 다 할 수 없다.
struct AppShellView<Content: View>: View {
    @Environment(LocalizationStore.self) private var t

    let page: ShellPage
    let user: User
    let onNavigate: (ShellPage) -> Void
    let onSignOut: () async -> Void
    @ViewBuilder let content: Content

    @State private var isDrawerOpen = false
    @State private var isSigningOut = false

    var body: some View {
        ZStack(alignment: .leading) {
            VStack(spacing: 0) {
                topBar
                content
            }
            .background(AppColor.surface)

            if isDrawerOpen {
                // 스크림 — 탭하면 닫힌다. 드로어보다 먼저(아래에) 놓는다.
                Color.black.opacity(0.45)
                    .ignoresSafeArea()
                    .onTapGesture { isDrawerOpen = false }
                    .accessibilityHidden(true)
                    .transition(.opacity)
                    // ⚠️ **사라지는 동안의 z 순서를 못박는다.** 없으면 ZStack이 나가는
                    // 뷰를 남는 콘텐츠 뒤로 보내는데, 그 콘텐츠는 불투명한 배경을 깔고
                    // 있어 미끄러져 나가는 동안이 통째로 가려진다.
                    .zIndex(1)
                drawer
                    .transition(.move(edge: .leading))
                    .zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.25), value: isDrawerOpen)
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

            // 이름은 **내비 항목에만** 붙인다 — `.contain`이 없으면 SwiftUI가 컨테이너의
            // 레이블을 자식 전부에 덮어씌워 테마·언어·로그아웃까지 "내비게이션"으로 읽힌다.
            VStack(alignment: .leading, spacing: AppDimension.Spacing.lg) {
                navItem(.dashboard)
                navItem(.push)
                navItem(.webrtc)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(t(.dashboardNavigation))

            Spacer()

            Rectangle().fill(AppColor.border).frame(height: 1)
            PreferenceControls(placement: .drawer)
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

    /// 시안 `Atom/NavItem` — 활성은 soft blue 배경.
    private func navItem(_ item: ShellPage) -> some View {
        let isActive = item == page
        return Button {
            // 드로어에서 옮겨 가면 드로어는 닫혀 있어야 한다 — 화면만 바뀌고 패널이
            // 남으면 새 화면이 그 뒤에 가려진다.
            isDrawerOpen = false
            if !isActive { onNavigate(item) }
        } label: {
            HStack(spacing: AppDimension.Spacing.sm) {
                Text(t(item.title))
                    .font(.system(
                        size: AppDimension.FontSize.body,
                        weight: isActive ? .semibold : .regular,
                    ))
                    .foregroundStyle(isActive ? AppColor.heading : AppColor.muted)
                Spacer()
            }
            .padding(.horizontal, AppDimension.Dashboard.navItemPadding)
            .frame(height: AppDimension.Dashboard.navItemHeight)
            .background(
                isActive ? AppColor.secondaryBackground : AppColor.card,
                in: .rect(cornerRadius: AppDimension.Radius.md),
            )
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
    }
}
