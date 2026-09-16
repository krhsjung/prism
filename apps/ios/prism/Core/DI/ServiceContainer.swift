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
    /// 내 활성 세션 **목록 하나**. 대시보드·통화·푸시가 같은 것을 본다.
    ///
    /// **화면이 아니라 앱에 매단다** — 화면마다 따로 들고 있으면 화면마다 신선도가
    /// 달라진다(소켓 신호를 듣는 화면과 듣지 않는 화면이 갈렸던 것이 그 결과다).
    /// 세션이 끝나면 `RootView`가 `reset()`으로 비운다 — 소켓·통화와 같은 자리다.
    let sessions: SessionStore
    /// 푸시 등록·전송(`/auth/push/register` · `/auth/push/send`). 토큰은 서버가 레코드에서 꺼낸다.
    let pushService: PushService
    /// 이 기기의 FCM 등록 토큰과 알림 권한. 붙이는 일은 아래 `pushRegistration`이 한다.
    let pushTokens: PushTokens
    /// 이 기기의 알림 등록 **하나**. 되살리기·권한이 사라졌을 때의 해제·토큰 회전이 한
    /// 자리에서 맞춰진다 — 화면과 `RootView`에 한 벌씩 있으면 둘이 겹쳐 돈다.
    /// 세션이 끝나면 `RootView`가 `reset()`으로 비운다(목록·소켓·통화와 같은 자리).
    let pushRegistration: PushRegistration
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
        pushService = PushService(network: network)
        pushTokens = PushTokens()
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
            // 세션이 끝나면 이 설치의 토큰도 버린다 — 서버에 남았을지 모르는 세션이 이
            // 기기를 계속 가리키지 못하게(PushTokens.deleteToken).
            onSessionEnded: { [pushTokens] in pushTokens.deleteToken() },
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

        // 목록은 Keychain의 Bearer로 묻는다 — 사본을 들지 않고 그때그때 읽는다.
        //
        // **소켓보다 뒤에 세운다.** 목록을 쥔 쪽이 "바뀌었다"를 다른 기기에 전하는 일도
        // 맡으므로(SessionStore.notifyChanged) 그 통로가 먼저 있어야 한다.
        sessions = SessionStore(
            service: sessionsService,
            accessToken: { [keychain] in keychain.load().credentials?.accessToken },
            notify: { [sessionSocket] in sessionSocket.send(.sessionsStale) },
        )
        // 등록은 목록 **뒤에** 선다 — 붙이고 나면 목록을 다시 받아야 하는데 그 목록은 위 store가 쥔다.
        pushRegistration = PushRegistration(
            device: pushTokens,
            service: pushService,
            accessToken: { [keychain] in keychain.load().credentials?.accessToken },
            store: sessions,
        )

        // 소켓의 통화 수신구를 **컨트롤러가 가져간다** — 소켓은 메시지를 상태로 쌓지
        // 않고 그대로 넘기므로(SessionSocket.onCallMessage), 듣는 쪽이 하나여야 한다.
        // 번역기를 **먼저** 세운다 — 컨트롤러가 장치 이름을 만들 때 이것을 든다.
        localization = LocalizationStore()
        // 값이 아니라 **읽는 법**을 준다 — 언어 스위처로 고르면 다음 요청부터 반영돼야
        // 한다. `LocalizationStore.locale`은 MainActor의 것이라 Sendable 클로저에서 읽을
        // 수 없으므로, 같은 원천(UserDefaults)을 보는 격리 없는 헬퍼를 쓴다.
        network.languageTag = { LocalizationStore.current().rawValue }
        call = CallController(socket: sessionSocket, localization: localization)

        theme = ThemeStore()
    }
}
