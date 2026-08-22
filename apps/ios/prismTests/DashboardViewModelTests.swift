//
//  DashboardViewModelTests.swift
//  prismTests
//
//  세션 카드의 상태 전이를 네트워크 없이 검증한다. 폐기는 되돌릴 수 없으므로,
//  실패했을 때 목록이 지워지거나 버튼이 잠긴 채로 남으면 사용자가 할 수 있는 일이 없다.
//

import Foundation
import Testing
@testable import prism

// MARK: - Fakes

private final class FakeSessions: SessionsServicing, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [SessionListItem]
    var failList = false
    var failAction = false
    private(set) var revoked: [String] = []
    private(set) var revokeAllCount = 0

    init(_ items: [SessionListItem]) {
        self.items = items
    }

    func sessions(accessToken: String) async throws -> [SessionListItem] {
        if failList { throw APIError.network }
        return lock.withLock { items }
    }

    func revoke(id: String, accessToken: String) async throws {
        if failAction { throw APIError.network }
        lock.withLock {
            revoked.append(id)
            items.removeAll { $0.id == id }
        }
    }

    func revokeAll(accessToken: String) async throws {
        if failAction { throw APIError.network }
        lock.withLock { revokeAllCount += 1 }
    }
}

private func item(
    _ id: String,
    current: Bool = false,
    device: DeviceKind = .desktop,
) -> SessionListItem {
    SessionListItem(
        id: id,
        startedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T12:00:00.000Z",
        isCurrent: current,
        device: device,
    )
}

@MainActor
private func makeViewModel(
    _ service: FakeSessions,
    token: String? = "tok",
    onEnded: @escaping () async -> Void = {},
) -> DashboardViewModel {
    DashboardViewModel(service: service, accessToken: { token }, onSessionEnded: onEnded)
}

// MARK: - Tests

@MainActor
struct DashboardViewModelTests {

    @Test("목록을 불러오면 세션이 채워진다")
    func loadsSessions() async {
        let service = FakeSessions([item("a", current: true), item("b")])
        let viewModel = makeViewModel(service)

        await viewModel.load()

        #expect(viewModel.sessions?.map(\.id) == ["a", "b"])
        #expect(viewModel.hasOthers)
        #expect(viewModel.loadErrorKey == nil)
    }

    @Test("현재 세션 하나뿐이면 모두 로그아웃을 내보내지 않는다")
    func aloneHasNoSignOutAll() async {
        let viewModel = makeViewModel(FakeSessions([item("only", current: true)]))

        await viewModel.load()

        // "나 혼자"는 빈 목록이 아니다 — 전체 폐기가 곧 로그아웃이라 버튼을 둘 이유가 없다.
        #expect(viewModel.sessions?.count == 1)
        #expect(!viewModel.hasOthers)
    }


    @Test("갱신은 실패해도 화면의 목록을 지우지 않는다")
    func refreshKeepsListOnFailure() async {
        let service = FakeSessions([item("a", current: true), item("b")])
        let viewModel = makeViewModel(service)
        await viewModel.load()
        service.failList = true

        await viewModel.refresh()

        // 비운 뒤 실패하면 볼 것도 재시도할 대상도 사라진다. 처음 불러오기(load)는 반대로
        // 비우는 것이 맞다 — 화면에 아직 아무것도 없는 자리이기 때문이다.
        #expect(viewModel.sessions?.map(\.id) == ["a", "b"])
        #expect(viewModel.loadErrorKey == .errorSessionsLoadFailed)
    }

    @Test("불러오기에 실패하면 오류만 남기고 목록은 비운다")
    func loadFailureShowsError() async {
        let service = FakeSessions([])
        service.failList = true
        let viewModel = makeViewModel(service)

        await viewModel.load()

        #expect(viewModel.sessions == nil)
        #expect(viewModel.loadErrorKey == .errorSessionsLoadFailed)
    }

    @Test("토큰이 없으면 요청하지 않고 오류로 떨어진다")
    func missingTokenFails() async {
        let viewModel = makeViewModel(FakeSessions([item("a")]), token: nil)

        await viewModel.load()

        #expect(viewModel.sessions == nil)
        #expect(viewModel.loadErrorKey == .errorSessionsLoadFailed)
    }

    @Test("다른 세션을 해제하면 목록을 다시 불러온다")
    func revokeReloads() async {
        let service = FakeSessions([item("me", current: true), item("other")])
        let viewModel = makeViewModel(service)
        await viewModel.load()

        await viewModel.revoke(item("other"))

        #expect(service.revoked == ["other"])
        // 로컬에서 행만 지우지 않고 서버에 다시 묻는다 — 그사이 목록이 달라질 수 있다.
        #expect(viewModel.sessions?.map(\.id) == ["me"])
        #expect(viewModel.revokingID == nil)
    }

    @Test("해제에 실패하면 목록을 유지한 채 오류만 알린다")
    func revokeFailureKeepsList() async {
        let service = FakeSessions([item("me", current: true), item("other")])
        let viewModel = makeViewModel(service)
        await viewModel.load()
        service.failAction = true

        await viewModel.revoke(item("other"))

        #expect(viewModel.actionErrorKey == .errorRevokeFailed)
        // 실패했는데 목록이 사라지면 다시 시도할 대상이 화면에서 없어진다.
        #expect(viewModel.sessions?.map(\.id) == ["me", "other"])
        #expect(viewModel.revokingID == nil)
    }

