//
//  PushService.swift
//  prism
//
//  Path: Features/Push/PushService.swift
//

import Foundation

/// 보내는 내용. 문구 외에는 **전부 선택이다**(plan/push.md §5-11 ~ §5-13).
struct PushContent: Sendable {
    let message: String
    /// 비우면 서버가 받는 기기의 언어로 그린다(plan/push.md §5-14).
    var title: String?
    var imageUrl: String?
    var link: String?
    var actions: PushActionSet = .none
}

/// 대상 하나의 결말. **세션 단위로 답한다** — 화면이 고른 줄 옆에 그대로 그린다.
struct PushSendOutcome: Decodable, Equatable, Sendable {
    let sessionId: String
    let result: PushSendResult
}

/// 푸시 전송 API.
///
/// **클라이언트는 "이 세션들에 보내줘"라고만 한다** — 등록 토큰은 서버가 세션 레코드에서
/// 꺼낸다(plan/push.md §5-3). 목록에 토큰이 실리지 않으므로 앱이 그것으로 할 수 있는
/// 일도 없다(전송에는 서버 자격증명이 필요하다).
protocol PushServicing: Sendable {
    func send(
        _ content: PushContent,
        to sessionIds: [String],
        accessToken: String
    ) async throws -> [PushSendOutcome]

    /// 지금 세션에 등록 토큰을 붙인다 — 푸시 화면의 `알림 켜기`가 부른다(§5-2).
    func register(token: String, accessToken: String) async throws -> Bool
}

struct PushService: PushServicing {
    private let network: NetworkManager

    init(network: NetworkManager) {
        self.network = network
    }

    func register(token: String, accessToken: String) async throws -> Bool {
        let response: PushRegisterResponse = try await network.send(
            .registerPush,
            body: PushRegisterRequest(pushToken: token),
            accessToken: accessToken
        )
        return response.registered
    }

    func send(
        _ content: PushContent,
        to sessionIds: [String],
        accessToken: String
    ) async throws -> [PushSendOutcome] {
        let response: PushSendResponse = try await network.send(
            .sendPush,
            body: PushSendRequest(
                sessionIds: sessionIds,
                message: content.message,
                title: content.title?.trimmed.nilIfEmpty,
                // 빈 값은 키조차 만들지 않는다 — 없는 필드와 빈 문자열은 서버에서 같은
                // 뜻이지만(둘 다 없음), 없는 쪽이 의도가 분명하다.
                imageUrl: content.imageUrl?.trimmed.nilIfEmpty,
                link: content.link?.trimmed.nilIfEmpty,
                actions: content.actions
            ),
            accessToken: accessToken
        )
        return response.results
    }
}

private struct PushRegisterRequest: Encodable {
    let pushToken: String
}

private struct PushRegisterResponse: Decodable {
    let registered: Bool
}

private struct PushSendRequest: Encodable {
    let sessionIds: [String]
    let message: String
    let title: String?
    let imageUrl: String?
    let link: String?
    let actions: PushActionSet
}

/// 서버 응답. **결과는 계약의 다섯뿐이다** — 모르는 값을 접으면 화면이 없는 사실을
/// 말하게 되므로 디코딩에서 거부한다(`PushSendResult`가 `String` raw value라 자동이다).
struct PushSendResponse: Decodable {
    let results: [PushSendOutcome]
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
