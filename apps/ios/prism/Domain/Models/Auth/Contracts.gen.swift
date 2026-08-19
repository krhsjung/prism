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
