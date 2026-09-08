//
//  PushTests.swift
//  prismTests
//

import Foundation
import Testing
@testable import prism

/// 목록에 실려 오는 것은 **파생 불리언뿐이다** — 등록 토큰은 서버 밖으로 나가지 않는다
/// (plan/push.md §5-3).
@Suite("push contracts")
struct PushContractTests {
    private func decode(_ json: String) throws -> SessionListItem {
        try JSONDecoder().decode(SessionListItem.self, from: Data(json.utf8))
    }

    /// `isConnected`와 같은 규칙 — 푸시가 붙기 전 서버가 이 필드를 보내지 않아도
    /// 목록은 그려져야 한다. 그 세션은 `Notifications off`로 정직하게 보인다.
    @Test("pushRegistered가 없으면 false로 접는다")
    func foldsMissingPushRegistered() throws {
        let item = try decode(
            #"{"id":"s1","startedAt":"a","expiresAt":"b","isCurrent":true,"device":"mac"}"#
        )
        #expect(item.pushRegistered == false)
    }

    @Test("pushRegistered가 있으면 그대로 읽는다")
    func readsPushRegistered() throws {
        let item = try decode(
            #"{"id":"s1","startedAt":"a","expiresAt":"b","isCurrent":true,"pushRegistered":true,"device":"mac"}"#
        )
        #expect(item.pushRegistered == true)
    }

    /// 대상이 여럿이라 **결과도 여럿이다** — 화면이 고른 줄 옆에 그대로 그린다(§5-10).
    @Test("대상별 결과를 구성한다")
    func decodesOutcomesPerTarget() throws {
        let response = try JSONDecoder().decode(
            PushSendResponse.self,
            from: Data(
                #"{"results":[{"sessionId":"s-1","result":"accepted"},{"sessionId":"s-2","result":"duplicate"}]}"#
                    .utf8
            )
        )
        #expect(
            response.results == [
                PushSendOutcome(sessionId: "s-1", result: .accepted),
                PushSendOutcome(sessionId: "s-2", result: .duplicate),
            ]
        )
    }

    /// **FCM이 알려 주는 것은 "받아들였다"까지다** — 모르는 결과를 접으면 화면이 없는
    /// 사실을 말하게 되므로 디코딩에서 거부한다.
    @Test("계약에 없는 결과는 거부한다")
    func rejectsUnknownResult() {
        #expect(throws: (any Error).self) {
            try JSONDecoder().decode(
                PushSendResponse.self,
                from: Data(#"{"results":[{"sessionId":"s-1","result":"delivered"}]}"#.utf8)
            )
        }
    }

    /// 버튼 조합은 **계약이 정한 셋뿐이다** — iOS가 미리 등록한 카테고리만 쓸 수 있어
    /// 임의 목록을 보낼 방법이 없다(§5-13).
    @Test("버튼 조합은 계약의 셋뿐이다")
    func actionSetsAreClosed() {
        #expect(PushActionSet.allCases.map(\.rawValue) == ["none", "open", "open-dismiss"])
    }
}

/// 알림이 열어 달라고 한 통화. 화면은 이것을 **한 번만** 소비한다 — 남겨 두면 화면을
/// 되돌아올 때마다 같은 통화를 다시 열려 한다.
@MainActor
@Suite("push links")
struct PushLinksTests {
    @Test("통화 알림이 가리키는 통화를 연다")
    func opensTheCall() async {
        let links = PushLinks()
        links.offer(kind: "call", callId: "call-1")
        await Task.yield()

        #expect(links.pendingCallId == "call-1")

        links.consume()
        #expect(links.pendingCallId == nil)
    }

    /// 통화가 아닌 알림(데모 푸시)도, `callId` 없는 통화 알림도 화면을 열지 않는다 —
    /// 후자는 열어 봐야 물을 것이 없다.
    @Test("통화가 아니거나 id가 없으면 아무것도 하지 않는다")
    func ignoresEverythingElse() async {
        let links = PushLinks()
        links.offer(kind: "demo", callId: "call-2")
        links.offer(kind: "call", callId: nil)
        links.offer(kind: "call", callId: "")
        links.offer(kind: nil, callId: nil)
        await Task.yield()

        #expect(links.pendingCallId == nil)
    }
}
