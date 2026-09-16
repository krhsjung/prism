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

    /// 같은 통화를 다시 열어 달라고 하면 차례가 오른다 — 값만 보면 `"c"` → nil → `"c"`가 한 번의
    /// 변화로 접혀 화면이 다시 돌지 않는다.
    @Test("같은 통화를 다시 열어 달라고 하면 새 요청이다")
    func sameCallAgainIsANewRequest() async {
        let links = PushLinks()
        links.offer(kind: "call", callId: "call-1")
        await Task.yield()
        let first = links.callSeq
        links.consume()

        links.offer(kind: "call", callId: "call-1")
        await Task.yield()

        #expect(links.pendingCallId == "call-1")
        #expect(links.callSeq == first + 1)
    }

    /// 통화 화면을 떠나면 그때 남긴 통화 요청은 버린다 — 떠나는 사이 들어온 다른 통화는 다른
    /// 차례라 남고, 화면 요청은 그대로다.
    @Test("통화 화면을 떠나면 그 차례의 통화만 버린다")
    func leavingDropsOnlyThatCall() async {
        let links = PushLinks()
        links.offer(kind: "call", callId: "call-1")
        await Task.yield()
        let retained = links.callSeq

        links.dropCall(seq: retained)
        #expect(links.pendingCallId == nil)

        links.offer(kind: "call", callId: "call-1")
        await Task.yield()
        links.offer(kind: "call", callId: "call-2")
        await Task.yield()
        links.dropCall(seq: retained)
        #expect(links.pendingCallId == "call-2")
    }

    /// 앞 요청의 성공이 뒤 요청을 지우면 뒤 통화는 영영 묻지 못한다 — 그 차례일 때만 비운다.
    @Test("처리한 차례의 요청만 비운다")
    func consumesOnlyThatSeq() async {
        let links = PushLinks()
        links.offer(kind: "call", callId: "call-1")
        await Task.yield()
        let first = links.callSeq
        links.offer(kind: "call", callId: "call-2")
        await Task.yield()

        links.consume(seq: first)
        #expect(links.pendingCallId == "call-2")

        links.consume(seq: links.callSeq)
        #expect(links.pendingCallId == nil)
    }

    /// 통화가 화면보다 우선이다 — 둘이 함께 남으면 화면 쪽이 통화 화면을 덮는다.
    @Test("통화가 기다리면 화면은 열지 않고, 통화가 오면 기다리던 화면을 버린다")
    func callOutranksPage() async {
        let links = PushLinks()
        let base = URL(string: "https://prism.example")!
        await links.open("https://prism.example/push", kind: "demo", base: base)
        #expect(links.pendingPage == .push)

        links.offer(kind: "call", callId: "call-9")
        await Task.yield()
        #expect(links.pendingCallId == "call-9")
        #expect(links.pendingPage == nil)

        await links.open("https://prism.example/push", kind: "demo", base: base)
        #expect(links.pendingPage == nil)
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

/// 링크는 **우리 주소면 앱 안의 화면**(딥링크), 바깥 주소면 브라우저다 — 통화 알림만 예외다
/// (앱이 자기 화면으로 연다). 옛 서버가 실은 기본 주소(`/push`)도 우리 주소라 앱 안에서 열린다.
@Suite("push link resolving")
struct PushLinkResolvingTests {
    private let base = URL(string: "https://prism.example")!

    @Test("통화 알림의 링크는 열지 않는다")
    func callNeverOpens() {
        #expect(
            PushLinks.resolve("https://prism.example/webrtc?callId=1", kind: "call", base: base)
                == .nothing
        )
    }

    @Test("우리 주소는 앱 안의 화면이다")
    func ownOriginIsAPage() {
        #expect(PushLinks.resolve("https://prism.example/push", kind: "demo", base: base) == .page(.push))
        #expect(
            PushLinks.resolve("https://PRISM.example:443/webrtc?callId=1", kind: "demo", base: base)
                == .page(.webrtc)
        )
        #expect(PushLinks.resolve("https://prism.example/", kind: nil, base: base) == .page(.dashboard))
        #expect(PushLinks.resolve("https://prism.example/docs", kind: nil, base: base) == .page(.dashboard))
        // 경로 전체로 견준다 — 끝의 `/`만 무시하고, 웹에도 없는 하위 경로는 대시보드다.
        #expect(PushLinks.resolve("https://prism.example/push/", kind: nil, base: base) == .page(.push))
        #expect(
            PushLinks.resolve("https://prism.example/push/settings", kind: nil, base: base)
                == .page(.dashboard)
        )
        #expect(
            PushLinks.resolve("https://prism.example/webrtc/old", kind: nil, base: base)
                == .page(.dashboard)
        )
    }

    @Test("바깥 주소는 브라우저로 간다")
    func externalOpensOutside() {
        #expect(
            PushLinks.resolve("https://example.com/thing", kind: "demo", base: base)
                == .external(URL(string: "https://example.com/thing")!)
        )
        #expect(
            PushLinks.resolve("https://prism.example:8443/page", kind: nil, base: base)
                == .external(URL(string: "https://prism.example:8443/page")!)
        )
    }

    @Test("링크가 없거나 깨졌으면 아무것도 열지 않는다")
    func nothingToOpen() {
        #expect(PushLinks.resolve(nil, kind: "demo", base: base) == .nothing)
        #expect(PushLinks.resolve("", kind: "demo", base: base) == .nothing)
    }
}

