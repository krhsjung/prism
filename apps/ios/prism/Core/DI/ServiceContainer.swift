//
//  ServiceContainer.swift
//  prism
//
//  Path: Core/DI/ServiceContainer.swift
//

import Foundation

/// 앱의 의존성을 한 번만 만들고 이어 주는 곳.
///
/// 각 타입이 `.shared`를 하나씩 들고 있으면 생성 순서가 코드 전체에 흩어지고,
/// 테스트에서 갈아 끼울 자리가 없어진다. 조립은 여기 한 곳에서만 한다.
///
/// ```text
/// KeychainManager ─┐
/// NetworkManager ──┴→ AuthService ─┬→ AuthManager
///     AppleSignInController ────────┤
///     Google/Kakao SignInController ┘ (SocialSignInController)
/// ```
@MainActor
final class ServiceContainer {
    static let shared = ServiceContainer()

    let keychain: KeychainManager
    let network: NetworkManager
    let authService: AuthService
    let authManager: AuthManager
    /// 활성 세션 조회·폐기(`/auth/sessions*`). 인증은 Keychain의 Bearer로 한다.
    let sessionsService: SessionsService

    let localization: LocalizationStore
    let theme: ThemeStore

    private init() {
        keychain = KeychainManager()
        network = NetworkManager()
        authService = AuthService(network: network)
        sessionsService = SessionsService(network: network)
        // 네이티브 소셜 로그인(Google/Kakao) 토큰 획득. 키 미설정 시 각 SDK가 실패로
        // 막으므로(데모·Apple은 그대로), 키 없는 빌드도 부팅에는 문제가 없다.
        let social = SocialSignInController(
            google: GoogleSignInController(),
            kakao: KakaoSignInController(),
        )
        authManager = AuthManager(
            service: authService,
            keychain: keychain,
            appleSignIn: AppleSignInController(),
            social: social,
        )

        // 401의 뒷일을 맡을 고리를 **만든 뒤에** 꽂는다 — 생성 시점에 이으면
        // NetworkManager → AuthService → AuthManager → NetworkManager로 도는 순환이 된다.
        network.use(authority: authManager)

        localization = LocalizationStore()
        theme = ThemeStore()
    }
}
