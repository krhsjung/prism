//
//  PushRegistrationTests.swift
//  prismTests
//
//  이 기기의 알림 등록을 **앱에 하나만** 두는 자리를 네트워크 없이 검증한다.
//
//  이 타입이 생긴 이유가 곧 이 파일이 보는 것이다: 되살리기(`RootView`)와 켜기·끄기·
//  해제(`PushView`)가 두 벌로 있는 동안에는 둘이 겹쳐 돌 수 있었고, 권한이 사라진 것은
//  푸시 화면이 떠 있을 때만 알아챘고, 토큰이 돌면 다음 로그인까지 죽은 값이 남았다.
//

import Foundation
import Testing
@testable import prism

// MARK: - Fakes

/// 기기의 사정을 손으로 정하는 가짜. `current()`가 불린 수를 세고, 문으로 붙들 수 있다.
@MainActor
private final class FakeDevice: PushDevice {
    var permissionValue: PushPermission = .granted
    var token: String? = "fcm-1"
    var wanted = true
    private(set) var remembered: [Bool] = []
    private(set) var currentCalls = 0
    /// 토큰을 붙잡아 "되살리기가 진행 중인" 순간을 재현한다(nil이면 통과).
    var gate: Gate?

    func permission() async -> PushPermission { permissionValue }
    func current() async -> String? {
        currentCalls += 1
        if let gate { await gate.wait() }
        return permissionValue == .granted ? token : nil
    }
    func rememberWanted(_ wanted: Bool) {
        self.wanted = wanted
        remembered.append(wanted)
    }
    var disablePending = false
    func rememberDisablePending(_ pending: Bool) {
        disablePending = pending
    }
}

private final class FakePush: PushServicing, @unchecked Sendable {
    private let lock = NSLock()
    var registerResult = true
    var registerThrows = false
    var unregisterThrows = false
    private var _registered: [String] = []
    private var _order: [String] = []
    private var _unregisterCount = 0

    var registered: [String] { lock.withLock { _registered } }
    var order: [String] { lock.withLock { _order } }
    var unregisterCount: Int { lock.withLock { _unregisterCount } }

    func note(_ event: String) { lock.withLock { _order.append(event) } }

    func register(token: String, accessToken: String) async throws -> Bool {
        if registerThrows { throw APIError.network }
        lock.withLock {
            _registered.append(token)
            _order.append("register:\(token)")
        }
        return registerResult
    }

    func unregister(accessToken: String) async throws {
        if unregisterThrows { throw APIError.network }
        lock.withLock {
            _unregisterCount += 1
            _order.append("unregister")
        }
    }

    func send(
        _ content: PushContent,
        to sessionIds: [String],
        accessToken: String
    ) async throws -> [PushSendOutcome] { [] }
}

private final class FakeSessions: SessionsServicing, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [SessionListItem]
    private(set) var backgroundFlags: [Bool] = []

    init(_ items: [SessionListItem]) { self.items = items }

    func replace(_ next: [SessionListItem]) { lock.withLock { items = next } }

    func sessions(accessToken: String) async throws -> [SessionListItem] {
        try await sessions(accessToken: accessToken, background: false)
    }

    func sessions(accessToken: String, background: Bool) async throws -> [SessionListItem] {
        lock.withLock {
            backgroundFlags.append(background)
            return items
        }
    }

    func revoke(id: String, accessToken: String) async throws {}
    func revokeAll(accessToken: String) async throws {}
}

/// 한 번만 열리는 문.
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

private func item(registered: Bool) -> SessionListItem {
    SessionListItem(
        id: "me",
        startedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T12:00:00.000Z",
        isCurrent: true,
        isConnected: true,
        pushRegistered: registered,
        device: .iphone
    )
}

@MainActor
private struct Harness {
    let device = FakeDevice()
    let push = FakePush()
    let sessions: FakeSessions
    let store: SessionStore
    let registration: PushRegistration

    init(registered: Bool = false) {
        sessions = FakeSessions([item(registered: registered)])
        store = SessionStore(service: sessions, accessToken: { "tok" })
        registration = PushRegistration(
            device: device,
            service: push,
            accessToken: { "tok" },
            store: store,
        )
    }
}

/// 줄 안의 일이 돌 시간을 준다. 가짜는 즉시 답하므로 몇 번의 양보면 충분하다.
private func drain() async {
    for _ in 0..<20 { await Task.yield() }
}

