//
//  AuthManagerTests.swift
//  prismTests
//
//  세션 복원/갱신의 자격증명 안전성 검증. 동시성 타이밍이 아니라 "무엇을 저장/삭제하고
//  어떤 상태로 가는가"라는 결정적 규칙을 가짜 서비스·저장소로 확인한다.
//

import Foundation
import Testing
@testable import prism

// MARK: - Fakes

/// 인메모리 자격증명 저장소. 저장·revoke·삭제 실패를 강제할 수 있다.
private final class FakeStore: CredentialStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession
    var failSave = false
    var failRevoke = false
    var failClear = false
    private(set) var clearCount = 0
    private(set) var revokeCount = 0

    init(_ initial: KeychainManager.Credentials? = nil) {
        session = initial.map(StoredSession.credentials) ?? StoredSession.none
    }

    func load() -> StoredSession { lock.withLock { session } }

    func save(_ credentials: KeychainManager.Credentials) -> Bool {
        lock.withLock {
            if failSave { return false }
            session = .credentials(credentials)
            return true
        }
    }

    func revoke() -> Bool {
        lock.withLock {
            revokeCount += 1
            if failRevoke { return false } // 마커 쓰기 실패 시 값이 그대로 남는다
            session = .revoked
            return true
        }
    }

    func clear() -> Bool {
        lock.withLock {
            clearCount += 1
            if failClear { return false } // 삭제 실패 시 값(또는 마커)이 남는다
            session = StoredSession.none
            return true
        }
    }
}

/// 응답을 미리 정해 두는 가짜 인증 서비스.
private final class FakeService: AuthServicing, @unchecked Sendable {
    var meResult: Result<SessionUser, Error> = .failure(APIError.network)
    var refreshResult: Result<AuthSession, Error> = .failure(APIError.network)
    var loginDemoResult: Result<AuthSession, Error> = .failure(APIError.network)
    /// 실제로 나간 회전 요청 수.
    private(set) var refreshCount = 0
    /// me를 붙잡아 "복원이 네트워크에 매달린" 순간을 재현한다(널이면 통과).
    var meGate: RefreshGate?

    func me(accessToken: String) async throws -> SessionUser {
        if let meGate { await meGate.enterAndWait() }
        return try meResult.get()
    }
    /// 마지막 회전이 **활동으로** 표시됐는지 — 앱 복원이 창을 미느냐가 여기서 갈린다.
    var lastRefreshActivity: Bool?
    func refresh(refreshToken: String, activity: Bool) async throws -> AuthSession {
        refreshCount += 1
        lastRefreshActivity = activity
        return try refreshResult.get()
    }
    func logout(accessToken: String?) async throws {}
    func loginDemo() async throws -> AuthSession { try loginDemoResult.get() }
    func loginWithApple(
        identityToken: String,
        nonce: String,
        name: AppleUserName?,
    ) async throws -> AuthSession {
        throw APIError.providerUnavailable
    }
}

/// 두 지점의 랑데부를 중재하는 게이트. refresh가 진입하면 신호를 보내고, 테스트가 열
/// 때까지 그 자리에서 기다린다 — "refresh in-flight 중 다른 액션" 같은 경쟁을 결정적으로
/// 재현한다. actor라 스레드 경계를 넘어도 안전하다.
private actor RefreshGate {
    private var entered = false
    private var enterWaiter: CheckedContinuation<Void, Never>?
    private var release: CheckedContinuation<Void, Never>?

    /// refresh 구현이 부른다: 진입을 알리고 open까지 멈춘다.
    func enterAndWait() async {
        entered = true
        enterWaiter?.resume()
        enterWaiter = nil
        await withCheckedContinuation { release = $0 }
    }

    /// 테스트가 부른다: refresh가 진입할 때까지 기다린다.
    func waitUntilEntered() async {
        if entered { return }
        await withCheckedContinuation { enterWaiter = $0 }
    }

    /// 테스트가 부른다: 멈춰 있던 refresh를 진행시킨다.
    func open() { release?.resume(); release = nil }
}

/// refresh를 게이트로 붙잡는 서비스. me는 즉시 sessionExpired를 돌려줘 refresh로 이어진다.
private final class GatedService: AuthServicing, @unchecked Sendable {
    let gate = RefreshGate()
    var refreshResult: Result<AuthSession, Error>
    /// 실제로 나간 회전 요청 수 — 복원과 401이 같은 문을 쓰는지 세어서 본다.
    private(set) var refreshCount = 0

    init(refreshResult: Result<AuthSession, Error>) {
        self.refreshResult = refreshResult
    }

    func me(accessToken: String) async throws -> SessionUser {
        throw APIError(status: 401, code: AuthErrorCode.sessionExpired)
    }

    func refresh(refreshToken: String, activity: Bool) async throws -> AuthSession {
        refreshCount += 1
        await gate.enterAndWait()
        return try refreshResult.get()
    }

    func logout(accessToken: String?) async throws {}
    func loginWithApple(
        identityToken: String,
        nonce: String,
        name: AppleUserName?,
    ) async throws -> AuthSession {
        throw APIError.providerUnavailable
    }
}

