//
//  WebAuthController.swift
//  prism
//
//  Path: Features/Auth/WebAuthController.swift
//

import AuthenticationServices
import Foundation
import UIKit

/// 웹 OAuth(redirect) 로그인을 시스템 웹 세션(ASWebAuthenticationSession)으로 진행한다.
///
/// 네이티브 SDK 대신 서버의 웹 흐름(`flow=native`)을 연다: 서버가 provider로 redirect하고,
/// 콜백에서 쿠키/웹 페이지가 아니라 **커스텀 스킴**(`prism://auth/callback?code=…`)으로
/// **일회용 코드**를 돌려준다. 이 코드를 `AuthService.exchangeNativeCode`로 토큰과 교환한다.
///
/// ASWebAuthenticationSession은 시스템이 제어하는 인앱 브라우저라 콜백을 **앱만** 캡처한다
/// (다른 앱이 스킴을 가로챌 수 없다) — Android의 redirect 가로채기 문제가 iOS에는 없다.
@MainActor
final class WebAuthController: NSObject {
    // 서버가 콜백에 쓰는 스킴(PRISM_NATIVE_AUTH_CALLBACK 기본값 prism://auth/callback).
    private static let callbackScheme = "prism"

    // 진행 중인 세션 — 완료 전까지 강한 참조를 쥐어야 시트가 살아 있다.
    private var session: ASWebAuthenticationSession?

    /// 웹 OAuth를 열어 일회용 코드를 받아 온다. 사용자가 닫으면 `CancellationError`.
    func signIn(provider: AuthProvider) async throws -> String {
        let url = APIConfiguration.baseURL
            .appending(path: "/auth/\(provider.rawValue)")
            .appending(queryItems: [URLQueryItem(name: "flow", value: "native")])

        let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: Self.callbackScheme,
            ) { [weak self] callback, error in
                self?.session = nil
                if let error {
                    if let authError = error as? ASWebAuthenticationSessionError,
                       authError.code == .canceledLogin {
                        Log.auth("web sign-in cancelled")
                        continuation.resume(throwing: CancellationError())
                    } else {
                        Log.error("web sign-in failed")
                        continuation.resume(
                            throwing: APIError(status: 0, code: AuthErrorCode.signinFailed),
                        )
                    }
                    return
                }
                guard let callback else {
                    continuation.resume(
                        throwing: APIError(status: 0, code: AuthErrorCode.signinFailed),
                    )
                    return
                }
                continuation.resume(returning: callback)
            }
            session.presentationContextProvider = self
            // 기존 계정 세션(쿠키)을 공유해 매번 재로그인하지 않게 한다.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                continuation.resume(
                    throwing: APIError(status: 0, code: AuthErrorCode.signinFailed),
                )
            }
        }
        return try Self.code(from: callbackURL)
    }

    /// 콜백 URL(`…?code=…` | `…?error=…`)에서 코드를 뽑는다.
    /// code가 있으면 성공, error면 실패, 둘 다 없으면 취소로 본다.
    private static func code(from url: URL) throws -> String {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty {
            return code
        }
        if items.contains(where: { $0.name == "error" }) {
            throw APIError(status: 0, code: AuthErrorCode.signinFailed)
        }
        throw CancellationError()
    }
}

extension WebAuthController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(
        for session: ASWebAuthenticationSession,
    ) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        // 씬과 연결되지 않은 `UIWindow` init(`init()`·`init(frame:)`)은 iOS 26에서 모두
        // deprecated라, 유효한 앵커를 만들 유일한 길은 `init(windowScene:)`뿐이다.
        // ASWebAuthenticationSession은 표시할 window scene이 있을 때만 이 anchor를 물으므로
        // active는 언제나 존재한다 — 없으면 애초에 띄울 화면이 없는 불변식 위반이다.
        guard let active else {
            preconditionFailure("web auth presentation anchor requested with no window scene")
        }
        // 이미 뜬 창이 있으면 그것을, 없으면 활성 씬으로 만든 창을 앵커로 쓴다.
        return active.keyWindow ?? active.windows.first ?? UIWindow(windowScene: active)
    }
}