// MARK: - Tests

@MainActor
@Suite("push registration")
struct PushRegistrationTests {
    @Test("받기로 해 뒀으면 조용히 다시 붙인다")
    func resumesWhenWanted() async {
        let h = Harness()

        h.registration.reconcile()
        await drain()

        #expect(h.push.registered == ["fcm-1"])
        // 붙인 뒤 목록을 다시 받는다 — 배경 재조회다(유휴 창을 밀지 않는다).
        #expect(h.sessions.backgroundFlags.contains(true))
    }

    @Test("꺼 뒀으면 아무것도 하지 않는다")
    func idleWhenNotWanted() async {
        let h = Harness()
        h.device.wanted = false

        h.registration.reconcile()
        await drain()

        #expect(h.push.registered.isEmpty)
        #expect(h.device.currentCalls == 0)
    }

    // 권한이 없으면 토큰을 받지 않는다 — 받으면 방금 거부한 사람의 토큰이 등록된다.
    @Test("권한이 없으면 토큰을 받지 않는다")
    func idleWithoutPermission() async {
        let h = Harness()
        h.device.permissionValue = .askable

        h.registration.reconcile()
        await drain()

        #expect(h.device.currentCalls == 0)
        #expect(h.push.registered.isEmpty)
    }

    // 서버는 그사이 세션이 사라졌으면 던지지 않고 false를 돌려준다 — 붙은 것이 아니다.
    @Test("서버가 붙이지 못했다고 답하면 목록을 다시 받지 않는다")
    func noRefreshWhenServerDeclines() async {
        let h = Harness()
        h.push.registerResult = false

        h.registration.reconcile()
        await drain()

        #expect(!h.sessions.backgroundFlags.contains(true))
    }

    // 같은 토큰을 매번 다시 붙이면 앱이 앞으로 올 때마다 왕복이 하나씩 붙는다.
    @Test("토큰이 같으면 다시 붙이지 않는다")
    func skipsSameToken() async {
        let h = Harness()
        h.registration.reconcile()
        await drain()

        h.registration.reconcile()
        await drain()

        #expect(h.push.registered == ["fcm-1"])
    }

    // FCM은 토큰을 돌린다. 세션에 남은 옛 값으로는 알림이 오지 않는데 목록은 여전히
    // `Will notify`를 그린다 — 돌아온 값을 다시 붙여야 한다.
    @Test("토큰이 돌면 새 값을 다시 붙인다")
    func reattachesRotatedToken() async {
        let h = Harness()
        h.registration.reconcile()
        await drain()
        h.device.token = "fcm-2"

        h.registration.tokenRotated()
        await drain()

        #expect(h.push.registered == ["fcm-1", "fcm-2"])
    }

    // 권한을 꺼도 세션 레코드의 토큰은 남아 `pushRegistered`가 참이다 — 남의 로비는
    // 울리지 않을 기기를 `Will notify`로 그린다. 받을 수 없다는 것을 아는 쪽은 이 기기뿐이다.
    @Test("등록돼 있는데 받을 수 없게 됐으면 뗀다")
    func detachesWhenBlocked() async {
        let h = Harness(registered: true)
        await h.store.load()
        h.device.permissionValue = .denied

        h.registration.reconcile()
        await drain()

        #expect(h.push.unregisterCount == 1)
        // 사람이 끈 것이 아니다 — 선택은 그대로다.
        #expect(h.device.remembered.isEmpty)
        #expect(h.device.wanted)
    }

    @Test("등록돼 있지 않으면 받을 수 없어도 아무것도 하지 않는다")
    func idleWhenBlockedAndUnregistered() async {
        let h = Harness()
        h.device.permissionValue = .denied

        h.registration.reconcile()
        await drain()

        #expect(h.push.unregisterCount == 0)
    }

    @Test("켜면 붙인 뒤 선택을 기억한다")
    func enableRegistersAndRemembers() async {
        let h = Harness()
        h.device.wanted = false

        let ok = await h.registration.enable()

        #expect(ok)
        #expect(h.push.registered == ["fcm-1"])
        #expect(h.device.remembered == [true])
    }

