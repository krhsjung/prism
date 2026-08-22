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

    func me(accessToken: String) async throws -> SessionUser { try meResult.get() }
    func refresh(refreshToken: String) async throws -> AuthSession { try refreshResult.get() }
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

    init(refreshResult: Result<AuthSession, Error>) {
        self.refreshResult = refreshResult
    }

    func me(accessToken: String) async throws -> SessionUser {
        throw APIError(status: 401, code: AuthErrorCode.sessionExpired)
    }

    func refresh(refreshToken: String) async throws -> AuthSession {
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

/// logout을 게이트로 붙잡는 서비스. "네트워크 대기 중"을 재현해, 그 시점 저장소 상태를
/// 검사할 수 있게 한다(로그아웃 의도가 네트워크 전에 남았는지).
private final class GatedLogoutService: AuthServicing, @unchecked Sendable {
    let gate = RefreshGate()

    func me(accessToken: String) async throws -> SessionUser { throw APIError.network }
    func refresh(refreshToken: String) async throws -> AuthSession { throw APIError.network }
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
    AuthManager(service: service, keychain: store, appleSignIn: AppleSignInController())
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
    @Test("401을 만난 요청을 위해 갱신하고 새 토큰을 돌려준다")
    func refreshForRetryRotates() async {
        let service = FakeService()
        service.refreshResult = .success(AuthSession(
            accessToken: "a2", refreshToken: "r2",
            user: user(), accessTokenTtlMs: 900_000,
        ))
        let store = FakeStore(creds("a", "r"))
        let manager = makeManager(service, store)

        let rotated = await manager.refreshForRetry(usedAccessToken: "a")

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

        let rotated = await manager.refreshForRetry(usedAccessToken: "a")

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

        #expect(await manager.refreshForRetry(usedAccessToken: "a") == nil)
    }

    @Test("자격증명이 없으면 갱신할 것도 없다")
    func refreshForRetryWithoutCredentials() async {
        let manager = makeManager(FakeService(), FakeStore(.none))

        #expect(await manager.refreshForRetry(usedAccessToken: "a") == nil)
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
