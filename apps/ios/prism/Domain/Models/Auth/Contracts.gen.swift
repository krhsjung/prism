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

/// 세션 소켓이 내려보내는 메시지의 종류.
///
/// `DeviceKind`와 달리 **모르는 값은 접지 않고 거부한다** — 이것은 화면 라벨이 아니라
/// 동작이라, 아무 갈래로 접으면 하지 말아야 할 일을 한다. 합성된 `init(from:)`이
/// 모르는 raw 값에 throw하는 것이 바로 그 동작이다.
enum SocketServerMessageType: String, Codable, Sendable {
    case ready
    case sessionsChanged
    case heartbeat
    case error
}

/// 세션 소켓으로 **올려보내는** 메시지의 종류.
///
/// presence를 주장하지 않는다 — 서버는 이 말을 믿는 대신 세션 저장소를 다시 읽는다.
/// 그래서 이 메시지에는 아무 권한도 실려 있지 않다(무엇을 폐기했는지도 말하지 않는다).
enum SessionClientMessageType: String, Codable, Sendable {
    case sessionsRevoked
}

/// 푸시 알림 페이로드의 `data` 키. 세 클라이언트가 같은 문자열을 손으로 베끼지 않게 한다.
enum PushDataKey {
    static let kind = "kind"
    static let callId = "callId"
    static let device = "device"
    static let link = "link"
    static let actions = "actions"
}

/// 알림의 갈래(`data.kind`). `call`은 소켓 없는 기기를 깨우는 통화 알림이다.
let PUSH_KINDS: Set<String> = ["call", "demo"]

/// 알림에 붙는 버튼 조합. **iOS가 미리 등록한 것만 쓸 수 있어** 조합 자체를 계약이 정한다.
enum PushActionSet: String, CaseIterable, Codable, Sendable {
    case none = "none"
    case open = "open"
    case openDismiss = "open-dismiss"
}

/// 푸시 전송 결과. **FCM이 알려 주는 것은 "받아들였다"까지다** — 배달도 열람도 아니다.
enum PushSendResult: String, Codable, Sendable {
    case accepted = "accepted"
    case noToken = "no-token"
    case rejected = "rejected"
    case duplicate = "duplicate"
    case unknown = "unknown"
}
