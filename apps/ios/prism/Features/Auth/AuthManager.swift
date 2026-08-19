//
//  AuthManager.swift
//  prism
//
//  Path: Features/Auth/AuthManager.swift
//

import Foundation
import Observation

/// 앱 전체의 인증 상태.
///
/// 세션의 진실은 서버에 있고(plan/auth.md §6), 앱은 Keychain의 자격증명으로 그것을
/// 물어볼 뿐이다 — 그래서 시작 상태가 `signedIn`이 아니라 `checking`이다.
///
/// 여러 경로가 상태를 건드린다: 앱 시작·포그라운드 복귀의 세션 확인(백그라운드)과,
/// 사용자의 로그인·로그아웃(전면). 이들이 `await`를 넘나들며 겹치면 stale한 확인 결과가
/// 방금 만든 세션을 덮거나, 지는 쪽이 유효 자격증명을 지운다. 이를 막는 규칙은 둘이다:
///
/// 1. **세대(generation)** — 사용자 액션이 값을 올린다. 백그라운드 확인은 시작 시점의
///    세대를 기억했다가, 상태를 바꾸기 직전 여전히 같은 세대인지 확인한다(다르면 버린다).
/// 2. **액션 진행 플래그** — 로그인/로그아웃이 도는 동안 백그라운드 확인은 상태를 아예
///    건드리지 않는다(그 결과가 우선이다).
///
/// 자격증명 저장은 KeychainManager가 한 항목으로 원자 처리하므로 "반쪽만 저장"은 없다.
@MainActor
@Observable
final class AuthManager {
    enum State: Equatable {
        /// 저장된 자격증명으로 세션을 확인하는 중(앱 시작 직후).
        case checking
        case signedOut
        case signedIn(User)
    }

    private(set) var state: State = .checking

    @ObservationIgnored
    private let service: AuthServicing
    @ObservationIgnored
    private let keychain: CredentialStoring
    @ObservationIgnored
    private let appleSignIn: AppleSignInController
    /// Google·Kakao 네이티브 SDK 로그인(토큰 획득). 기본값은 "미설정"이라 데모·Apple만
    /// 동작한다 — SDK/키 없이도 부팅·테스트가 된다.
    @ObservationIgnored
    private let social: SocialSignInProviding
    /// 웹 redirect 로그인(ASWebAuthenticationSession) — method=.redirect 경로.
    @ObservationIgnored
    private let webAuth: WebAuthController

    /// 상태를 바꿀 권한이 있는 "작업 세대". 사용자 액션(signIn/signOut)이 올린다.
    @ObservationIgnored
    private var generation = 0

    /// 사용자 액션(로그인/로그아웃)이 진행 중인가. 떠 있으면 백그라운드 확인은 물러난다.
    /// `authActionToken`은 그 소유자다 — 액션이 겹칠 때 오래된 액션의 `defer`가 새 액션의
    /// 진행 플래그를 내리지 않도록, owner일 때만 해제한다.
    @ObservationIgnored
    private var authActionInFlight = false
    @ObservationIgnored
    private var authActionToken: UUID?

    /// 진행 중인 세션 확인 작업(중복 확인 방지 single-flight)과 그 소유 토큰.
    /// 토큰으로 "내가 설치한 슬롯"만 정리해, 이미 취소·재설치된 슬롯을 실수로 지우지 않는다.
    @ObservationIgnored
    private var restoreTask: Task<Void, Never>?
    @ObservationIgnored
    private var restoreToken: UUID?

    init(
        service: AuthServicing,
        keychain: CredentialStoring,
        appleSignIn: AppleSignInController,
        // 기본값은 nil로 두고 아래 본문에서 만든다. 이 모듈은 기본 격리가 MainActor라
        // (SWIFT_DEFAULT_ACTOR_ISOLATION) 두 타입의 init 모두 `@MainActor`인데, 기본 인자
        // 표현식은 비격리로 평가돼 거기서 생성하면 격리 위반이다. init 본문은 이 타입이
        // `@MainActor`라 메인 액터 위이므로 여기서 만드는 건 안전하다.
        social: SocialSignInProviding? = nil,
        webAuth: WebAuthController? = nil,
    ) {
        self.service = service
        self.keychain = keychain
        self.appleSignIn = appleSignIn
        self.social = social ?? UnavailableSocialSignIn()
        self.webAuth = webAuth ?? WebAuthController()
    }

    // MARK: - 세션

