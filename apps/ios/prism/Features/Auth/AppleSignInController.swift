//
//  AppleSignInController.swift
//  prism
//
//  Path: Features/Auth/AppleSignInController.swift
//

import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Sign in with Apple(네이티브)의 델리게이트 기반 API를 async/await 한 번의 호출로 감싼다.
///
/// 여기서 nonce를 만들고 **해시를 요청에 싣는다**: Apple은 요청에 준 문자열을 그대로
/// id_token의 `nonce` 클레임에 넣어 돌려주므로, 서버는 앱이 보낸 원본을 해시해 그 값과
/// 대조할 수 있다. 원본을 요청에 실으면 토큰만 가로챈 쪽도 같은 값을 재사용할 수 있어
/// 대조가 무의미해진다 — 그래서 요청에는 해시, 서버에는 원본을 보낸다.
@MainActor
final class AppleSignInController {
    struct Credential {
        let identityToken: String
        /// 서버에 그대로 보낼 **원본** nonce.
        let nonce: String
        /// Apple이 최초 로그인에만 주는 이름. 이후 로그인에는 없다.
        let name: AppleUserName?
    }

    func signIn() async throws -> Credential {
        guard let anchor = Self.activeWindow() else {
            // 화면이 떠 있어야 버튼을 누를 수 있으니 실제로는 오지 않는 경로다.
            Log.error("no active window for Apple sign-in")
            throw APIError(status: 0, code: AuthErrorCode.signinFailed)
        }
        let nonce = try Self.makeNonce()

        let request = ASAuthorizationAppleIDProvider().createRequest()
        // 이메일은 요청하지 않는다 — 저장하지 않을 개인정보를 굳이 받아 오지 않는다
        // (plan/auth.md §7 개인정보 미저장). 이름은 세션 표시 이름으로만 쓴다.
        request.requestedScopes = [.fullName]
        request.nonce = Self.sha256Hex(nonce)

        // 시도마다 새 델리게이트를 쓴다 — 앵커·nonce·컨티뉴에이션이 한 흐름에 묶여 있어,
        // 재사용하면 그것들을 매번 되돌리는 코드가 필요하고 되돌리기를 빠뜨린 경로가
        // 다음 시도를 조용히 오염시킨다.
        return try await Attempt(anchor: anchor, nonce: nonce).run(request)
    }

    // MARK: - Private

    /// 지금 화면에 보이는 창. 시트를 여기에 띄운다.
    private static func activeWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        return active?.keyWindow ?? active?.windows.first
    }

    /// 요청 한 번을 유일하게 만드는 임의값. 128비트면 충돌을 걱정할 필요가 없다.
    private static func makeNonce() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            // 시스템 난수를 못 얻는 상태에서 예측 가능한 값으로 대체하면 nonce가
            // 방어하려던 재생 공격이 그대로 열린다. 그럴 바엔 로그인을 시작하지 않는다.
            Log.error("secure random unavailable — aborting Apple sign-in")
            throw APIError(status: 0, code: AuthErrorCode.signinFailed)
        }
        return Data(bytes).base64EncodedString()
    }

    /// 서버가 대조하는 형식은 SHA-256 **hex**다(apple-oauth.client.ts).
    private static func sha256Hex(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Attempt

/// 로그인 시도 하나. 델리게이트 콜백을 컨티뉴에이션 하나로 이어 준다.
@MainActor
private final class Attempt: NSObject {
    private let anchor: ASPresentationAnchor
    private let nonce: String

    private var continuation: CheckedContinuation<AppleSignInController.Credential, Error>?
    /// ASAuthorizationController는 델리게이트를 약하게 쥐므로 흐름이 끝날 때까지
    /// 서로를 붙잡아 둔다(여기서 놓으면 콜백이 오지 않아 컨티뉴에이션이 영원히 남는다).
    private var controller: ASAuthorizationController?

    init(anchor: ASPresentationAnchor, nonce: String) {
        self.anchor = anchor
        self.nonce = nonce
    }

    func run(
        _ request: ASAuthorizationAppleIDRequest,
    ) async throws -> AppleSignInController.Credential {
        // 이미 취소됐다면 시트를 띄우지 않는다(뷰가 사라진 뒤 뒤늦게 도착한 시작).
        try Task.checkCancellation()

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller

        // 취소(뷰 이탈 등)가 오면 델리게이트 콜백을 기다리지 않고 continuation을 즉시
        // 완료한다 — 그러지 않으면 Apple이 콜백을 줄 때까지 Task와 캡처된 뷰모델이 살아
        // 남는다. onCancel은 임의 스레드에서 불릴 수 있어 MainActor로 넘긴다.
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                controller.performRequests()
            }
        } onCancel: {
            Task { @MainActor in self.cancelPending() }
        }
    }

    /// 취소 시 대기 중인 continuation을 CancellationError로 완료한다. 이미 끝났으면 no-op.
    private func cancelPending() {
        guard continuation != nil else { return }
        Log.auth("apple sign-in cancelled (task)")
        finish(with: .failure(CancellationError()))
    }

    /// 결과를 정확히 한 번만 전달한다. 델리게이트 콜백과 취소가 겹쳐도 continuation은
    /// nil 가드로 한 번만 resume된다(두 번 resume은 크래시).
    private func finish(with result: Result<AppleSignInController.Credential, Error>) {
        let pending = continuation
        continuation = nil
        controller = nil
        pending?.resume(with: result)
    }
}

extension Attempt: ASAuthorizationControllerDelegate {
    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization,
    ) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8)
        else {
            Log.error("apple sign-in returned an unusable credential")
            finish(with: .failure(APIError(status: 0, code: AuthErrorCode.signinFailed)))
            return
        }

        let name = credential.fullName.flatMap { components -> AppleUserName? in
            guard components.givenName != nil || components.familyName != nil else { return nil }
            return AppleUserName(
                firstName: components.givenName,
                lastName: components.familyName,
            )
        }

        Log.auth("apple sign-in completed")
        finish(with: .success(
            .init(identityToken: identityToken, nonce: nonce, name: name),
        ))
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error,
    ) {
        // 사용자가 시트를 닫은 것(.canceled)만 무음 취소로 본다 — 조용히 원래 화면으로
        // 돌아간다(웹의 OAuth 취소 처리와 같은 규칙: plan/auth.md §2.2). `.unknown`을 포함하면
        // 진짜 인증 실패(자격증명 없음·시트 오류)까지 안내 없이 사라지므로 제외한다.
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            Log.auth("apple sign-in cancelled")
            finish(with: .failure(CancellationError()))
            return
        }
        Log.error("apple sign-in failed")
        finish(with: .failure(APIError(status: 0, code: AuthErrorCode.signinFailed)))
    }
}

extension Attempt: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        anchor
    }
}