/// 첫 회전은 네트워크 실패, 그다음부터는 성공. "일시적 실패 뒤에도 다시 시도하는가"를
/// 실제로 돌려 본다.
private final class FlakyRefreshService: AuthServicing, @unchecked Sendable {
    private(set) var refreshCount = 0
    private let rotated: AuthSession

    init(rotated: AuthSession) { self.rotated = rotated }

    func me(accessToken: String) async throws -> SessionUser { throw APIError.network }
    func refresh(refreshToken: String, activity: Bool) async throws -> AuthSession {
        refreshCount += 1
        if refreshCount == 1 { throw APIError.network }
        return rotated
    }
    func logout(accessToken: String?) async throws {}
    func loginDemo() async throws -> AuthSession {
        AuthSession(
            accessToken: "a", refreshToken: "r",
            user: user(), accessTokenTtlMs: 900_000,
        )
    }
    func loginWithApple(
        identityToken: String,
        nonce: String,
        name: AppleUserName?,
    ) async throws -> AuthSession {
        throw APIError.providerUnavailable
    }
}

/// 회전과 데모 로그인을 **각각** 게이트로 붙잡는 서비스. "회전이 네트워크에 매달린 사이
/// 새 로그인이 시작된" 순간을 정확히 재현한다.
private final class RotateDuringLoginService: AuthServicing, @unchecked Sendable {
    let refreshGate = RefreshGate()
    let loginGate = RefreshGate()
    private let rotated: AuthSession
    private let issued: AuthSession

    init(rotated: AuthSession, issued: AuthSession) {
        self.rotated = rotated
        self.issued = issued
    }

    func me(accessToken: String) async throws -> SessionUser {
        throw APIError(status: 401, code: AuthErrorCode.sessionExpired)
    }
    func refresh(refreshToken: String, activity: Bool) async throws -> AuthSession {
        await refreshGate.enterAndWait()
        return rotated
    }
    func loginDemo() async throws -> AuthSession {
        await loginGate.enterAndWait()
        return issued
    }
    func logout(accessToken: String?) async throws {}
    func loginWithApple(
        identityToken: String,
        nonce: String,
        name: AppleUserName?,
    ) async throws -> AuthSession {
        throw APIError.providerUnavailable
    }
}

/// logout을 게이트로 붙잡는 서비스. "네트워크 대기 중"을 재현해, 그 시점 저장소 상태를
/// 검사할 수 있게 한다(로그아웃 의도가 네트워크 전에 남았는지).
private final class GatedLogoutService: AuthServicing, @unchecked Sendable {
    let gate = RefreshGate()

    func me(accessToken: String) async throws -> SessionUser { throw APIError.network }
    func refresh(refreshToken: String, activity: Bool) async throws -> AuthSession { throw APIError.network }
    func logout(accessToken: String?) async throws { await gate.enterAndWait() }
    func loginWithApple(
        identityToken: String,
        nonce: String,
        name: AppleUserName?,
    ) async throws -> AuthSession {
        throw APIError.providerUnavailable
    }
}

private func user(_ id: String = "u1", _ provider: AuthProvider = .apple) -> User {
    User(id: id, provider: provider, displayName: "Member", createdAt: "2026-01-01T00:00:00Z")
}

private func creds(_ access: String, _ refresh: String) -> KeychainManager.Credentials {
    .init(accessToken: access, refreshToken: refresh)
}

@MainActor
private func makeManager(
    _ service: AuthServicing,
    _ store: FakeStore,
) -> AuthManager {
    AuthManager(
        service: service,
        keychain: store,
        appleSignIn: AppleSignInController(),
    )
}

/// 저장된 액세스 토큰이 기대값이 될 때까지 (상한을 두고) 기다린다.
@MainActor
private func waitForAccessToken(_ store: FakeStore, _ expected: String) async {
    for _ in 0 ..< 200 {
        if store.load().credentials?.accessToken == expected { return }
        try? await Task.sleep(for: .milliseconds(10))
    }
}

// MARK: - Tests