    /// 저장된 자격증명으로 세션을 확인한다. 앱 시작·포그라운드 복귀에서 부른다.
    /// 사용자 액션이 진행 중이면 시작하지 않고, 이미 확인 중이면 그 작업을 기다린다.
    func restoreSession() async {
        if authActionInFlight { return }
        if let existing = restoreTask {
            await existing.value
            return
        }
        let token = UUID()
        let gen = generation
        restoreToken = token
        let task = Task { await performSessionCheck(generation: gen) }
        restoreTask = task
        await task.value
        // 내가 설치한 슬롯일 때만 비운다 — 그사이 취소/재설치됐다면 건드리지 않는다.
        if restoreToken == token {
            restoreTask = nil
            restoreToken = nil
        }
    }

    /// 로그아웃 — 서버 세션을 폐기하고 자격증명을 지운다.
    /// 서버 호출이 실패해도 로컬 정리는 반드시 끝낸다. 기기에 남은 토큰을 지우는 것이
    /// 사용자가 "로그아웃"으로 기대하는 최소한이기 때문이다.
    func signOut() async {
        let token = beginAuthAction()
        let gen = generation
        defer { endAuthAction(token) }

        let accessToken = keychain.load().credentials?.accessToken
        // **네트워크 전에** 로그아웃 의도를 durable하게 남긴다: 자격증명을 revoked 마커로
        // 덮어쓴다. 이 시점 이후 앱이 죽거나(logout await 도중) 재설치돼도, 남은 값으로
        // 세션이 부활하지 않는다(Keychain의 마커가 그 의도를 지킨다).
        let revoked = keychain.revoke()
        do {
            try await service.logout(accessToken: accessToken)
        } catch {
            Log.auth("server logout failed — local session revoked")
        }
        // 더 새로운 액션이 앞질렀다면(사실상 없지만) 이 결과는 버린다.
        guard gen == generation else { return }
        // 로컬 로그아웃이 성사됐을 때만 signedOut을 확정한다:
        //  - revoke 성공: 마커가 durable하게 남아 부활을 막는다.
        //  - revoke 실패 시 clear 성공: 자격증명을 삭제로 없앴다.
        // 둘 다 실패면 Keychain을 쓰지도 지우지도 못하는 극단이다 — 세션이 로컬에 남아 있을
        // 수 있으므로 거짓 signedOut을 게시하지 않는다. 사용자는 다시 시도할 수 있고, 서버가
        // 이미 폐기했다면 다음 세션 확인이 signedOut으로 정리한다(self-healing).
        if revoked || keychain.clear() {
            state = .signedOut
        } else {
            Log.error("logout could not persist locally — session may remain, keeping state")
        }
    }

    // MARK: - 로그인

    /// 소셜·데모 로그인.
    ///
    ///  - apple/google/kakao: provider 네이티브 SDK로 토큰을 받아 서버에 보내고, 서버가 준
    ///    Bearer 세션(`AuthSession`)을 Keychain에 담는다. 웹 redirect가 다른 앱에
    ///    가로채이는 문제를 피하는 경로다(plan/auth.md §4.1).
    ///  - demo: `/auth/demo/native`가 `AuthSession`(토큰)을 body로 주고, 다른 네이티브
    ///    경로와 똑같이 Keychain(Bearer)에 담는다. 데모는 방식(native)만 있다.
    func signIn(with provider: AuthProvider, method: AuthMethod = .native) async throws {
        let token = beginAuthAction()
        let gen = generation
        defer { endAuthAction(token) }

        switch method {
        case .redirect:
            // 세 provider 모두 서버 웹 OAuth를 시스템 웹 세션으로 진행한다.
            // 데모는 redirect 경로가 없다(웹 OAuth provider가 아니다).
            try await signInWithWebRedirect(provider, generation: gen)
        case .native:
            switch provider {
            case .apple:
                try await signInWithApple(generation: gen)
            case .google:
                try await signInWithGoogle(generation: gen)
            case .kakao:
                try await signInWithKakao(generation: gen)
            case .demo:
                try await signInWithDemo(generation: gen)
            }
        }
    }

    // MARK: - Private (세션 확인 본체)

