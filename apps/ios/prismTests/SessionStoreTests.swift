//
//  SessionStoreTests.swift
//  prismTests
//
//  세 화면이 나눠 쓰는 **목록 하나**를 네트워크 없이 검증한다.
//
//  이 타입이 생긴 이유가 곧 이 파일이 보는 것이다: 목록을 화면마다 들고 있던 동안에는
//  화면마다 신선도가 달랐고(푸시 화면만 소켓 신호를 듣지 않았다), 화면을 하나 더 만들
//  때마다 같은 규칙을 옮겨 적어야 했다.
//

import Foundation
import Testing
@testable import prism

// MARK: - Fakes

private final class FakeSessions: SessionsServicing, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [SessionListItem]
    var failList = false
    /// 조회마다 `background`가 무엇이었는지 — 유휴 창을 미는지가 여기서 갈린다.
    private(set) var backgroundFlags: [Bool] = []

    /// 조회가 몇 번 **출발**했는가(응답 전에 센다). 경합을 세우는 테스트가 쓴다.
    var callCount: Int { lock.withLock { backgroundFlags.count } }

    init(_ items: [SessionListItem]) {
        self.items = items
    }

    func replace(_ next: [SessionListItem]) {
        lock.withLock { items = next }
    }

    func sessions(accessToken: String) async throws -> [SessionListItem] {
        try await sessions(accessToken: accessToken, background: false)
    }

    func sessions(
        accessToken: String,
        background: Bool,
    ) async throws -> [SessionListItem] {
        lock.withLock { backgroundFlags.append(background) }
        // 응답을 붙들어 둔 동안 다른 일이 일어나게 한다(로그아웃 등).
        if let gate { await gate.wait() }
        if failList { throw APIError.network }
        return lock.withLock { items }
    }

    /// 다음 조회의 응답을 붙든다. [release]를 부를 때까지 돌아오지 않는다.
    private var gate: Gate?
    func hold() { gate = Gate() }
    func release() { gate?.open() }

    /// 한 번만 열리는 문. `CheckedContinuation`을 직접 다루는 것보다 읽기 쉽다.
    final class Gate: @unchecked Sendable {
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

    func revoke(id: String, accessToken: String) async throws {}
    func revokeAll(accessToken: String) async throws {}
}

private func item(_ id: String, current: Bool = false) -> SessionListItem {
    SessionListItem(
        id: id,
        startedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T12:00:00.000Z",
        isCurrent: current,
        device: .iphone,
    )
}

/// 소켓으로 나간 "목록이 바뀌었다"를 센다. 클래스인 이유: store가 클로저를 붙들고
/// 있어, 값 타입이면 호출이 사본에 쌓여 테스트가 볼 수 없다.
private final class ChangeSignals {
    var count = 0
}

@MainActor
private func makeStore(
    _ service: FakeSessions,
    token: String? = "tok",
    signals: ChangeSignals? = nil,
) -> SessionStore {
    SessionStore(
        service: service,
        accessToken: { token },
        notify: { signals?.count += 1 },
    )
}

// MARK: - Tests

@MainActor
struct SessionStoreTests {

    @Test("목록을 불러오면 세션이 채워진다")
    func loadsSessions() async {
        let store = makeStore(FakeSessions([item("a", current: true), item("b")]))

        await store.load()

        #expect(store.sessions?.map(\.id) == ["a", "b"])
        #expect(store.hasOthers)
        #expect(store.loadErrorKey == nil)
    }

    @Test("현재 세션 하나뿐이면 다른 세션이 없다고 말한다")
    func aloneHasNoOthers() async {
        let store = makeStore(FakeSessions([item("only", current: true)]))

        await store.load()

        // "나 혼자"는 빈 목록이 아니다 — 전체 폐기가 곧 로그아웃이라 버튼을 둘 이유가 없다.
        #expect(store.sessions?.count == 1)
        #expect(!store.hasOthers)
    }

