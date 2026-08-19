//
//  KakaoSignInController.swift
//  prism
//
//  Path: Features/Auth/KakaoSignInController.swift
//

import KakaoSDKAuth
import KakaoSDKCommon
import KakaoSDKUser

/// Kakao 네이티브 로그인(Kakao iOS SDK)을 async/await 한 번의 호출로 감싼다.
///
/// 카카오톡 앱 로그인을 먼저 시도하고, 불가/실패 시 카카오계정 웹 로그인으로 폴백한다
/// (Kakao 표준 패턴). 결과 `OAuthToken.accessToken`을 서버에 보낸다. SDK는 앱 시작 시
/// `KakaoSDK.initSDK(appKey:)`로 초기화돼 있어야 한다(prismApp).
///
/// access token은 서명 없는 불투명 문자열이라, 서버가 `access_token_info`로 발급 앱(app_id)을
/// 대조해 검증한다(plan/auth.md §5).
@MainActor
final class KakaoSignInController {
    func accessToken() async throws -> String {
        guard SocialSDK.kakaoAppKey != nil else {
            // 키가 없어 initSDK를 건너뛴 빌드 — SDK를 호출하면 초기화 누락으로 죽는다.
            Log.error("KAKAO_NATIVE_APP_KEY not set — Kakao login disabled")
            throw APIError(status: 0, code: AuthErrorCode.signinFailed)
        }
        let token: OAuthToken
        if UserApi.isKakaoTalkLoginAvailable() {
            do {
                token = try await loginWithKakaoTalk()
            } catch {
                if Self.isCancel(error) {
                    Log.auth("kakao login cancelled")
                    throw CancellationError()
                }
                // 취소가 아닌 실패(앱은 있으나 로그인 불가 등)는 계정 로그인으로 폴백한다.
                Log.auth("kakaotalk login failed — falling back to account")
                token = try await loginWithKakaoAccount()
            }
        } else {
            token = try await loginWithKakaoAccount()
        }
        Log.auth("kakao sign-in completed")
        return token.accessToken
    }

    // MARK: - Private (완료 핸들러 API를 컨티뉴에이션으로 감싼다)

    private func loginWithKakaoTalk() async throws -> OAuthToken {
        try await withCheckedThrowingContinuation { continuation in
            UserApi.shared.loginWithKakaoTalk { token, error in
                Self.resume(continuation, token, error)
            }
        }
    }

    private func loginWithKakaoAccount() async throws -> OAuthToken {
        try await withCheckedThrowingContinuation { continuation in
            UserApi.shared.loginWithKakaoAccount { token, error in
                Self.resume(continuation, token, error)
            }
        }
    }

    /// 콜백을 컨티뉴에이션으로 옮긴다. 취소는 위(accessToken)에서 폴백/조용한 취소로 다룬다.
    private static func resume(
        _ continuation: CheckedContinuation<OAuthToken, Error>,
        _ token: OAuthToken?,
        _ error: Error?,
    ) {
        if let error {
            continuation.resume(throwing: error)
        } else if let token {
            continuation.resume(returning: token)
        } else {
            continuation.resume(throwing: APIError.invalidResponse)
        }
    }

    /// 사용자가 로그인을 취소했는가(Kakao SDK의 클라이언트 취소 오류).
    private static func isCancel(_ error: Error) -> Bool {
        if case let .ClientFailed(reason, _)? = error as? SdkError, reason == .Cancelled {
            return true
        }
        return false
    }
}