    /// 세션 확인 본체. `restoreSession`이 single-flight로 감싸 호출한다.
    private func performSessionCheck(generation gen: Int) async {
        let credentials: KeychainManager.Credentials
        switch keychain.load() {
        case .credentials(let value):
            credentials = value
        case .revoked:
            // 지난 로그아웃이 durable하게 남았다 — 남은 값으로 되살리지 않고 signedOut.
            // 마커는 지우지 않는다: 옛 두-키가 남아 있을 수 있고, 마커가 그것을 가려
            // 부활을 막는 지키개이기 때문이다(다음 로그인의 save가 덮을 때까지 유지).
            applyFromRestore(gen) { self.state = .signedOut }
            return
        case .none:
            applyFromRestore(gen) { self.state = .signedOut }
            return
        }
        do {
            let session = try await service.me(accessToken: credentials.accessToken)
            applyFromRestore(gen) { self.state = .signedIn(session.user) }
            Log.auth("session restored")
        } catch let error as APIError where error.isSessionExpired {
            // 갱신하면 살아나는 401 — 이 판단은 서버만 내릴 수 있어 코드로 받아 본다.
            await performRefresh(generation: gen, using: credentials.refreshToken)
        } catch let error as APIError where error.isDefinitiveAuthFailure {
            // 서버가 "이 자격증명은 못 쓴다"고 확정했다 — 폐기·변조. 지우고 로그인 화면으로.
            // 자격증명 삭제는 "내 값이 아직 현재값일 때만"(generation 무관), 화면은 가드 통과.
            discardIfCurrent(refreshToken: credentials.refreshToken, reason: "session invalidated")
            applyFromRestore(gen) { self.state = .signedOut }
        } catch {
            // 일시적 실패(오프라인·타임아웃·5xx·형식 오류) — 자격증명은 **보존**한다.
            Log.auth("session check inconclusive — keeping credentials for retry")
            applyFromRestore(gen) { self.state = .signedOut }
        }
    }

    /// 액세스 토큰 갱신.
    ///
    /// 서버는 응답을 **주기 전에** 리프레시 자격증명을 회전한다. 그래서 이 흐름의 핵심은
    /// "부수효과(회전)가 일어나는 네트워크 호출을 취소하지 않고 끝까지 받는다"이다
    /// (그래서 auth 액션도 이 작업을 취소하지 않는다 — beginAuthAction이 restore를
    /// 취소하지 않게 바꿨다). 응답을 받으면 **generation과 무관하게** 자격증명을 처리한다:
    ///
    /// - 회전 성공 + 우리가 보낸 값이 아직 현재값 → 새 토큰 저장. (다른 액션이 값을 바꿨으면
    ///   낡은 응답이라 버린다.)
    /// - 저장 실패 + 우리 값이 아직 현재값 → 옛 값은 이미 죽었으므로 제거한다(다음 실행이
    ///   죽은 토큰을 다시 쓰지 않게).
    ///
    /// 화면 상태 반영만 generation·액션 가드(`applyFromRestore`)를 따른다.
    private func performRefresh(generation gen: Int, using refreshToken: String) async {
        let session: AuthSession
        do {
            session = try await service.refresh(refreshToken: refreshToken)
        } catch let error as APIError where error.isDefinitiveAuthFailure {
            discardIfCurrent(refreshToken: refreshToken, reason: "refresh rejected by server")
            applyFromRestore(gen) { self.state = .signedOut }
            return
        } catch {
            // 네트워크·5xx로 갱신에 실패한 것뿐이라면 자격증명을 지우지 않는다.
            Log.auth("refresh inconclusive — keeping credentials for retry")
            applyFromRestore(gen) { self.state = .signedOut }
            return
        }

        // 아래는 await가 없는 동기 구간이라 load→save/revoke가 원자적이다(TOCTOU 없음).
        guard keychain.load().credentials?.refreshToken == refreshToken else {
            // 그사이 자격증명이 바뀌었다(로그아웃 마커·새 로그인) — 낡은 응답이라 버린다.
            Log.auth("refresh superseded — discarding rotated response")
            return
        }
        let saved = keychain.save(
            .init(accessToken: session.accessToken, refreshToken: session.refreshToken),
        )
        if saved {
            applyFromRestore(gen) { self.state = .signedIn(session.user) }
            Log.auth("session refreshed")
        } else {
            // 회전된 토큰을 저장하지 못하면 세션을 이을 방법이 없다(옛 값은 죽었다).
            // 죽은 옛 값이 아직 현재값이면 제거한다 — generation과 무관하게.
            discardIfCurrent(refreshToken: refreshToken, reason: "failed to persist rotated credentials")
            applyFromRestore(gen) { self.state = .signedOut }
        }
    }

    // MARK: - Private (로그인)

    private func signInWithApple(generation gen: Int) async throws {
        let credential = try await appleSignIn.signIn()
        let session = try await service.loginWithApple(
            identityToken: credential.identityToken,
            nonce: credential.nonce,
            name: credential.name,
        )
        try adopt(session, generation: gen)
    }

    private func signInWithGoogle(generation gen: Int) async throws {
        let idToken = try await social.googleIdToken()
        let session = try await service.loginWithGoogle(idToken: idToken)
        try adopt(session, generation: gen)
    }