/// 앱 링크 판정은 **출처**로 한다 — 호스트만 보면 같은 호스트의 다른 포트를 앱 링크로 읽는다.
@Suite("push app link")
struct PushAppLinkTests {
    private let base = URL(string: "https://prism.example")!

    @Test("같은 출처면 앱 링크다")
    func sameOrigin() {
        #expect(isSameOrigin(URL(string: "https://prism.example/push")!, base))
        #expect(isSameOrigin(URL(string: "https://PRISM.example:443/webrtc?callId=1")!, base))
    }

    @Test("포트·스킴·호스트가 다르면 앱 링크가 아니다")
    func differentOrigin() {
        #expect(!isSameOrigin(URL(string: "https://prism.example:8443/page")!, base))
        #expect(!isSameOrigin(URL(string: "http://prism.example/page")!, base))
        #expect(!isSameOrigin(URL(string: "https://prism.example.evil/page")!, base))
    }
}

/// 한 번만 열리는 문 — 보내기를 붙들어 "묻는 중"인 순간을 재현한다.
private final class Gate: @unchecked Sendable {
    private let semaphore = DispatchSemaphore(value: 0)
    func wait() async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            DispatchQueue.global().async {
                self.semaphore.wait()
                c.resume()
            }
        }
    }
    func open() { semaphore.signal() }
}

/// 묻는 일의 주인 — 비동기 보내기와 사람의 이동이 겹치는 자리의 규칙.
@MainActor
@Suite("push call resumer")
struct PushCallResumerTests {
    /// 보내기를 손으로 여닫는 가짜 — 부른 수를 세고, 답을 차례로 준다.
    @MainActor
    final class FakeResume {
        var calls: [String] = []
        fileprivate var gate: Gate?
        var results: [Bool] = [true]
        func resume(_ callId: String) async -> Bool {
            calls.append(callId)
            if let gate { await gate.wait() }
            return results.count > 1 ? results.removeFirst() : results[0]
        }
    }

    private func make(result: Bool = true) -> (PushLinks, FakeResume, PushCallResumer) {
        let links = PushLinks()
        let fake = FakeResume()
        fake.results = [result]
        let resumer = PushCallResumer(links: links) { await fake.resume($0) }
        return (links, fake, resumer)
    }

    private func offer(_ links: PushLinks, _ callId: String) async {
        links.offer(kind: "call", callId: callId)
        await Task.yield()
    }

