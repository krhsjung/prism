//
//  GoogleSignInController.swift
//  prism
//
//  Path: Features/Auth/GoogleSignInController.swift
//

import GoogleSignIn
import UIKit

/// Google 네이티브 로그인(GoogleSignIn SDK)을 async/await 한 번의 호출로 감싼다.
///
/// 웹 redirect가 아니라 앱 안에서 완결되는 시스템 흐름으로 계정을 고르고 **id_token**을
/// 받아 서버에 보낸다. 클라이언트 ID는 Info.plist의 `GIDClientID`(iOS 클라이언트 ID)에서
/// 읽으며(GoogleSignIn 기본 동작), 그 값이 없으면 SDK가 로그인을 시작하지 못한다.
///
/// - Important: id_token의 audience는 iOS 클라이언트 ID다 — 서버가 이 값을 허용 audience에
///   포함해야 검증을 통과한다(`PRISM_GOOGLE_NATIVE_AUDIENCES`에 iOS 클라이언트 ID 추가).
@MainActor
final class GoogleSignInController {
    func idToken() async throws -> String {
        guard SocialSDK.googleClientID != nil else {
            // 미설정 빌드(Secrets.xcconfig 없음). 여기서 막지 않으면 SDK가 ObjC 예외
            // "You must specify |clientID| in |GIDConfiguration|"로 앱을 종료시킨다.
            Log.error("GIDClientID not set — Google login disabled")
            throw APIError(status: 0, code: AuthErrorCode.signinFailed)
        }
        guard let presenter = Self.topViewController() else {
            Log.error("no view controller to present Google sign-in")
            throw APIError(status: 0, code: AuthErrorCode.signinFailed)
        }

        let result: GIDSignInResult
        do {
            result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
        } catch let error as GIDSignInError where error.code == .canceled {
            // 사용자가 시트를 닫았다 — 조용한 취소(Apple 흐름과 같은 규칙).
            Log.auth("google sign-in cancelled")
            throw CancellationError()
        } catch {
            Log.error("google sign-in failed")
            throw APIError(status: 0, code: AuthErrorCode.signinFailed)
        }

        guard let idToken = result.user.idToken?.tokenString else {
            Log.error("google sign-in returned no id_token")
            throw APIError(status: 0, code: AuthErrorCode.signinFailed)
        }
        Log.auth("google sign-in completed")
        return idToken
    }

    /// 지금 화면에 보이는 최상단 뷰컨트롤러. GoogleSignIn 시트를 여기에 띄운다.
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = active?.keyWindow ?? active?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
