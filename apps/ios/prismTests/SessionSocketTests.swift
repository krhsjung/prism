//
//  SessionSocketTests.swift
//  prismTests
//
//  소켓이 인증 상태를 건드리지 않는다는 것과, 배지가 모를 때 지어내지 않는다는 것을
//  못 박는다. 둘 다 틀리면 조용히 나빠진다 — 오프라인이 로그아웃이 되거나, 소켓 서비스가
//  죽었을 때 멀쩡한 기기들이 전부 "비활성"으로 보인다.
//

import Foundation
import Testing
@testable import prism

private func item(
    id: String,
    isCurrent: Bool = false,
    isConnected: Bool = false,
) -> SessionListItem {
    SessionListItem(
        id: id,
        startedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-02T00:00:00.000Z",
        isCurrent: isCurrent,
        isConnected: isConnected,
        device: .iphone,
    )
}

@Suite("소켓 오류 대응")
struct SocketErrorActionTests {
    // 만료만이 갱신으로 살아나는 실패다 — 그때만 회전을 탄다.
    @Test("SESSION_EXPIRED는 갱신 후 재연결이다")
    func expired() {
        #expect(
            SocketErrorAction.of(code: AuthErrorCode.sessionExpired)
                == .refreshAndReconnect,
        )
    }

    // ⚠️ 회귀 방지: 확정 거절에도 **로그아웃하지 않는다.** 소켓이 직접 세션을 끝내면
    // 공지가 중복되거나, 이미 끝난 세션의 오류로 새 세션을 끊는다.
    @Test("확정 거절은 멈추고 목록에 판단을 넘긴다")
    func definitive() {
        #expect(
            SocketErrorAction.of(code: AuthErrorCode.unauthorized)
                == .stopAndRefetch,
        )
        #expect(
            SocketErrorAction.of(code: AuthErrorCode.invalidToken)
                == .stopAndRefetch,
        )
    }

    // 모르는 코드로 회전을 시도하면 1회용 자격증명만 태운다 — 안전한 쪽으로 실패한다.
    @Test("모르는 코드는 회전을 시도하지 않는다")
    func unknown() {
        #expect(SocketErrorAction.of(code: "NOPE") == .stopAndRefetch)
    }
}

// 계약 타입은 프로젝트 기본 격리(MainActor)를 따르므로 그 Decodable 적합성도
// MainActor의 것이다 — 비격리 테스트에서 디코딩하면 Swift 6에서 오류가 된다.
@Suite("소켓 메시지 디코딩")
@MainActor
struct SocketContractsTests {
    private func decode(_ json: String) throws -> SocketServerMessage {
        try JSONDecoder().decode(
            SocketServerMessage.self,
            from: Data(json.utf8),
        )
    }

    @Test("페이로드 없는 신호를 구성한다")
    func signals() throws {
        #expect(try decode(#"{"type":"ready"}"#) == .ready)
        #expect(try decode(#"{"type":"sessionsChanged"}"#) == .sessionsChanged)
        #expect(try decode(#"{"type":"heartbeat"}"#) == .heartbeat)
    }

    @Test("error는 코드까지 구성한다")
    func error() throws {
        #expect(
            try decode(#"{"type":"error","code":"SESSION_EXPIRED"}"#)
                == .error(code: "SESSION_EXPIRED"),
        )
    }

    // DeviceKind와 달리 접지 않는다 — 이것은 화면 라벨이 아니라 동작이다.
    @Test("모르는 type은 접지 않고 거부한다")
    func unknownType() {
        #expect(throws: (any Error).self) {
            try decode(#"{"type":"sessions"}"#)
        }
    }
}

@Suite("세션 목록 계약")
@MainActor
struct SessionListItemDecodingTests {
    private func decode(_ json: String) throws -> SessionListItem {
        try JSONDecoder().decode(SessionListItem.self, from: Data(json.utf8))
    }

    // 배포 중에는 이 필드가 없는 서버와 섞인다 — 거부하면 배지 하나 때문에 목록 전체가 실패한다.
    @Test("isConnected가 없으면 false로 접는다")
    func missingIsConnected() throws {
        let decoded = try decode(#"""
        {"id":"s-1","startedAt":"a","expiresAt":"b","isCurrent":true,"device":"mac"}
        """#)
        #expect(decoded.isConnected == false)
    }

    @Test("isConnected가 있으면 그대로 읽는다")
    func presentIsConnected() throws {
        let decoded = try decode(#"""
        {"id":"s-1","startedAt":"a","expiresAt":"b","isCurrent":false,"isConnected":true,"device":"mac"}
        """#)
        #expect(decoded.isConnected == true)
    }

    // isCurrent는 서버가 반드시 계산해 주는 값이라 없으면 형식 오류다.
    @Test("isCurrent가 없으면 거부한다")
    func missingIsCurrent() {
        #expect(throws: (any Error).self) {
            try decode(#"{"id":"s-1","startedAt":"a","expiresAt":"b","device":"mac"}"#)
        }
    }
}

@Suite("연결 상태 배지")
struct DashboardStatusTests {
    // 소켓이 붙어 있어야 presence를 믿는다. 그때 비로소 세 갈래가 드러난다.
    @Test("붙어 있으면 세 갈래로 가른다")
    func threeWay() {
        let current = item(id: "s-1", isCurrent: true)
        let online = item(id: "s-2", isConnected: true)
        let offline = item(id: "s-3", isConnected: false)

        #expect(DashboardView.statusKey(current, socketReady: true) == .dashboardStatusCurrent)
        #expect(DashboardView.statusVariant(current, socketReady: true) == .success)
        #expect(DashboardView.statusKey(online, socketReady: true) == .dashboardStatusActive)
        #expect(DashboardView.statusVariant(online, socketReady: true) == .info)
        #expect(DashboardView.statusKey(offline, socketReady: true) == .dashboardStatusInactive)
        #expect(DashboardView.statusVariant(offline, socketReady: true) == .neutral)
    }

    // ⚠️ 회귀 방지: 소켓 서비스가 죽으면 presence가 통째로 비어 모든 세션이 "연결 없음"으로
    // 온다. 그것을 그대로 그리면 멀쩡한 기기들을 전부 "비활성"이라고 **지어내게** 된다.
    // 모를 때는 이 기능 이전의 두 갈래로 물러난다.
    @Test("붙어 있지 않으면 Inactive를 지어내지 않는다")
    func fallsBackToTwoWay() {
        let offline = item(id: "s-3", isConnected: false)

        #expect(DashboardView.statusKey(offline, socketReady: false) == .dashboardStatusActive)
        #expect(DashboardView.statusVariant(offline, socketReady: false) == .info)
    }

    // 후퇴 중에도 "이 기기"는 여전히 구별된다 — 그건 presence가 아니라 서버가 계산한 값이다.
    @Test("후퇴해도 현재 세션은 그대로 구별한다")
    func currentSurvivesFallback() {
        let current = item(id: "s-1", isCurrent: true)
        #expect(DashboardView.statusKey(current, socketReady: false) == .dashboardStatusCurrent)
        #expect(DashboardView.statusVariant(current, socketReady: false) == .success)
    }
}