    /// 줄 안의 일이 돌 시간을 준다. 문(`Gate`)은 다른 스레드에서 열리므로 양보만으로는 부족할 수
    /// 있다 — 짧게 잔다.
    private func settle() async {
        for _ in 0..<10 {
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(5))
        }
    }

    @Test("물었으면 요청을 비운다")
    func successConsumes() async {
        let (links, fake, resumer) = make()
        await offer(links, "c-1")

        resumer.attempt(callId: "c-1", seq: links.callSeq, connection: 1)
        await settle()

        #expect(fake.calls == ["c-1"])
        #expect(links.pendingCallId == nil)
        #expect(resumer.retainedSeq == nil)
    }

    @Test("묻지 못하면 남기고, 떠나면 버린다")
    func failureRetainsUntilLeaving() async {
        let (links, _, resumer) = make(result: false)
        await offer(links, "c-1")

        resumer.attempt(callId: "c-1", seq: links.callSeq, connection: 1)
        await settle()
        #expect(links.pendingCallId == "c-1")
        #expect(resumer.retainedSeq == links.callSeq)

        resumer.leaveCallScreen()
        #expect(links.pendingCallId == nil)
        #expect(resumer.retainedSeq == nil)
    }

    /// 아직 묻지 못한 요청(소켓이 안 붙음)도 떠나면 버린다 — 남기면 다시 붙는 순간 끌려간다.
    @Test("묻지 못한 요청도 떠나면 버린다")
    func leavingDropsAnUnattemptedRequest() async {
        let (links, fake, resumer) = make()
        await offer(links, "c-1")

        resumer.leaveCallScreen()

        #expect(links.pendingCallId == nil)
        #expect(fake.calls.isEmpty)
    }

    /// 묻는 중에 떠났다 — 그 뒤의 실패는 남기지 않는다(요청은 이미 거뒀다).
    @Test("묻는 중에 떠나면 실패해도 남기지 않는다")
    func leavingDuringAttemptAbandons() async {
        let (links, fake, resumer) = make(result: false)
        let gate = Gate()
        fake.gate = gate
        await offer(links, "c-1")
        resumer.attempt(callId: "c-1", seq: links.callSeq, connection: 1)
        await settle()

        resumer.leaveCallScreen()
        gate.open()
        await settle()

        #expect(links.pendingCallId == nil)
        #expect(resumer.retainedSeq == nil)
    }

    /// 앞 요청의 결과는 뒤 요청의 것이 아니다 — 지우지도 남기지도 않는다.
    @Test("앞 요청의 실패가 뒤 요청을 남기거나 지우지 않는다")
    func supersededResultIsIgnored() async {
        let (links, fake, resumer) = make(result: false)
        let gate = Gate()
        fake.gate = gate
        await offer(links, "c-1")
        let first = links.callSeq
        resumer.attempt(callId: "c-1", seq: first, connection: 1)
        await settle()

        await offer(links, "c-2")
        gate.open()
        await settle()

        #expect(links.pendingCallId == "c-2")
        #expect(resumer.retainedSeq == nil)
        #expect(first != links.callSeq)
    }

    /// 같은 통화의 두 번째 요청은 같은 연결의 보내기를 함께 기다린다 — 두 번 묻지 않는다.
    @Test("같은 연결에서는 같은 통화를 겹쳐 묻지 않는다")
    func sameCallSharesTheSend() async {
        let (links, fake, resumer) = make()
        let gate = Gate()
        fake.gate = gate
        await offer(links, "c-1")
        resumer.attempt(callId: "c-1", seq: links.callSeq, connection: 1)
        await settle()

        await offer(links, "c-1")
        resumer.attempt(callId: "c-1", seq: links.callSeq, connection: 1)
        await settle()
        #expect(fake.calls == ["c-1"])

        gate.open()
        await settle()
        #expect(links.pendingCallId == nil)
    }

    /// 다시 붙은 뒤의 계기는 옛 소켓의 보내기에 합류하지 않고 새로 보낸다 — 옛 보내기는 끝내
    /// 실패하고, 그때는 준비 상태가 이미 참이라 다시 부를 계기가 없다.
    @Test("다시 붙으면 옛 보내기에 합류하지 않고 새로 보낸다")
    func reconnectStartsAFreshSend() async {
        let (links, fake, resumer) = make()
        let gate = Gate()
        fake.gate = gate
        fake.results = [false, true]
        await offer(links, "c-1")
        let seq = links.callSeq
        resumer.attempt(callId: "c-1", seq: seq, connection: 1)
        await settle()

        resumer.attempt(callId: "c-1", seq: seq, connection: 2)
        await settle()
        #expect(fake.calls == ["c-1", "c-1"])

        gate.open()
        gate.open()
        await settle()
        #expect(links.pendingCallId == nil)
        #expect(resumer.retainedSeq == nil)
    }
}
