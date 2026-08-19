//
//  APIError.swift
//  prism
//
//  Path: Core/Networking/APIError.swift
//

import Foundation

/// API 호출 실패. 코드는 계약의 오류 코드 문자열이며, 화면은 이 코드를 문구로 옮긴다.
///
/// 웹의 `ApiError`(apps/web/src/lib/api.ts)와 같은 모양이다 — 오류를 문구가 아니라
/// **코드**로 들고 다니는 이유도 같다: 화면 언어가 바뀌면 이미 떠 있는 오류도 함께
/// 바뀌어야 하는데, 문구를 담아 두면 그 오류만 이전 언어로 남는다.
struct APIError: Error, Equatable, Sendable {
    /// HTTP 상태 코드. 요청이 나가지도 못했으면 0.
    let status: Int
    /// `AuthErrorCode` 또는 `ClientErrorCode`의 값.
    let code: String

    static let network = APIError(status: 0, code: ClientErrorCode.networkError)
    static let invalidResponse = APIError(status: 0, code: ClientErrorCode.invalidResponse)

    /// 서버에 이 흐름의 네이티브 엔드포인트가 아직 없다.
    static let providerUnavailable = APIError(
        status: 0,
        code: AppErrorCode.providerUnavailable,
    )

    /// 갱신하면 살아나는 401인가 — 이 판단은 서버만 내릴 수 있어 코드로 받아 본다.
    var isSessionExpired: Bool {
        status == 401 && code == AuthErrorCode.sessionExpired
    }

    /// 서버가 "이 자격증명은 못 쓴다"고 **확정한** 실패인가.
    ///
    /// 세션 복원·갱신이 실패했을 때 저장된 자격증명을 지워야 하는지 가르는 기준이다.
    /// 여기 해당할 때만 지운다 — 서명이 깨졌거나(INVALID_TOKEN) 세션이 이미 폐기된
    /// (UNAUTHORIZED, 재사용 탐지 포함) 경우다. 오프라인·타임아웃·5xx 같은 일시적 실패는
    /// 여기 들지 않으므로 자격증명을 보존하고 다음 시도에서 복구한다.
    var isDefinitiveAuthFailure: Bool {
        status == 401
            && (code == AuthErrorCode.invalidToken || code == AuthErrorCode.unauthorized)
    }
}

extension APIError {
    /// 오류를 화면에 그릴 문구 키로 옮긴다.
    /// 모르는 코드는 일반 메시지로 떨어뜨린다 — 서버가 새 코드를 내보내도 화면은 깨지지
    /// 않고, 문구가 필요해지면 그때 여기에 한 줄을 더한다(웹 LoginPage의 ERROR_KEYS와 동형).
    var messageKey: MessageKey {
        switch code {
        case AuthErrorCode.signinFailed: .errorSigninFailed
        case AuthErrorCode.demoDisabled: .errorDemoDisabled
        case ClientErrorCode.networkError: .errorNetworkError
        case AppErrorCode.providerUnavailable: .errorProviderUnavailable
        default: .errorGeneric
        }
    }
}
