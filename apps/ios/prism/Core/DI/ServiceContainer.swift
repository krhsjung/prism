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
    /// 세션 소켓. 목록을 나르지 않고 "바뀌었다"는 신호만 준다 — 목록은 늘 위 서비스가
    /// 가져온다(그래야 재조회가 스탬핑·공유 회전이 붙은 HTTP 경로를 탄다).
    let sessionSocket: SessionSocket
    /// 통화 하나를 붙들고 있는 자리.
    ///
    /// **화면이 아니라 앱에 매단다** — 걸려 온 통화는 통화 화면이 아니라 앱 위에 떠야
    /// 하고(plan/webrtc.md §4), 대시보드를 보고 있어도 울려야 한다. 소켓을 여기 둔 것과
    /// 같은 이유이며, 실제로 이것은 그 소켓 위에 얹힌다.
    let call: CallController

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

        // 소켓도 만료를 만나면 **같은** 회전(refreshForRetry)을 탄다 — 리프레시
        // 자격증명은 1회용이라, 자기 회전을 따로 시작하면 두 번 소비되어 세션이 죽는다.
        sessionSocket = SessionSocket(
            accessToken: { [keychain] in keychain.load().credentials?.accessToken },
            authority: authManager,
        )

        // 소켓의 통화 수신구를 **컨트롤러가 가져간다** — 소켓은 메시지를 상태로 쌓지
        // 않고 그대로 넘기므로(SessionSocket.onCallMessage), 듣는 쪽이 하나여야 한다.
        // 번역기를 **먼저** 세운다 — 컨트롤러가 장치 이름을 만들 때 이것을 든다.
        localization = LocalizationStore()
        call = CallController(socket: sessionSocket, localization: localization)

        theme = ThemeStore()
    }
}