    @Test("갱신은 실패해도 화면의 목록을 지우지 않는다")
    func refreshKeepsListOnFailure() async {
        let service = FakeSessions([item("a", current: true), item("b")])
        let store = makeStore(service)
        await store.load()
        service.failList = true

        await store.refresh()

        // 비운 뒤 실패하면 볼 것도 재시도할 대상도 사라진다. 처음 불러오기(load)는 반대로
        // 비우는 것이 맞다 — 화면에 아직 아무것도 없는 자리이기 때문이다.
        #expect(store.sessions?.map(\.id) == ["a", "b"])
        #expect(store.loadErrorKey == .errorSessionsLoadFailed)
    }

    @Test("불러오기에 실패하면 오류만 남기고 목록은 비운다")
    func loadFailureShowsError() async {
        let service = FakeSessions([])
        service.failList = true
        let store = makeStore(service)

        await store.load()

        #expect(store.sessions == nil)
        #expect(store.loadErrorKey == .errorSessionsLoadFailed)
    }

    @Test("토큰이 없으면 요청하지 않고 오류로 떨어진다")
    func missingTokenFails() async {
        let service = FakeSessions([item("a")])
        let store = makeStore(service, token: nil)

        await store.load()

        #expect(store.sessions == nil)
        #expect(store.loadErrorKey == .errorSessionsLoadFailed)
        #expect(service.backgroundFlags.isEmpty)
    }

    // 소켓이 시킨 재조회는 **활동이 아니다**(plan/auth.md §6) — 화면을 열어 둔 것만으로
    // 세션이 연장되면 기기가 둘일 때 서로가 서로의 세션을 영원히 살려낸다.
    @Test("배경 갱신은 유휴 창을 밀지 않는다고 말한다")
    func backgroundRefreshIsNotActivity() async {
        let service = FakeSessions([item("a", current: true)])
        let store = makeStore(service)

        await store.load()
        await store.refresh(background: true)

        // 화면 진입(load)은 활동이고, 소켓이 시킨 갱신은 아니다.
        #expect(service.backgroundFlags == [false, true])
    }

    // 신호가 오면 **목록을 비우지 않고** 새것으로 갈아 끼운다 — 다른 기기가 하나
    // 붙었다고 카드가 "불러오는 중"으로 접혔다 펴지면 목록 전체가 깜빡인다.
    @Test("갱신은 목록을 비우지 않고 갈아 끼운다")
    func refreshSwapsWithoutClearing() async {
        let service = FakeSessions([item("a", current: true)])
        let store = makeStore(service)
        await store.load()
        service.replace([item("a", current: true), item("b")])

        await store.refresh(background: true)

        #expect(store.sessions?.map(\.id) == ["a", "b"])
    }

    // 목록을 쥔 쪽이 "다른 기기에도 알린다"를 맡는다. 바꾸는 화면마다 소켓을 따로 들고
    // 있으면 어느 화면은 알리고 어느 화면은 잊는다 — 알림 끄기가 실제로 그랬다.
    @Test("바뀐 사실은 다른 기기에도 전한다")
    func notifiesOtherDevices() async {
        let signals = ChangeSignals()
        let store = makeStore(FakeSessions([item("a", current: true)]), signals: signals)

        store.notifyChanged()

        #expect(signals.count == 1)
    }

    // 조회는 나만 새로 고친다 — 남에게 알리는 것은 **내가 무언가를 바꿨을 때**뿐이다.
    // 재조회마다 알리면 두 기기가 서로의 재조회를 끝없이 부른다.
    @Test("그냥 다시 가져오는 것은 남에게 알리지 않는다")
    func refreshDoesNotNotify() async {
        let signals = ChangeSignals()
        let store = makeStore(FakeSessions([item("a", current: true)]), signals: signals)

        await store.load()
        await store.refresh(background: true)

        #expect(signals.count == 0)
    }

