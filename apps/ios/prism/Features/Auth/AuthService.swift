//
//  AuthService.swift
//  prism
//
//  Path: Features/Auth/AuthService.swift
//

import Foundation

/// 인증 API의 계약. `AuthManager`는 구체 타입이 아니라 이 프로토콜에 의존해, 테스트에서
/// 네트워크 없이 가짜 응답을 주입할 수 있다(동시성·자격증명 로직을 결정적으로 검증).
protocol AuthServicing: Sendable {
    // ⚠️ 네 경로 모두 `pushToken`을 받는다. **등록 토큰은 로그인 시점에만 세션에
    // 실린다**(plan/push.md §5-2) — 살아 있는 세션 레코드를 고치는 경로를 두지 않기로
    // 했기 때문이다. nil이면 그 세션은 재로그인 전까지 `Notifications off`다.
    func loginWithApple(
        identityToken: String,
        nonce: String,
        name: AppleUserName?,
        pushToken: String?,
    ) async throws -> AuthSession
    func loginWithGoogle(idToken: String, pushToken: String?) async throws -> AuthSession
    func loginWithKakao(accessToken: String, pushToken: String?) async throws -> AuthSession
    func loginDemo(pushToken: String?) async throws -> AuthSession
    func exchangeNativeCode(_ code: String) async throws -> AuthSession
    func me(accessToken: String) async throws -> SessionUser
    /// - Parameter activity: 이 회전을 **사용자가 시켰는가**. 앱 복원이 그렇다 —
    ///   `/auth/me`가 만료로 실패하면 회전으로 끝나고 다시 보호된 요청을 보내지 않아,
    ///   여기서 알리지 않으면 앱을 다시 연 것이 활동으로 계산되지 않는다.
    func refresh(refreshToken: String, activity: Bool) async throws -> AuthSession
    func logout(accessToken: String?) async throws
}

// 소셜 네이티브 로그인의 기본 구현 — 서버 경로가 없다고 가정하는 자리(주로 테스트 목).
// 실제 `AuthService`는 아래에서 재정의한다. 이렇게 두면 기존 목이 새 메서드를 강제로
// 구현하지 않아도 컴파일된다(계약 확장이 테스트를 깨지 않는다).
extension AuthServicing {
    func loginWithGoogle(idToken: String, pushToken: String?) async throws -> AuthSession {
        throw APIError.providerUnavailable
    }

    func loginWithKakao(accessToken: String, pushToken: String?) async throws -> AuthSession {
        throw APIError.providerUnavailable
    }

    func loginDemo(pushToken: String?) async throws -> AuthSession {
        throw APIError.providerUnavailable
    }

    func exchangeNativeCode(_ code: String) async throws -> AuthSession {
        throw APIError.providerUnavailable
    }
}

/// 인증 API 호출. 서버 계약을 그대로 옮긴 얇은 층이고, 상태는 갖지 않는다
/// (상태는 `AuthManager`가, 화면 사정은 ViewModel이 안다).
final class AuthService: AuthServicing, Sendable {
    private let network: NetworkManager

    init(network: NetworkManager) {
        self.network = network
    }

    /// iOS 네이티브 Sign in with Apple.
    ///
    /// `nonce`는 SDK 요청에 쓴 **원본** 값을 보낸다 — 서버가 SHA-256 해시를 다시 계산해
    /// id_token의 nonce 클레임과 대조하기 때문이다. 요청에는 해시를 실었고 여기에는
    /// 원본을 싣는다는 이 비대칭이 재생 공격을 막는 지점이다.
    func loginWithApple(
        identityToken: String,
        nonce: String,
        name: AppleUserName?,
        pushToken: String?,
    ) async throws -> AuthSession {
        try await network.send(
            .appleNative,
            body: AppleNativeRequest(
                identityToken: identityToken,
                nonce: nonce,
                // 이름은 Apple이 최초 로그인에만 준다. 서버도 저장하지 않고 세션 표시
                // 이름으로만 쓴다(plan/auth.md §5) — 없으면 필드를 아예 빼고 보낸다.
                user: name.map(AppleNativeRequest.UserField.init(name:)),
                pushToken: pushToken,
            ),
        )
    }