@MainActor
@Suite("auth manager session")
struct AuthManagerTests {
    @Test("저장된 자격증명으로 세션을 복원한다")
    func restoresSession() async {
        let service = FakeService()
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 900_000))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.state == .signedIn(user()))
    }

    @Test("자격증명이 없으면 로그인 화면으로")
    func signedOutWithoutCredentials() async {
        let manager = makeManager(FakeService(), FakeStore(nil))
        await manager.restoreSession()
        #expect(manager.state == .signedOut)
    }

    @Test("확정 인증 실패(INVALID_TOKEN)는 자격증명을 지운다")
    func discardsOnDefinitiveFailure() async {
        let service = FakeService()
        service.meResult = .failure(APIError(status: 401, code: AuthErrorCode.invalidToken))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.state == .signedOut)
        // 확정 무효는 revoke 마커로 durable하게 남긴다(삭제가 아니라 — 옛 항목을 가려 부활 차단).
        #expect(store.load() == StoredSession.revoked)
        #expect(store.revokeCount == 1)
    }

    // #3 회귀: 일시적 실패(네트워크·5xx)는 자격증명을 보존해야 오프라인 실행이
    // 유효 세션을 파괴하지 않는다.
    @Test("일시적 실패(네트워크)는 자격증명을 보존한다")
    func keepsCredentialsOnTransientFailure() async {
        let service = FakeService()
        service.meResult = .failure(APIError.network)
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.state == .signedOut)
        #expect(store.load() == .credentials(creds("a", "r"))) // 그대로 남아 있다
        #expect(store.clearCount == 0)
    }

    @Test("데모 로그인은 서버가 준 Bearer 세션을 저장하고 signedIn으로 전환한다")
    func demoSignInPersistsBearerSession() async {
        let service = FakeService()
        let demoUser = user("demo1", .demo)
        service.loginDemoResult = .success(AuthSession(
            accessToken: "da", refreshToken: "dr",
            user: demoUser, accessTokenTtlMs: 900_000,
        ))
        let store = FakeStore(nil)
        let manager = makeManager(service, store)

        try? await manager.signIn(with: .demo)
        #expect(manager.state == .signedIn(demoUser))
        // 다른 네이티브 경로와 똑같이 토큰을 Keychain에 담는다(쿠키 아님).
        #expect(store.load() == .credentials(creds("da", "dr")))
    }


    // 화면을 쓰는 도중 액세스 토큰이 만료되는 흔한 경우. 앱 시작·복귀에서만 갱신하면
    // 그사이의 401은 그냥 실패로 보이고, 사용자가 할 수 있는 일은 앱을 껐다 켜는 것뿐이다.

    // 다른 기기에서 이 세션을 해제하면 갱신으로는 살아나지 않는다. 화면이 "불러오지
    // 못했습니다"를 띄우고 마는 대신 세션을 끝내야 로그인 화면으로 돌아간다.
    @Test("서버가 거부한 세션은 자격증명을 지우고 로그인 화면으로 보낸다")
    func endSessionSignsOut() async {
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(FakeService(), store)

        await manager.endSession(mark: manager.sessionMark(usedAccessToken: "a")!, usedAccessToken: "a")

        #expect(manager.state == .signedOut)
        #expect(store.load() == .none)
    }

    // 그사이 새 세션이 들어왔다면 낡은 응답이 그것을 끊어서는 안 된다.
    @Test("이미 다른 세션으로 갈렸으면 끝내지 않는다")
    func endSessionIgnoresStaleToken() async {
        let store = FakeStore(creds("a2", "r2"))
        let manager = makeManager(FakeService(), store)

        // 표식은 살아 있지만(같은 세대) 토큰이 이미 갈렸다.
        let mark = manager.sessionMark(usedAccessToken: "a2")!
        await manager.endSession(mark: mark, usedAccessToken: "a")

        #expect(store.load() == .credentials(creds("a2", "r2")))
    }

    @Test("401을 만난 요청을 위해 갱신하고 새 토큰을 돌려준다")
    func refreshForRetryRotates() async {
        let service = FakeService()
        service.refreshResult = .success(AuthSession(
            accessToken: "a2", refreshToken: "r2",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        let rotated = await manager.refreshForRetry(
            mark: manager.sessionMark(usedAccessToken: "a")!, usedAccessToken: "a",
        )

        #expect(rotated == "a2")
        #expect(store.load() == .credentials(creds("a2", "r2")))
    }

    // 여러 요청이 동시에 401을 받았을 때, 각자 갱신하면 회전한 refresh token으로 두 번째가
    // 거부되어 멀쩡한 세션이 끊긴다. 먼저 갱신한 결과를 그대로 쓴다.
    @Test("이미 다른 요청이 갱신했으면 그 토큰을 쓰고 다시 갱신하지 않는다")
    func refreshForRetryReusesAnotherRotation() async {
        let service = FakeService()
        service.refreshResult = .success(AuthSession(
            accessToken: "a3", refreshToken: "r3",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        // 저장된 값이 이미 갈려 있다 — 내가 실패시킨 토큰은 옛것이다.
        let store = FakeStore(creds("a2", "r2"))
        let manager = makeManager(service, store)

        let rotated = await manager.refreshForRetry(
            mark: manager.sessionMark(usedAccessToken: "a2")!, usedAccessToken: "a",
        )

        #expect(rotated == "a2")
        // 갱신이 나가지 않았으므로 저장된 값도 그대로다.
        #expect(store.load() == .credentials(creds("a2", "r2")))
    }

    // 갱신이 실패했는데 옛 토큰을 돌려주면 같은 401이 한 번 더 날 뿐이다.
    @Test("갱신하지 못하면 nil을 돌려준다")
    func refreshForRetryGivesUp() async {
        let service = FakeService()
        service.refreshResult = .failure(APIError.network)
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        #expect(await manager.refreshForRetry(
            mark: manager.sessionMark(usedAccessToken: "a")!, usedAccessToken: "a",
        ) == nil)
        // 오프라인·5xx로 갱신이 실패했다고 로그인 화면으로 쫓아내지 않는다 —
        // 자격증명은 아직 살아 있을 수 있고, 화면은 오류만 보여 주면 된다.
        #expect(store.load() == .credentials(creds("a", "r")))
    }

    // 확정 거부는 반대다 — 되살릴 수 없는 세션이라 자격증명을 버리고 로그인 화면으로.
    @Test("갱신이 확정 거부되면 자격증명을 버리고 로그인 화면으로 보낸다")
    func refreshForRetryRejected() async throws {
        let service = FakeService()
        service.loginDemoResult = .success(AuthSession(
            accessToken: "a", refreshToken: "r",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        service.refreshResult = .failure(
            APIError(status: 401, code: AuthErrorCode.unauthorized),
        )
        let store = FakeStore()
        let manager = makeManager(service, store)

        // 로그인된 화면을 보고 있다가 끊기는 상황이다 — 그래서 설명이 필요하다.
        try await manager.signIn(with: .demo)
        #expect(await manager.refreshForRetry(
            mark: manager.sessionMark(usedAccessToken: "a")!, usedAccessToken: "a",
        ) == nil)

        #expect(manager.state == .signedOut)
        #expect(store.load() == .revoked)
        #expect(manager.endedUnexpectedly)
    }

    // 같은 만료를 예약 타이머·화면 요청·복원이 동시에 발견할 수 있다. 알릴지를 **경로**로
    // 정하면 누가 먼저 처리하느냐에 따라 같은 상황이 조용했다 시끄러웠다 한다 — 기준은
    // "무엇을 보고 있었는가"다. 로그인된 화면에서 끊겼으면 누가 발견했든 알린다.
    @Test("보내기 전 회전이 거부되면 로그인된 화면이었으므로 알린다")
    func rejectedRotationIsAnnounced() async throws {
        let service = FakeService()
        service.loginDemoResult = .success(AuthSession(
            accessToken: "a", refreshToken: "r",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        service.refreshResult = .failure(
            APIError(status: 401, code: AuthErrorCode.unauthorized),
        )
        let store = FakeStore()
        let manager = makeManager(service, store)

        try await manager.signIn(with: .demo)
        // 요청 경로가 만료를 보고 회전을 부르는 그 지점이다(NetworkManager.perform).
        let mark = manager.sessionMark(usedAccessToken: "a")
        #expect(mark != nil)
        _ = await manager.refreshForRetry(mark: mark!, usedAccessToken: "a")

        #expect(manager.state == .signedOut)
        #expect(manager.endedUnexpectedly)
    }

    // ⚠️ 회귀 방지: 앱을 다시 여는 것은 **활동**이다. 그런데 복원은 만료를 만나면 회전으로
    // 끝나고 다시 보호된 요청을 보내지 않는다 — 그 회전이 활동임을 알리지 않으면, 앱을
    // 열어 둔 채로 유휴 만료를 맞는다(plan/auth.md §6).
    @Test("복원이 만료를 만나 회전하면 그 회전은 활동이다")
    func restoreRotationCountsAsActivity() async {
        let service = FakeService()
        service.meResult = .failure(APIError(status: 401, code: AuthErrorCode.sessionExpired))
        service.refreshResult = .success(AuthSession(
            accessToken: "a2", refreshToken: "r2",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        let manager = makeManager(service, FakeStore(creds("a", "r")))

        await manager.restoreSession()

        #expect(service.lastRefreshActivity == true)
    }

    // 스스로 누른 로그아웃은 설명할 것이 없다.
    @Test("스스로 로그아웃한 것은 알리지 않는다")
    func deliberateSignOutIsNotAnnounced() async {
        let manager = makeManager(FakeService(), FakeStore(creds("a", "r")))

        await manager.signOut()

        #expect(manager.state == .signedOut)
        #expect(manager.endedUnexpectedly == false)
    }

    // 앱을 켤 때의 실패는 알리지 않는다 — 그 자리는 자격증명이 아예 없는 첫 방문과
    // 구분되지 않아, 처음 온 사람에게 엉뚱한 안내가 뜬다.
    @Test("복원이 실패해서 로그인 화면으로 가는 것은 알리지 않는다")
    func restoreFailureIsNotAnnounced() async {
        let service = FakeService()
        service.meResult = .failure(APIError(status: 401, code: AuthErrorCode.sessionExpired))
        service.refreshResult = .failure(
            APIError(status: 401, code: AuthErrorCode.unauthorized),
        )
        let manager = makeManager(service, FakeStore(creds("a", "r")))

        await manager.restoreSession()

        #expect(manager.state == .signedOut)
        #expect(manager.endedUnexpectedly == false)
    }

    @Test("자격증명이 없으면 갱신할 것도 없다")
    func refreshForRetryWithoutCredentials() async {
        let manager = makeManager(FakeService(), FakeStore(.none))

        // 되살릴 세션이 없으니 표식도 없다.
        #expect(manager.sessionMark(usedAccessToken: "a") == nil)
        #expect(await manager.refreshForRetry(mark: 0, usedAccessToken: "a") == nil)
    }

    // 함께 나간 두 요청이 같은 토큰을 들고 있다가 하나가 먼저 회전시키면, 나머지는 이미
    // 물러난 토큰을 들고 있다. 그것을 "남의 세션"으로 보면 되살릴 수 있는 401이 그냥
    // 실패가 된다 — 물러난 토큰도 이 세션이 발급한 것이다.
    @Test("회전 직전의 토큰으로 나간 요청도 되살아난다")
    func supersededTokenStillBelongsToThisSession() async {
        let service = FakeService()
        service.refreshResult = .success(AuthSession(
            accessToken: "a2", refreshToken: "r2",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        // 첫 요청이 회전시킨다.
        let mark = manager.sessionMark(usedAccessToken: "a")!
        #expect(await manager.refreshForRetry(mark: mark, usedAccessToken: "a") == "a2")

        // 뒤늦게 출발한 두 번째 요청은 아직 "a"를 들고 있다.
        #expect(manager.sessionMark(usedAccessToken: "a") == mark)
        // 이미 갈려 있으므로 갱신 없이 회전된 토큰으로 재시도한다.
        #expect(await manager.refreshForRetry(mark: mark, usedAccessToken: "a") == "a2")
        #expect(service.refreshCount == 1)
    }

    // 앞 세션의 확인이 뒤늦게 확정 실패로 돌아왔을 때, 버릴 자격증명이 이미 남의 것이면
    // **아무것도 건드리지 않아야 한다.** 소유권을 보기 전에 타이머부터 끄면, 멀쩡히
    // 로그인된 새 세션의 선제 갱신만 죽어 방치된 화면이 idle 창에서 조용히 만료된다.
    @Test("남의 자격증명을 버리려다 지금 세션의 회전을 막지 않는다")
    func staleDiscardKeepsTheCurrentSessionRotatable() async {
        let service = FakeService()
        let gate = RefreshGate()
        service.meGate = gate
        // 앞 세션의 확인은 확정 실패로 끝난다(폐기·변조).
        service.meResult = .failure(APIError(status: 401, code: AuthErrorCode.invalidToken))
        service.loginDemoResult = .success(AuthSession(
            accessToken: "b", refreshToken: "br",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        // 회전은 처음엔 실패한다 — 세션이 살아남는지만 보고 싶기 때문이다.
        service.refreshResult = .failure(APIError.network)
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        // 앞 세션의 확인이 네트워크에 매달린다.
        let restore = Task { await manager.restoreSession() }
        await gate.waitUntilEntered()

        // 그 사이 새로 로그인한다.
        try? await manager.signIn(with: .demo)
        #expect(manager.state == .signedIn(user()))

        // 이제 앞 세션의 확인이 확정 실패로 돌아온다.
        await gate.open()
        await restore.value
        #expect(manager.state == .signedIn(user()))          // 새 세션은 그대로다
        #expect(store.load() == .credentials(creds("b", "br"))) // 자격증명도 그대로다

        // 연결이 돌아오면 새 세션은 여전히 회전할 수 있어야 한다 —
        // 앞 세션의 정리가 이쪽 표식까지 무효로 만들지 않았다는 뜻이다.
        service.refreshResult = .success(AuthSession(
            accessToken: "b2", refreshToken: "br2",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        let mark = manager.sessionMark(usedAccessToken: "b")
        #expect(mark != nil)
        #expect(await manager.refreshForRetry(mark: mark!, usedAccessToken: "b") == "b2")
        #expect(store.load() == .credentials(creds("b2", "br2")))
    }

    // 회전이 네트워크에 매달린 사이 새 로그인이 시작되면 세대는 이미 올라가 있다. 그때
    // 물러난 토큰을 **지금 세대**에 적으면, 끝난 세션의 토큰이 다음 세션의 이름표를 받아
    // 옛 요청이 새 계정에서 재생된다.
    @Test("로그인 중에 끝난 회전은 다음 세션에 흔적을 남기지 않는다")
    func rotationFinishingDuringLoginCannotPoisonNextSession() async {
        let service = RotateDuringLoginService(
            rotated: AuthSession(
                accessToken: "a2", refreshToken: "r2",
                user: user(), accessTokenTtlMs: 900_000,
            ),
            issued: AuthSession(
                accessToken: "b", refreshToken: "br",
                user: user(), accessTokenTtlMs: 900_000,
            ),
        )
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        // 복원이 회전에 들어가 멈춘다.
        let restore = Task { await manager.restoreSession() }
        await service.refreshGate.waitUntilEntered()

        // 그 사이 새 로그인이 시작된다 — 세대가 오르고, 채택 직전에서 멈춘다.
        let login = Task { try? await manager.signIn(with: .demo) }
        await service.loginGate.waitUntilEntered()

        // 회전이 먼저 끝난다. 저장된 자격증명이 아직 앞 세션의 것이라 저장에는 성공한다.
        await service.refreshGate.open()
        await restore.value

        // 이제 새 세션이 채택된다.
        await service.loginGate.open()
        await login.value
        #expect(manager.state == .signedIn(user()))
        #expect(store.load() == .credentials(creds("b", "br")))

        // 앞 세션의 토큰들은 새 세션의 표식을 받을 수 없다.
        #expect(manager.sessionMark(usedAccessToken: "a") == nil)
        #expect(manager.sessionMark(usedAccessToken: "a2") == nil)
        #expect(manager.sessionMark(usedAccessToken: "b") != nil)
    }

    // 로그인·로그아웃이 도는 동안에는 이 요청이 어느 세션으로 끝날지 아직 모른다.
    @Test("사용자 액션이 도는 동안에는 표식을 주지 않는다")
    func noMarkWhileAnAuthActionIsInFlight() async {
        let service = GatedLogoutService()
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        #expect(manager.sessionMark(usedAccessToken: "a") != nil)

        let signOut = Task { await manager.signOut() }
        await service.gate.waitUntilEntered()
        #expect(manager.sessionMark(usedAccessToken: "a") == nil)

        await service.gate.open()
        await signOut.value
    }

    // 요청을 보낸 뒤 응답이 돌아오기 전에 로그아웃하고 다시 로그인하면, 그 401은 **끝난
    // 세션**의 것이다. 토큰만 비교하면 회전과 구분되지 않아, 옛 요청이 새 세션의 토큰으로
    // 재생될 수 있었다.
    @Test("낡은 표식으로 온 401은 새 세션을 건드리지 않는다")
    func staleMarkCannotTouchANewSession() async throws {
        let service = FakeService()
        service.loginDemoResult = .success(AuthSession(
            accessToken: "a", refreshToken: "r",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        let store = FakeStore()
        let manager = makeManager(service, store)

        try await manager.signIn(with: .demo)
        let stale = try #require(manager.sessionMark(usedAccessToken: "a"))

        // 그사이 로그아웃 → 다시 로그인. 여기서부터는 다른 세션이다.
        await manager.signOut()
        service.loginDemoResult = .success(AuthSession(
            accessToken: "b", refreshToken: "br",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        try await manager.signIn(with: .demo)

        // 회전도, 종료도 하지 않는다 — 새 세션은 그대로 살아 있다.
        #expect(await manager.refreshForRetry(mark: stale, usedAccessToken: "a") == nil)
        await manager.endSession(mark: stale, usedAccessToken: "a")

        #expect(manager.state == .signedIn(user()))
        #expect(store.load() == .credentials(creds("b", "br")))
    }

    @Test("만료된 액세스 토큰은 갱신으로 이어 회전된 토큰을 저장한다")
    func refreshesAndPersistsRotatedTokens() async {
        let service = FakeService()
        service.meResult = .failure(APIError(status: 401, code: AuthErrorCode.sessionExpired))
        service.refreshResult = .success(AuthSession(
            accessToken: "a2", refreshToken: "r2",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.state == .signedIn(user()))
        // A: 회전된 새 토큰이 저장돼야 다음 갱신이 성립한다.
        #expect(store.load() == .credentials(creds("a2", "r2")))
    }

    // B: 회전된 토큰을 저장하지 못하면(Keychain 장애) 세션을 이을 수 없으므로 지운다 —
    // 옛 토큰은 이미 서버에서 죽었기 때문이다.
    @Test("회전 토큰 저장 실패 시 자격증명을 지운다")
    func discardsWhenRotatedSaveFails() async {
        let service = FakeService()
        service.meResult = .failure(APIError(status: 401, code: AuthErrorCode.sessionExpired))
        service.refreshResult = .success(AuthSession(
            accessToken: "a2", refreshToken: "r2",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        let store = FakeStore(creds("a", "r"))
        store.failSave = true
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.state == .signedOut)
        #expect(store.revokeCount == 1) // 마커로 무효화
    }

    @Test("갱신이 확정 실패면 자격증명을 지운다")
    func discardsWhenRefreshRejected() async {
        let service = FakeService()
        service.meResult = .failure(APIError(status: 401, code: AuthErrorCode.sessionExpired))
        service.refreshResult = .failure(APIError(status: 401, code: AuthErrorCode.unauthorized))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.state == .signedOut)
        #expect(store.load() == StoredSession.revoked)
    }

    @Test("갱신이 일시적 실패면 자격증명을 보존한다")
    func keepsCredentialsWhenRefreshTransient() async {
        let service = FakeService()
        service.meResult = .failure(APIError(status: 401, code: AuthErrorCode.sessionExpired))
        service.refreshResult = .failure(APIError.network)
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.state == .signedOut)
        #expect(store.load() == .credentials(creds("a", "r")))
    }

    // D: 로그아웃 뒤에 뒤늦게 끝난 복원이 세션을 되살리면 안 된다. 로그아웃이 세대를
    // 올리므로, 그 전에 시작해 나중에 끝난 확인 결과는 버려진다.
    @Test("로그아웃은 진행 중이던 복원 결과를 이긴다")
    func signOutBeatsInFlightRestore() async {
        let service = FakeService()
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 900_000))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)
        await manager.restoreSession()
        #expect(manager.state == .signedIn(user()))

        await manager.signOut()
        #expect(manager.state == .signedOut)
        #expect(store.load() == StoredSession.revoked) // 로그아웃 마커
    }

    // #1·#3 결정적 경쟁: refresh가 in-flight인 동안 로그아웃이 끼어든다. refresh는
    // 취소되지 않고 끝까지 완료되지만, 로그아웃이 자격증명을 이미 지웠으므로 회전된 새
    // 토큰을 **되살리지 않는다**(우리가 보낸 값이 더는 현재값이 아니다). 최종은 로그아웃.
    @Test("refresh in-flight 중 로그아웃하면 회전 토큰을 되살리지 않는다")
    func refreshInFlightThenSignOutDoesNotResurrect() async {
        let service = GatedService(refreshResult: .success(AuthSession(
            accessToken: "a2", refreshToken: "r2",
            user: user(), accessTokenTtlMs: 900_000,
        )))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        // 복원을 띄운다 → me가 sessionExpired → refresh가 게이트에서 멈춘다.
        let restore = Task { await manager.restoreSession() }
        await service.gate.waitUntilEntered()

        // refresh가 멈춰 있는 동안 로그아웃한다(revoke 마커 + signedOut).
        await manager.signOut()
        #expect(manager.state == .signedOut)
        #expect(store.load() == StoredSession.revoked)

        // 멈춰 있던 refresh를 진행시킨다 — 회전된 a2/r2를 저장하면 안 된다(로그아웃됨).
        await service.gate.open()
        await restore.value

        #expect(manager.state == .signedOut)
        #expect(store.load() == StoredSession.revoked) // a2/r2가 되살아나지 않았다
    }

    // 서버는 리프레시 자격증명을 **1회용**으로 회전한다. 포그라운드 복귀의 복원과 화면의
    // 401이 각자 회전을 띄우면 같은 값을 둘이 써서 재사용 탐지에 걸리고, 멀쩡한 세션이
    // 끊긴다. 두 경로는 같은 문을 써야 한다.
    @Test("복원과 401 재시도는 회전을 한 번만 내보낸다")
    func restoreAndRetryShareOneRotation() async {
        let service = GatedService(refreshResult: .success(AuthSession(
            accessToken: "a2", refreshToken: "r2",
            user: user(), accessTokenTtlMs: 900_000,
        )))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        // 복원을 띄운다 → me가 sessionExpired → 회전이 게이트에서 멈춘다.
        let restore = Task { await manager.restoreSession() }
        await service.gate.waitUntilEntered()

        // 그 사이 화면의 요청이 401을 만난다 — 같은 회전에 합류해야 한다.
        let mark = manager.sessionMark(usedAccessToken: "a")!
        let retry = Task { await manager.refreshForRetry(mark: mark, usedAccessToken: "a") }

        await service.gate.open()
        let rotated = await retry.value
        await restore.value

        #expect(service.refreshCount == 1) // 1회용 자격증명을 두 번 쓰지 않았다
        #expect(rotated == "a2")           // 재시도는 회전된 토큰으로 나간다
        #expect(manager.state == .signedIn(user()))
    }

    // ⚠️ 회귀 방지: 타이머로 미리 회전하면 요청이 없는 동안에도 세션이 밀려
    // idle 타임아웃이 무의미해진다 — 화면만 열어두면 absolute 상한까지 살아 있게 된다.
    // 회전은 **요청이 있을 때만**, 만료가 임박했을 때 보내기 직전에 한다.
    @Test("수명이 넉넉하면 만료 임박이 아니다")
    func farFromExpiryNeedsNoRotation() async {
        let service = FakeService()
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 900_000))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.state == .signedIn(user()))
        #expect(manager.isNearExpiry() == false)
    }

    @Test("수명이 여유보다 짧으면 만료 임박이다")
    func nearExpiryAsksForRotation() async {
        let service = FakeService()
        // 여유(5초)보다 짧은 수명 — 다음 요청은 보내기 전에 회전해야 한다.
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 1_000))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.state == .signedIn(user()))
        #expect(manager.isNearExpiry())
    }

    // 서버가 수명을 알려 주지 않으면(이 필드가 생기기 전 서버) 모르는 채로 둔다 —
    // 지어내서 헛 회전하지 않고, 만료 대응은 전부 반응형 401 경로가 맡는다.
    @Test("수명을 모르면 선제 회전을 걸지 않는다")
    func unknownLifetimeNeverRotatesEarly() async {
        let service = FakeService()
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 0))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.isNearExpiry() == false)
    }

    // 세션이 끝났는데 만료 시각이 남아 있으면, 다음 세션의 첫 요청이 낡은 값을 보고
    // 헛 회전한다.
    @Test("로그아웃하면 만료 시각을 잊는다")
    func signOutForgetsExpiry() async {
        let service = FakeService()
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 1_000))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.restoreSession()
        #expect(manager.isNearExpiry())

        await manager.signOut()
        #expect(manager.isNearExpiry() == false)
    }

    // 라운드5/6(정합성): 로그아웃은 revoke 마커를 durable하게 남긴다. 마커는 다음 로그인
    // 전까지 영구 지키개로 남아, 서버 세션이 살아 있어도(재실행·재설치) 부활을 막는다.
    @Test("로그아웃 마커는 다음 복원에서 세션을 되살리지 않는다")
    func revokedMarkerBlocksResurrection() async {
        let service = FakeService()
        // 서버 세션은 살아 있다 — 복원하면 signedIn이 될 상황.
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 900_000))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        await manager.signOut()
        #expect(manager.state == .signedOut)
        #expect(store.load() == StoredSession.revoked) // durable 마커

        // 다음 복원: 마커가 있어 /auth/me를 부르지 않고 signedOut을 유지한다.
        await manager.restoreSession()
        #expect(manager.state == .signedOut)
        #expect(store.load() == StoredSession.revoked) // 마커는 다음 로그인까지 남는다
    }

    // 마커는 정상 경로에서 지우지 않으므로, clear가 계속 실패하는 것과 무관하게 안전하다.
    @Test("clear 실패와 무관하게 revoked 마커가 유지된다")
    func revokedMarkerSurvivesClearFailure() async {
        let service = FakeService()
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 900_000))
        let store = FakeStore(creds("a", "r"))
        store.failClear = true
        let manager = makeManager(service, store)

        await manager.signOut() // revoke 성공 → 마커, clear는 호출도 안 함
        #expect(store.load() == StoredSession.revoked)
        #expect(store.clearCount == 0) // revoke 성공 경로는 clear를 부르지 않는다
        await manager.restoreSession()
        #expect(manager.state == .signedOut)
        #expect(store.load() == StoredSession.revoked)
    }

    // 라운드6 버그1: 로그아웃 의도를 **네트워크 전에** durable하게 남긴다 — logout 요청
    // 대기 중 앱이 죽어도 남은 값으로 세션이 부활하지 않는다.
    @Test("로그아웃은 네트워크 전에 세션을 revoke한다")
    func revokesBeforeNetwork() async {
        let service = GatedLogoutService()
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        let out = Task { await manager.signOut() }
        // logout이 시작됐다 = 그 전에 revoke가 이미 끝났다.
        await service.gate.waitUntilEntered()
        #expect(store.load() == StoredSession.revoked)

        await service.gate.open()
        await out.value
        #expect(store.load() == StoredSession.revoked) // 마커는 지키개로 남는다
    }

    // 라운드6 버그3: revoked 마커는 Keychain에 살아 재설치(새 매니저·다른 UserDefaults)
    // 에도 로그아웃 의도를 지킨다 — 서버 세션이 살아 있어도 부활하지 않는다.
    @Test("revoked 마커는 재설치에도 세션을 안 되살린다")
    func revokedSurvivesReinstall() async {
        let store = FakeStore(creds("a", "r"))
        store.failClear = true // 삭제는 실패해도 마커는 남는다
        let first = makeManager(FakeService(), store)
        await first.signOut()
        #expect(store.load() == StoredSession.revoked)

        // "재설치" = Keychain(store)은 잔존하지만 매니저는 새로. 서버 세션도 살아 있음.
        let service = FakeService()
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 900_000))
        let reinstalled = makeManager(service, store)
        await reinstalled.restoreSession()
        #expect(reinstalled.state == .signedOut) // 마커 덕에 부활 안 함
    }

    // 라운드7 문제1: revoke(마커 쓰기)가 실패하면 로그아웃이 clear(삭제)로 폴백해
    // 자격증명을 없앤다 — 남은 값으로 부활하지 않게.
    @Test("revoke 실패 시 로그아웃이 clear로 자격증명을 지운다")
    func signOutFallsBackToClearWhenRevokeFails() async {
        let store = FakeStore(creds("a", "r"))
        store.failRevoke = true // 마커를 못 남긴다
        let manager = makeManager(FakeService(), store)

        await manager.signOut()
        #expect(manager.state == .signedOut)
        #expect(store.load() == StoredSession.none) // clear가 지웠다
    }

    // revoke도 clear도 실패하는 극단(Keychain을 쓰지도 지우지도 못함)에서는 로컬 로그아웃을
    // 기록할 수 없다. 거짓 signedOut을 게시하지 않고 현재 상태를 유지한다(재시도 가능,
    // 서버가 폐기했다면 다음 확인이 self-healing). 자격증명도 그대로 남는다(불가피).
    @Test("revoke·clear 모두 실패하면 거짓 signedOut을 게시하지 않는다")
    func signOutKeepsStateWhenKeychainFullyBroken() async {
        let service = FakeService()
        service.meResult = .success(SessionUser(user: user(), accessTokenTtlMs: 900_000))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)
        await manager.restoreSession()
        #expect(manager.state == .signedIn(user()))

        store.failRevoke = true
        store.failClear = true
        await manager.signOut()
        // 로컬에 로그아웃을 남기지 못했다 — signedIn을 유지한다(거짓 signedOut 금지).
        #expect(manager.state == .signedIn(user()))
        #expect(store.load() == .credentials(creds("a", "r"))) // 남는다(극단)
    }
}