    // 로그아웃 순간에 떠 있던 조회는 그대로 살아 있다가 다음 로그인 뒤에 끝날 수 있다.
    // 값만 비우면 그 응답이 **앞 사용자의 목록을 다음 사용자 화면에 그린다** — 웹은 주인을
    // 적어 대조하고 Android는 저장소째 갈아 끼우는데, iOS만 이 방어가 없었다.
    @Test("세션이 끝난 뒤 도착한 응답은 버린다")
    func lateResponseAfterResetIsDropped() async {
        let service = FakeSessions([item("a", current: true)])
        service.hold()
        let store = makeStore(service)

        // 조회를 띄워 둔 채 세션이 끝난다.
        //
        // ⚠️ **출발을 확인하고 나서 끝낸다.** `async let`은 첫 중단점까지 아직 돌지 않았을
        // 수 있어, 곧바로 `reset()`을 부르면 조회가 **새 세대를 들고** 시작해 버린다 —
        // 그러면 검사하려던 상황(앞 세대의 응답이 늦게 도착)이 아예 만들어지지 않는다.
        async let pending: Void = store.refresh()
        while service.callCount == 0 { await Task.yield() }
        store.reset()
        service.release()
        await pending

        #expect(store.sessions == nil)
    }

    // 이 store는 컨테이너가 들고 있어 재로그인을 건너 살아남는다 — 비우지 않으면 다음
    // 사용자의 대시보드에 앞 사람의 기기 목록이 그려진다.
    /// 조회는 겹칠 수 있고 응답은 출발 순서대로 오지 않는다 — 옛 응답이 늦게 와서 새 응답을
    /// 덮으면 방금 켠 등록이 화면에서 꺼진 것으로 보인다. 가장 늦게 출발한 조회만 쓴다.
    @Test("늦게 도착한 옛 응답이 새 응답을 덮지 않는다")
    func lateOlderResponseDoesNotOverwrite() async {
        let service = OrderedSessions()
        let store = SessionStore(service: service, accessToken: { "tok" })

        // 첫 조회는 문에 걸려 있고, 둘째 조회가 먼저 돌아온다(등록된 모습).
        let first = Task { await store.refresh() }
        await service.firstStarted.wait()
        await store.refresh(background: true)
        #expect(store.sessions?.first?.pushRegistered == true)

        service.releaseFirst()
        await first.value

        #expect(store.sessions?.first?.pushRegistered == true)
    }

    @Test("세션이 끝나면 목록을 비운다")
    func resetClearsList() async {
        let store = makeStore(FakeSessions([item("a", current: true)]))
        await store.load()

        store.reset()

        #expect(store.sessions == nil)
        #expect(store.loadErrorKey == nil)
    }
}


/// 첫 조회는 문에 걸리고(등록 전 모습), 그다음 조회는 곧바로 돌아온다(등록된 모습).
private final class OrderedSessions: SessionsServicing, @unchecked Sendable {
    let firstStarted = FakeSessions.Gate()
    private let firstGate = FakeSessions.Gate()
    private let lock = NSLock()
    private var calls = 0

    func releaseFirst() { firstGate.open() }

    func sessions(accessToken: String) async throws -> [SessionListItem] {
        try await sessions(accessToken: accessToken, background: false)
    }

    func sessions(accessToken: String, background: Bool) async throws -> [SessionListItem] {
        let call = lock.withLock { calls += 1; return calls }
        if call == 1 {
            firstStarted.open()
            await firstGate.wait()
            return [item(registered: false)]
        }
        return [item(registered: true)]
    }

    func revoke(id: String, accessToken: String) async throws {}
    func revokeAll(accessToken: String) async throws {}

    private func item(registered: Bool) -> SessionListItem {
        SessionListItem(
            id: "me",
            startedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-01-01T12:00:00.000Z",
            isCurrent: true,
            pushRegistered: registered,
        )
    }
}
