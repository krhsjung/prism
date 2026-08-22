// GENERATED FILE — DO NOT EDIT.
// 원본: apps/server/libs/common/src/types/contracts.ts
// 재생성: apps/server에서 `pnpm gen:contracts`

/// 서버가 오류 응답 body(`{ "error": "..." }`)로 주는 코드.
enum AuthErrorCode {
    static let signinFailed = "SIGNIN_FAILED"
    static let demoDisabled = "DEMO_DISABLED"
    static let unauthorized = "UNAUTHORIZED"
    static let invalidToken = "INVALID_TOKEN"
    static let sessionExpired = "SESSION_EXPIRED"
    static let forbiddenOrigin = "FORBIDDEN_ORIGIN"
}

/// 클라이언트(웹·모바일)가 로컬에서 만드는, 서버 계약에 등재된 코드.
/// 앱 전용 코드(예: PROVIDER_UNAVAILABLE)는 여기 없다 — `AppErrorCode`(손으로 유지).
enum ClientErrorCode {
    static let networkError = "NETWORK_ERROR"
    static let requestFailed = "REQUEST_FAILED"
    static let invalidResponse = "INVALID_RESPONSE"
}

/// 서버 `User.provider`가 취하는 값. 디코딩 경계에서 이 집합으로 검증한다.
let AUTH_PROVIDERS: Set<String> = ["google", "apple", "kakao", "demo"]

/// 세션을 만든 기기의 종류(`SessionInfo.device`). 모르는 값은 `unknown`으로 접는다 —
/// 갈래가 늘었다고 예전 앱에서 목록 전체가 실패하면 손해가 더 크다.
enum DeviceKind: String, Codable, Sendable {
    case iphone
    case ipad
    case galaxy
    case pixel
    case android
    case mac
    case windows
    case desktop
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = DeviceKind(rawValue: raw) ?? .unknown
    }
}
