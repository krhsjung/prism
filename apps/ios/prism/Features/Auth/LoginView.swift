//
//  LoginView.swift
//  prism
//
//  Path: Features/Auth/LoginView.swift
//

import SwiftUI

/// 로그인 화면.
///
/// 구성은 웹 로그인 화면(apps/web/src/pages/LoginPage.tsx)과 같다: 워드마크 · 카드
/// (제목 · 부제 · 오류 · 버튼 셋 · 안내 문구) · 환경 설정 줄.
/// **가입 화면이 없다** — Google/Apple은 첫 로그인에 자동 가입되고 데모는 시드 계정을
/// 쓰므로, "Don't have an account?" 푸터를 두지 않는다(plan/auth.md §3).
struct LoginView: View {
    @Environment(LocalizationStore.self) private var t
    @State private var viewModel: LoginViewModel

    /// 스크롤 뷰포트(사용 가능한 전체 높이). `GeometryReader`의 라이브 값을 `minHeight`로
    /// 곧바로 되먹이면 콘텐츠 높이 변화와 측정이 같은 레이아웃 패스에서 얽혀 재레이아웃이
    /// 떨릴 수 있다. 컨테이너 높이만 여기 한 번 담아 그 값으로 최소 높이를 주면, 내용이
    /// 바뀌어도 측정은 흔들리지 않는다(뷰포트가 실제로 바뀔 때만 갱신된다).
    @State private var viewportHeight: CGFloat = 0

    init(authManager: AuthManager) {
        _viewModel = State(initialValue: LoginViewModel(authManager: authManager))
    }

    var body: some View {
        // 내용이 짧으면 세로 가운데에 두고(웹의 `justify-content: center`), 큰 글씨
        // 설정이나 작은 화면에서 넘치면 스크롤된다. 뷰포트 높이를 최소 높이로 주는 것이
        // 두 동작을 한 번에 얻는 방법이다 — ScrollView만 쓰면 항상 위로 붙고,
        // 고정 높이를 주면 넘치는 내용이 잘린다. minHeight의 기본 정렬은 .center라
        // 짧은 내용이 세로 가운데로 모인다.
        ScrollView {
            VStack(spacing: AppDimension.Screen.sectionSpacing) {
                // 워드마크는 번역하지 않는다 — 로고 텍스트는 언어와 무관한 고유명사다.
                Text(verbatim: "Prism")
                    .font(.system(size: AppDimension.FontSize.title, weight: .heavy))
                    .foregroundStyle(AppColor.heading)

                signInCard
                    // 로그인 상태 변화(버튼 "Connecting…" 토글·오류 알림 삽입)는
                    // 애니메이션 없이 즉시 반영한다. 데모처럼 즉시 실패하는 경로에서
                    // 버튼이 깜박이거나 카드가 움직이는 잔떨림을 없앤다.
                    .animation(nil, value: viewModel.pending)
                    .animation(nil, value: viewModel.errorKey)

                HStack(spacing: AppDimension.Spacing.sm) {
                    ThemeSwitcher()
                    LocaleSwitcher()
                }
            }
            .padding(.horizontal, AppDimension.Screen.horizontalPadding)
            .padding(.vertical, AppDimension.Screen.sectionSpacing)
            // 카드는 자기 최대 폭을 갖고, 남는 자리에서는 가운데로 모인다.
            .frame(maxWidth: .infinity, minHeight: viewportHeight)
        }
        .scrollBounceBehavior(.basedOnSize)
        // 뷰포트(=ScrollView 자신의 프레임)만 측정해 담는다. 콘텐츠가 아니라 컨테이너
        // 크기라 내용이 바뀌어도 값이 흔들리지 않는다 — 위 되먹임 고리를 끊는 지점이다.
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewportHeight = $0 }
        .background(AppColor.surface)
        .onDisappear { viewModel.cancel() }
    }

    private var signInCard: some View {
        PrismCard {
            VStack(alignment: .leading, spacing: AppDimension.Spacing.xs) {
                Text(t(.authWelcomeBack))
                    .font(.system(size: AppDimension.FontSize.title, weight: .heavy))
                    .foregroundStyle(AppColor.heading)
                Text(t(.authSignInToContinue))
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.muted)
            }

            if let errorKey = viewModel.errorKey {
                PrismErrorAlert(message: t(errorKey))
            }

            VStack(spacing: AppDimension.Button.spacing) {
                // 각 provider를 native(SDK)·redirect(웹) 두 방식으로 나눠 보여 준다.
                signInButton(.google, .native, variant: .outline)
                signInButton(.google, .redirect, variant: .outline)
                signInButton(.apple, .native, variant: .primary)
                signInButton(.apple, .redirect, variant: .primary)
                signInButton(.kakao, .native, variant: .kakao)
                signInButton(.kakao, .redirect, variant: .kakao)
                // 데모는 부차 액션이라 한 단계 낮은 위계로 둔다(웹과 같은 variant).
                signInButton(.demo, .native, variant: .secondary)
            }

            Text(t(.authNoPersonalData))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.muted)
        }
    }

    private func signInButton(
        _ provider: AuthProvider,
        _ method: AuthMethod,
        variant: PrismButton.Variant,
    ) -> some View {
        let option = AuthOption(provider: provider, method: method)
        return PrismButton(
            title: label(for: option),
            variant: variant,
            // 하나가 진행 중이면 전부 잠근다 — 두 흐름이 겹치면 나중 것이 앞선 세션을
            // 덮어써 어느 쪽으로 로그인됐는지 알 수 없게 된다.
            isEnabled: !viewModel.isBusy,
        ) {
            viewModel.signIn(option)
        }
    }

    // 버튼 문구 = provider 라벨 + 방식 태그. 진행 중(Connecting…)이나 데모에는 태그를 안 붙인다.
    private func label(for option: AuthOption) -> String {
        let base = t(viewModel.title(for: option))
        guard viewModel.pending != option, option.provider != .demo else {
            return base
        }
        return "\(base) (\(option.method.rawValue))"
    }
}

#Preview {
    LoginView(authManager: ServiceContainer.shared.authManager)
        .environment(ServiceContainer.shared.localization)
        .environment(ServiceContainer.shared.theme)
}