    @Test("현재 세션을 해제하면 세션이 끝났음을 알린다")
    func revokingCurrentEndsSession() async {
        let service = FakeSessions([item("me", current: true), item("other")])
        let ended = Counter()
        let viewModel = makeViewModel(service, onEnded: { await ended.bump() })
        await viewModel.load()

        await viewModel.revoke(item("me", current: true))

        // 내 토큰은 이미 무효다 — 목록을 다시 부르지 않고 세션의 주인에게 넘긴다.
        #expect(await ended.value == 1)
    }

    @Test("전체 로그아웃은 성공하면 세션이 끝났음을 알린다")
    func signOutAllEndsSession() async {
        let service = FakeSessions([item("me", current: true), item("other")])
        let ended = Counter()
        let viewModel = makeViewModel(service, onEnded: { await ended.bump() })

        await viewModel.signOutAll()

        #expect(service.revokeAllCount == 1)
        #expect(await ended.value == 1)
    }

    @Test("전체 로그아웃에 실패하면 버튼을 다시 열어 준다")
    func signOutAllFailureUnlocks() async {
        let service = FakeSessions([item("me", current: true), item("other")])
        service.failAction = true
        let viewModel = makeViewModel(service)

        await viewModel.signOutAll()

        // 잠긴 채로 두면 재시도할 방법이 없다.
        #expect(!viewModel.isSigningOutAll)
        #expect(viewModel.actionErrorKey == .errorRevokeFailed)
    }
}

/// 콜백 호출 횟수를 세는 액터 — 클로저가 여러 컨텍스트에서 불릴 수 있어 격리해 둔다.
private actor Counter {
    private(set) var value = 0
    func bump() { value += 1 }
}

// MARK: - 표기

@MainActor
struct DashboardFormatTests {

    @Test("밀리초가 있든 없든 파싱한다")
    func parsesBothIsoForms() {
        #expect(DashboardTimestamp.format("2026-08-20T12:08:26.806Z", locale: .ko)
            != "2026-08-20T12:08:26.806Z")
        #expect(DashboardTimestamp.format("2026-08-20T12:08:26Z", locale: .ko)
            != "2026-08-20T12:08:26Z")
    }

    @Test("형식을 벗어난 값은 원문을 그대로 보여준다")
    func passesThroughUnparsable() {
        // 빈칸으로 두면 무엇이 잘못됐는지 알 수 없고, 목록 전체를 실패시킬 이유도 없다.
        #expect(DashboardTimestamp.format("not-a-date", locale: .ko) == "not-a-date")
    }

    @Test("표기는 웹·Android와 같은 CLDR 형태다")
    func matchesOtherPlatforms() {
        // 웹 `Intl(dateStyle: medium, timeStyle: short)`·Android `DateFormat.MEDIUM/SHORT`가
        // 내는 문자열과 같아야 한다 — 셋을 나란히 놓고 보는 프로젝트다.
        // (시각대는 기기를 따르므로 날짜 부분만 본다.)
        #expect(DashboardTimestamp.format("2026-08-20T12:08:26Z", locale: .ko).contains("2026. 8."))
        #expect(DashboardTimestamp.format("2026-08-20T12:08:26Z", locale: .en).contains("Aug"))
        #expect(DashboardTimestamp.format("2026-08-20T12:08:26Z", locale: .ja).contains("2026/08"))
    }

    @Test("화면 언어를 따른다")
    func followsScreenLanguage() {
        let ko = DashboardTimestamp.format("2026-08-20T12:08:26Z", locale: .ko)
        let en = DashboardTimestamp.format("2026-08-20T12:08:26Z", locale: .en)
        // 기기 언어가 아니라 앱에서 고른 언어를 따라야 한다.
        #expect(ko != en)
    }

    @Test("라틴 이름은 두 단어의 첫 글자를 모은다")
    func latinInitials() {
        #expect(PrismAvatar.initials(of: "Alex Kim") == "AK")
        #expect(PrismAvatar.initials(of: "Demo") == "D")
    }

    @Test("한글 이름은 앞 한 글자만 쓴다")
    func koreanInitials() {
        // `정희석`을 `정희`로 자르면 이름이 아니라 다른 단어로 읽힌다.
        #expect(PrismAvatar.initials(of: "정희석") == "정")
        #expect(PrismAvatar.initials(of: "정 희석") == "정")
    }

    @Test("모르는 기기 종류는 unknown으로 접는다")
    func unknownDeviceKind() throws {
        // 갈래가 늘었다고 예전 앱에서 목록 전체가 실패하면 손해가 더 크다.
        let json = Data(#"[{"id":"a","startedAt":"x","expiresAt":"y","isCurrent":true,"device":"watch"}]"#.utf8)
        let list = try JSONDecoder().decode([SessionListItem].self, from: json)
        #expect(list.first?.device == .unknown)
    }

    @Test("이름이 비어 있으면 물음표로 떨어진다")
    func blankInitials() {
        #expect(PrismAvatar.initials(of: "   ") == "?")
    }
}
