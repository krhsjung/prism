//
//  SessionsService.swift
//  prism
//
//  Path: Features/Dashboard/SessionsService.swift
//

import Foundation

/// 활성 세션 API의 계약 — 전부 Bearer로 인증한다(plan/dashboard.md §5).
///
/// `AuthServicing`과 같은 이유로 프로토콜을 둔다: 화면 로직을 네트워크 없이 검증할 수
/// 있어야 하고, 폐기는 되돌릴 수 없어 가짜 구현으로 확인하는 편이 안전하다.
protocol SessionsServicing: Sendable {
    /// 내 활성 세션 목록. 현재 세션은 서버가 `isCurrent`로 표시해 준다.
    func sessions(accessToken: String) async throws -> [SessionListItem]
    /// 위와 같되, **소켓이 시킨 재조회**인지를 함께 말한다 — 그 경우 세션의 유휴 창을
    /// 밀지 않는다(plan/auth.md §6). 성격을 모르는 구현(테스트 목)은 기본 구현을 쓴다.
    func sessions(accessToken: String, background: Bool) async throws -> [SessionListItem]
    /// 세션 하나를 원격 폐기한다.
    func revoke(id: String, accessToken: String) async throws
    /// 내 모든 세션을 폐기한다 — 현재 세션까지 포함한다.
    func revokeAll(accessToken: String) async throws
}

extension SessionsServicing {
    func sessions(accessToken: String, background: Bool) async throws -> [SessionListItem] {
        try await sessions(accessToken: accessToken)
    }
}

/// 서버 계약을 그대로 옮긴 얇은 층. 상태는 갖지 않는다.
struct SessionsService: SessionsServicing {
    private let network: NetworkManager

    init(network: NetworkManager) {
        self.network = network
    }

    func sessions(accessToken: String) async throws -> [SessionListItem] {
        try await sessions(accessToken: accessToken, background: false)
    }

    func sessions(accessToken: String, background: Bool) async throws -> [SessionListItem] {
        try await network.send(.sessions, accessToken: accessToken, background: background)
    }

    func revoke(id: String, accessToken: String) async throws {
        try await network.sendIgnoringResponse(.revokeSession(id: id), accessToken: accessToken)
    }

    func revokeAll(accessToken: String) async throws {
        try await network.sendIgnoringResponse(.revokeAllSessions, accessToken: accessToken)
    }
}