    // 실패했는데 선택만 남기면 화면은 `Notifications off`를 말하면서 다음 로그인에 조용히 켜진다.
    @Test("서버가 붙이지 못했다고 답하면 선택을 기억하지 않는다")
    func enableDoesNotRememberOnDecline() async {
        let h = Harness()
        h.device.wanted = false
        h.push.registerResult = false

        let ok = await h.registration.enable()

        #expect(!ok)
        #expect(h.device.remembered.isEmpty)
    }

    @Test("끄면 떼고 선택을 지운다")
    func disableDetachesAndForgets() async {
        let h = Harness(registered: true)

        let ok = await h.registration.disable()

        #expect(ok)
        #expect(h.push.unregisterCount == 1)
        #expect(h.device.remembered == [false])
    }

    // 서버에서 떼지 못했으면 기억도 바꾸지 않는다 — 바꿔 두면 지금은 등록된 채로 남으면서
    // 다음 로그인부터 조용히 꺼진다.
    @Test("떼지 못하면 선택을 바꾸지 않는다")
    func disableKeepsChoiceOnFailure() async {
        let h = Harness(registered: true)
        h.push.unregisterThrows = true

        let ok = await h.registration.disable()

        #expect(!ok)
        #expect(h.device.remembered.isEmpty)
    }

    // 떼는 도중 앱이 죽었다(또는 떼지 못했다) — 끄다 만 표식이 남아 다음 맞추기가 이어서
    // 떼고, 그때 선택이 꺼진다. 표식이 없으면 선택은 켜진 채 남아 다음 실행이 조용히 다시 붙인다.
    @Test("끄다 만 등록은 다음 맞추기가 이어서 뗀다")
    func reconcileFinishesPendingDisable() async {
        let h = Harness(registered: true)
        h.device.disablePending = true

        h.registration.reconcile()
        await drain()

        #expect(h.push.unregisterCount == 1)
        #expect(h.device.wanted == false)
        #expect(h.device.disablePending == false)
    }

    // 붙는 데 성공한 켜기는 끄다 만 것을 덮는다 — 남기면 다음 맞추기가 방금 붙인 것을 뗀다.
    @Test("켜기가 성공하면 끄다 만 표식을 지운다")
    func enableSupersedesPendingDisable() async {
        let h = Harness()
        h.device.disablePending = true

        let ok = await h.registration.enable()
        #expect(ok)
        #expect(h.device.disablePending == false)
        #expect(h.device.wanted)

        h.registration.reconcile()
        await drain()
        #expect(h.push.unregisterCount == 0)
    }

    @Test("떼지 못하면 표식이 남아 다음에 이어서 뗀다")
    func failedDisableLeavesMarker() async {
        let h = Harness(registered: true)
        h.push.unregisterThrows = true
        _ = await h.registration.disable()
        #expect(h.device.disablePending)

        h.push.unregisterThrows = false
        h.registration.reconcile()
        await drain()

        #expect(h.push.unregisterCount == 1)
        #expect(h.device.remembered == [false])
        #expect(h.device.disablePending == false)
    }

    // 되살리기와 끄기가 각자 출발하면 늦게 끝난 쪽이 먼저 끝난 쪽을 덮는다 — "끄기" 뒤에
    // 옛 등록이 끝나 토큰이 되살아나는 식이다. **한 줄로 선다.**
    @Test("되살리기가 진행 중이면 끄기는 그 뒤에 온다")
    func disableWaitsForResume() async {
        let h = Harness()
        let gate = Gate()
        h.device.gate = gate
        h.registration.reconcile()
        await drain()

        let disabling = Task { await h.registration.disable() }
        await drain()
        h.push.note("disable-requested")
        gate.open()
        _ = await disabling.value

        #expect(h.push.order == ["disable-requested", "register:fcm-1", "unregister"])
    }

    // 세션이 끝난 뒤 돌아온 앞 세션의 등록 결과는 버린다 — 다음 세션의 목록을 건드리면 안 된다.
    @Test("세션이 바뀌면 진행 중이던 등록의 결과를 버린다")
    func resetDropsInFlightResult() async {
        let h = Harness()
        let gate = Gate()
        h.device.gate = gate
        h.registration.reconcile()
        await drain()

        h.registration.reset()
        gate.open()
        await drain()

        // 서버 호출은 이미 나갔을 수 있지만, 그 뒤의 목록 갱신은 일어나지 않는다.
        #expect(!h.sessions.backgroundFlags.contains(true))
    }
}