    /// Google 네이티브(GoogleSignIn SDK)가 준 id_token을 서버가 검증한다.
    /// id_token의 audience(iOS 클라이언트 ID)가 서버의 허용 audience에 있어야 통과한다
    /// (PRISM_GOOGLE_NATIVE_AUDIENCES).
    func loginWithGoogle(idToken: String, pushToken: String?) async throws -> AuthSession {
        try await network.send(
            .googleNative,
            body: GoogleNativeRequest(idToken: idToken, pushToken: pushToken)
        )
    }

    /// Kakao 네이티브(Kakao SDK)가 준 access token으로 서버가 세션을 발급한다.
    /// access token은 불투명 문자열이라 서버가 access_token_info로 발급 앱(app_id)을 대조한다.
    func loginWithKakao(accessToken: String, pushToken: String?) async throws -> AuthSession {
        try await network.send(
            .kakaoNative,
            body: KakaoNativeRequest(accessToken: accessToken, pushToken: pushToken)
        )
    }

    /// 네이티브 데모 로그인. 웹 `/auth/demo`(쿠키)와 세션은 같고, 전달만 다르다 —
    /// 토큰을 body(`AuthSession`)로 받아 Keychain에 담는다(쿠키를 쓰지 않는다). body가 없다.
    func loginDemo(pushToken: String?) async throws -> AuthSession {
        try await network.send(.demoNative, body: DemoNativeRequest(pushToken: pushToken))
    }

    /// 네이티브 웹-redirect(ASWebAuthenticationSession) 콜백의 일회용 코드를 토큰으로 교환.
    /// 서버가 쿠키/웹 페이지 대신 커스텀 스킴으로 돌려준 코드를 세션으로 바꾼다.
    func exchangeNativeCode(_ code: String) async throws -> AuthSession {
        try await network.send(.nativeExchange, body: NativeExchangeRequest(code: code))
    }

    /// 세션 확인 + 사용자 정보.
    func me(accessToken: String) async throws -> SessionUser {
        try await network.send(.me, accessToken: accessToken)
    }

    /// 액세스 토큰 갱신. 자격증명은 1회용이라 성공하면 새 값으로 회전된다 —
    /// 응답으로 받은 두 토큰을 반드시 저장해야 다음 갱신이 성립한다.
    func refresh(refreshToken: String, activity: Bool) async throws -> AuthSession {
        try await network.send(
            .refresh,
            body: RefreshRequest(refreshToken: refreshToken),
            // 표시는 `background`의 반대다 — 활동이면 붙는다.
            background: !activity,
        )
    }

    /// 서버 세션 폐기. 토큰이 이미 죽었어도 서버는 멱등하게 받아 준다.
    func logout(accessToken: String?) async throws {
        try await network.sendIgnoringResponse(.logout, accessToken: accessToken)
    }
}

/// Apple이 최초 로그인에만 주는 이름 조각(서버의 `AppleUserName`과 같은 형태).
struct AppleUserName: Codable, Equatable, Sendable {
    let firstName: String?
    let lastName: String?
}

// MARK: - Requests

private struct AppleNativeRequest: Encodable {
    struct UserField: Encodable {
        let name: AppleUserName
    }

    let identityToken: String
    let nonce: String
    let user: UserField?
    /// 등록 토큰. **nil이면 키가 아예 나가지 않는다** — 없는 필드와 빈 문자열은 서버에서
    /// 같은 뜻이지만(둘 다 등록 없음), 없는 쪽이 의도가 분명하다(`Encodable` 기본 동작).
    let pushToken: String?
}

private struct GoogleNativeRequest: Encodable {
    let idToken: String
    let pushToken: String?
}

private struct KakaoNativeRequest: Encodable {
    let accessToken: String
    let pushToken: String?
}

/// 데모 로그인은 원래 body가 없었다 — 등록 토큰이 실릴 자리를 만들려고 생겼다.
private struct DemoNativeRequest: Encodable {
    let pushToken: String?
}

private struct NativeExchangeRequest: Encodable {
    let code: String
}

private struct RefreshRequest: Encodable {
    let refreshToken: String
}
