//
//  SocketContracts.swift
//  prism
//
//  Path: Domain/Models/Auth/SocketContracts.swift
//

import Foundation

/// 세션 소켓이 내려보내는 메시지.
///
/// **이 소켓은 데이터를 나르지 않는다.** `sessionsChanged`를 받으면 화면이 기존
/// `GET /auth/sessions`를 다시 부른다 — 스탬핑·공유 회전·확정 거절 처리가 전부 그 HTTP
/// 경로에 있고, 소켓이 목록을 직접 주입하면 그것을 통째로 우회하기 때문이다.
/// (서버 계약: apps/server/libs/common/src/types/contracts.ts)
enum SocketServerMessage: Equatable, Sendable {
    /// 인증 통과. 목록을 한 번 가져오라는 신호이자, **isConnected를 믿어도 된다**는 신호다.
    case ready
    /// 이 사용자의 연결 구성이 바뀌었다. 다시 가져와라.
    case sessionsChanged
    /// 살아 있다는 신호. 침묵이 곧 죽음이다(아래 `SessionSocket` 주석 참고).
    case heartbeat
    /// 직후 연결이 닫힌다. 코드는 HTTP와 **같은** `AuthErrorCode`다.
    case error(code: String)
}

extension SocketServerMessage: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, code
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch SocketServerMessageType(rawValue: type) {
        case .ready: self = .ready
        case .sessionsChanged: self = .sessionsChanged
        case .heartbeat: self = .heartbeat
        case .error:
            self = .error(code: try c.decode(String.self, forKey: .code))
        case .none:
            // `DeviceKind`와 달리 **모르는 값을 접지 않는다** — 이것은 화면 라벨이 아니라
            // 동작이라, 아무 갈래로 접으면 하지 말아야 할 일을 한다.
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: c,
                debugDescription: "unknown socket message type",
            )
        }
    }
}