    private func signInWithKakao(generation gen: Int) async throws {
        let accessToken = try await social.kakaoAccessToken()
        let session = try await service.loginWithKakao(accessToken: accessToken)
        try adopt(session, generation: gen)
    }

    // 데모: SDK 없이 서버가 시드 계정으로 바로 세션을 발급한다(토큰을 body로).
    private func signInWithDemo(generation gen: Int) async throws {
        let session = try await service.loginDemo()
        try adopt(session, generation: gen)
    }

    // 웹 redirect: 시스템 웹 세션으로 서버 웹 OAuth를 열어 일회용 코드를 받고 토큰과 교환한다.
    private func signInWithWebRedirect(
        _ provider: AuthProvider,
        generation gen: Int,
    ) async throws {
        let code = try await webAuth.signIn(provider: provider)
        let session = try await service.exchangeNativeCode(code)
        try adopt(session, generation: gen)
    }

    /// 로그인 성공으로 받은 세션을 채택한다.
    ///
    /// **세대 검사를 저장보다 먼저** 한다: 그사이 로그아웃/새 로그인이 앞질렀다면(gen 불일치)
    /// 저장도 게시도 하지 않는다 — 저장 먼저 하면 로그아웃된 화면 뒤에 orphan 자격증명이
    /// 남아 다음 실행에서 되살아난다. guard→save→state는 await가 없어 원자적이다.
    /// 저장이 실패하면 세션을 게시하지 않고 던진다(다음 실행에 사라질 세션을 signedIn으로
    /// 만들지 않는다).
    private func adopt(_ session: AuthSession, generation gen: Int) throws {
        guard gen == generation else { return }
        guard keychain.save(
            .init(accessToken: session.accessToken, refreshToken: session.refreshToken),
        ) else {
            Log.error("failed to persist credentials — aborting sign-in")
            throw APIError.invalidResponse
        }
        // 저장(save)이 revoked 마커를 자격증명으로 덮어썼으므로, 지난 로그아웃 의도는
        // 새 세션이 자연히 대체한다(별도 표식 관리가 필요 없다).
        state = .signedIn(session.user)
    }

    // MARK: - Private (가드·정리)

    /// 복원/갱신이 **화면 상태**를 바꾸는 유일한 관문. 사용자 액션이 진행 중이거나(그 결과가
    /// 우선), 더 새로운 세대가 있으면(로그아웃/새 로그인이 앞질렀으면) 이 결과는 버린다.
    private func applyFromRestore(_ gen: Int, _ body: () -> Void) {
        guard gen == generation, !authActionInFlight else { return }
        body()
    }

    /// 자격증명을 버린다 — 단, 우리가 다루던 refresh가 아직 저장소의 현재값일 때만.
    /// generation과 무관하다(부수효과 정리는 소유권이 아니라 "현재값 일치"로 지킨다):
    /// 그사이 다른 액션이 값을 바꿨다면 그 값은 건드리지 않는다.
    ///
    /// 삭제(clear)가 아니라 **revoke**(마커로 덮어쓰기)를 쓴다: 삭제는 실패 시 옛 값(또는
    /// 옛 두-키 형식)이 되살아날 수 있지만, 마커로 덮으면 그 durable한 "무효" 의도가 남아
    /// 부활을 막는다(마커는 지키개로 남고 다음 로그인이 덮는다). revoke가 실패해도 이
    /// 자격증명은 서버가 이미 무효화한 것이라, 남으면 다음 확인이 다시 확정 실패로 정리한다.
    private func discardIfCurrent(refreshToken: String, reason: String) {
        guard keychain.load().credentials?.refreshToken == refreshToken else { return }
        Log.auth("discarding credentials: \(reason)")
        _ = keychain.revoke()
    }

    /// 사용자 액션 시작. 세대를 올리고 소유 토큰을 발급한다.
    /// **restore를 취소하지 않는다** — 진행 중인 refresh의 네트워크 호출이 취소되면 서버가
    /// 회전한 토큰을 잃기 때문이다(#1). stale 결과는 generation 가드가 화면에서 걸러 낸다.
    private func beginAuthAction() -> UUID {
        let token = UUID()
        authActionToken = token
        authActionInFlight = true
        generation += 1
        return token
    }

    /// 사용자 액션 종료. **내가 소유자일 때만** 진행 플래그를 내린다 — 겹친 새 액션이 있으면
    /// 그 액션이 끝날 때까지 플래그를 유지한다(오래된 defer가 새 액션을 노출하지 않게).
    private func endAuthAction(_ token: UUID) {
        guard authActionToken == token else { return }
        authActionInFlight = false
        authActionToken = nil
    }
}
