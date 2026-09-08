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
/// 액세스 토큰이 만료되기까지 이만큼 남았으면 **보내기 전에** 회전한다.
///
/// 왕복 한 번을 덮을 정도면 충분하다 — 못 덮어도 반응형 401 경로가 받아 내므로
/// 이 값은 정확성이 아니라 최적화다(웹의 TOKEN_REFRESH_MARGIN_MS와 같은 값).
private let tokenRefreshMarginMs = 5_000

@MainActor
@Observable
final class AuthManager: SessionAuthority {
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

    /// 스스로 로그아웃한 것이 **아닌데** 로그인 화면으로 온 경우.
    ///
    /// 이유 없이 대시보드에서 튕기면 무슨 일이 일어난 건지 알 수 없다 — 로그인 화면이 이
    /// 값을 보고 한 줄 알려 준다.
    ///
    /// **원인은 단정하지 않는다.** 서버는 폐기·만료·로그아웃을 모두 `UNAUTHORIZED` 하나로
    /// 알려주므로(`jwt-auth.guard.ts`의 `findValid`가 null이면 셋 다다), "다른 기기에서
    /// 해제됐다"고 말하면 단순 만료에도 없는 사실을 지어내게 된다.
    ///
    /// 반대로 **앱을 켤 때의 실패는 알리지 않는다.** 그 자리는 자격증명이 아예 없는 첫
    /// 방문과 구분되지 않고(웹은 쿠키를 읽을 수 없어 원리적으로 그렇다), 처음 온 사람에게
    /// 엉뚱한 안내가 뜬다. 알리는 것은 **쓰는 도중 세션이 끊긴 경우**뿐이다.
    private(set) var endedUnexpectedly = false

    /// 지금 도는 회전과, 그 회전이 **어느 세션의 것인지**.
    ///
    /// 복원(`/auth/me`가 만료를 만났을 때)과 401 재시도가 **같은 문**을 쓴다. 각자 돌면
    /// 1회용 리프레시 자격증명을 둘이 동시에 써서 재사용 탐지에 걸리고, 멀쩡한 세션이 끊긴다.
    ///
    /// 세대까지 함께 두는 이유: 다른 세션의 회전에 얹히면 **남의 확정 거부가 내 세션을
    /// 끊는다.** 같은 세대의 회전만 나눠 쓴다.
    private var rotateTask: Task<RotateOutcome, Never>?
    private var rotateGeneration: Int?

    /// 이 세대에서 **회전으로 물러난** 액세스 토큰들(최신이 앞)과 그 세대.
    ///
    /// 지금 값 하나만 보면, 함께 나간 요청 중 하나가 먼저 회전시켰을 때 나머지가 "남의
    /// 세션"으로 오인된다 — 되살릴 수 있는 401을 화면이 그냥 실패로 보게 된다. 물러난
    /// 토큰은 이미 죽었으므로 기억해 둬도 새로 할 수 있는 일이 없고, 세션이 갈리면 버린다.
    @ObservationIgnored
    private var supersededTokens: [String] = []
    @ObservationIgnored
    private var supersededGeneration = 0

    /// 선제 갱신 타이머와, 마지막으로 서버가 알려 준 액세스 토큰 수명.
    /// 액세스 토큰의 만료 시각. nil이면 모른다.
    ///
    /// 앱은 토큰을 열어 보지 않으므로(그럴 이유도 없다) 만료를 알 방법은 서버가 응답에
    /// 실어 주는 `accessTokenTtlMs`뿐이다 — 받은 그 순간에 시각으로 바꿔 둔다.
    private var accessTokenExpiresAt: Date?

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
            forgetAccessToken()
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
    /// - Parameter pushToken: 이 기기의 FCM 등록 토큰. **로그인 시점에만 세션에
    ///   실린다**(plan/push.md §5-2) — 로그인 화면이 권한을 먼저 받아 여기로 넘긴다.
    ///   nil이면 그 세션은 재로그인 전까지 `Notifications off`다.
    ///
    ///   ⚠️ **redirect 경로에는 실을 자리가 없다.** 세션이 서버 콜백에서 만들어지고 앱은
    ///   그것을 코드로 교환할 뿐이다 — 시작 시점의 쿠키도 소용없다(그 쿠키는 앱이 연
    ///   시스템 웹 세션의 병에 떨어진다).
    func signIn(
        with provider: AuthProvider,
        method: AuthMethod = .native,
        pushToken: String? = nil,
    ) async throws {
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
                try await signInWithApple(generation: gen, pushToken: pushToken)
            case .google:
                try await signInWithGoogle(generation: gen, pushToken: pushToken)
            case .kakao:
                try await signInWithKakao(generation: gen, pushToken: pushToken)
            case .demo:
                try await signInWithDemo(generation: gen, pushToken: pushToken)
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
            // 수명과 타이머는 **화면 상태와 함께** 간다. 밖에서 걸면, 앞질러진 복원이
            // 지금 세션의 수명을 덮고 남의 타이머를 심는다.
            applyFromRestore(gen) {
                self.noteAccessToken(ttlMs: session.accessTokenTtlMs)
                self.state = .signedIn(session.user)
            }
            Log.auth("session restored")
        } catch let error as APIError where error.isSessionExpired {
            // 갱신하면 살아나는 401 — 이 판단은 서버만 내릴 수 있어 코드로 받아 본다.
            await refreshOrSignOut(generation: gen, using: credentials.refreshToken)
        } catch let error as APIError where error.isDefinitiveAuthFailure {
            // 서버가 "이 자격증명은 못 쓴다"고 확정했다 — 폐기·변조. 지우고 로그인 화면으로.
            // 자격증명 삭제는 "내 값이 아직 현재값일 때만"(generation 무관), 화면은 가드 통과.
            discardIfCurrent(refreshToken: credentials.refreshToken, reason: "session invalidated")
            applyFromRestore(gen) { self.publishSignedOut() }
        } catch {
            // 일시적 실패(오프라인·타임아웃·5xx·형식 오류) — 자격증명은 **보존**한다.
            Log.auth("session check inconclusive — keeping credentials for retry")
            applyFromRestore(gen) { self.state = .signedOut }
        }
    }

    /// 액세스 토큰이 만료되기 **전에** 미리 세션을 회전한다.
    ///
    /// 액세스 토큰이 곧 만료되는가 — 요청을 보내기 전에 회전할지 가른다.
    ///
    /// **타이머로 미리 돌지 않는다.** 요청이 없는 동안에도 세션을 밀면 idle 타임아웃이
    /// 무의미해진다 — 화면만 열어두면 absolute 상한까지 살아 있게 된다. 요청이 있을 때만
    /// 보므로 유휴 상태에서는 트래픽이 0이고, 그러면서도 만료된 요청을 보내 401을 받고
    /// 되돌리는 왕복이 없다. 방치된 화면은 idle 창이 지나면 정직하게 만료된다.
    func isNearExpiry() -> Bool {
        guard let expiresAt = accessTokenExpiresAt else { return false }
        return expiresAt.timeIntervalSinceNow * 1000 <= Double(tokenRefreshMarginMs)
    }

    /// 서버가 알려 준 수명을 받은 그 자리에서 시각으로 바꿔 둔다.
    private func noteAccessToken(ttlMs: Int) {
        // 0은 "서버가 알려 주지 않았다"는 뜻이다(이 필드가 생기기 전 서버) — 모르는 채로
        // 둔다. 그러면 선제 회전을 걸지 않고 반응형 401 경로가 전부 맡는다.
        accessTokenExpiresAt =
            ttlMs > 0 ? Date().addingTimeInterval(Double(ttlMs) / 1000) : nil
    }

    /// 세션이 끝났다 — 남겨 두면 다음 요청이 낡은 만료 시각을 보고 헛 회전한다.
    private func forgetAccessToken() {
        accessTokenExpiresAt = nil
    }

    /// 서버가 **확정한** 인증 실패를 받았다 — 다른 기기에서 이 세션을 해제한 경우가
    /// 대표적이다.
    ///
    /// 화면이 "불러오지 못했습니다"를 띄우고 마는 대신 여기서 정리한다: 자격증명은 이미
    /// 죽었으므로 지우고 로그인 화면으로 보낸다. **서버에 로그아웃을 부르지 않는다** —
    /// 세션은 이미 서버에서 사라졌다.
    func endSession(mark: Int, usedAccessToken: String) async {
        // 그사이 새 세션이 들어왔다면 낡은 응답이 그것을 끊어서는 안 된다.
        guard mark == generation,
              keychain.load().credentials?.accessToken == usedAccessToken else { return }
        Log.auth("session rejected by the server — signing out")
        _ = keychain.clear()
        forgetAccessToken()
        // 세션이 끝났으니 표식도 넘긴다 — 아직 떠 있는 옛 요청의 응답이 돌아와도
        // 다음 세션을 건드리지 못한다.
        generation += 1
        publishSignedOut()
    }

    /// **이 토큰으로** 나가는 요청에 찍을 세션 표식. 이 세션이 발급한 토큰이 아니면 nil.
    ///
    /// 이 타입은 `@MainActor`라 아래에는 `await`이 없다 — 자격증명과 세대를 한 덩어리로
    /// 읽는다. 부르는 쪽이 토큰을 읽은 시점과 여기 사이에는 액터 hop이 하나 있어, 그
    /// 틈에 로그아웃·재로그인이 끝날 수 있다.
    func sessionMark(usedAccessToken: String) -> Int? {
        // 로그인·로그아웃이 도는 동안에는 이 요청이 **어느 세션으로 끝날지 아직 모른다.**
        // 세대는 액션이 시작될 때 이미 올랐지만 자격증명은 아직 앞 세션의 것이라, 여기서
        // 표식을 주면 옛 토큰이 곧 채택될 새 세션의 이름표를 달게 된다. 표식을 주지 않으면
        // 그 401은 되살리지 않고 그냥 실패로 올라간다 — 세션이 바뀌는 중에는 그게 맞다.
        guard !authActionInFlight else { return nil }
        if keychain.load().credentials?.accessToken == usedAccessToken { return generation }
        // 방금 회전으로 물러난 토큰도 **이 세션이 발급한 것**이다.
        if supersededGeneration == generation,
           supersededTokens.contains(usedAccessToken) {
            return generation
        }
        return nil
    }

    /// 401을 만난 요청을 위해 세션을 갱신한다 — 화면을 쓰는 도중 액세스 토큰이 만료되는
    /// 흔한 경우다(앱 시작·복귀에서만 갱신하면 그 사이는 그냥 실패로 보인다).
    ///
    /// 여러 요청이 동시에 401을 받아도 **갱신은 한 번만** 나간다: 내가 실패시킨 그 토큰이
    /// 이미 갈려 있으면 다른 요청이 갱신한 것이므로 그 결과를 쓴다. 각자 갱신하면 회전한
    /// refresh token으로 두 번째가 거부되어 멀쩡한 세션이 끊긴다.
    ///
    /// - Returns: 재시도에 쓸 **새** 액세스 토큰. 갱신하지 못했으면 nil — 토큰이 그대로면
    ///   같은 401이 한 번 더 날 뿐이라 재시도하지 않는다.
    func refreshForRetry(mark: Int, usedAccessToken: String) async -> String? {
        // 요청을 보낸 그 세션이 아직 살아 있을 때만 손댄다 — 그사이 로그아웃하고 다시
        // 로그인했다면 이 401은 **남의 세션**의 것이다(토큰 비교만으로는 회전과 구분되지
        // 않아, 옛 요청이 새 세션의 토큰으로 재생될 수 있었다).
        guard mark == generation else { return nil }
        if let current = keychain.load().credentials?.accessToken,
           current != usedAccessToken {
            return current
        }
        guard let refreshToken = keychain.load().credentials?.refreshToken else { return nil }

        let outcome = await sharedRotate(generation: mark, using: refreshToken)
        // 회전을 기다리는 사이에 세션이 갈렸다면 이 결과는 **남의 것**이다.
        guard mark == generation else { return nil }
        switch outcome {
        case .rotated, .superseded:
            // superseded는 "그사이 다른 흐름이 자격증명을 갈아 끼웠다"는 뜻이다. 세대가
            // 그대로라면 그것은 같은 세션의 회전이므로 그 값으로 재시도한다.
            let rotated = keychain.load().credentials?.accessToken
            // 회전하지 않았으면 nil이다 — 같은 토큰으로 다시 보내 봐야 같은 401이다.
            return rotated == usedAccessToken ? nil : rotated
        case .rejected:
            // 되살릴 수 없는 세션이다 — 자격증명은 rotate가 이미 정리했다.
            // **쓰는 도중** 끊긴 것이므로 이유도 함께 남긴다: 대시보드를 보고 있다가 아무
            // 말 없이 로그인 화면으로 돌아가면 이동이 실패한 것처럼 보인다.
            applyFromRestore(mark) { self.publishSignedOut() }
            return nil
        case .inconclusive:
            // 오프라인·5xx 같은 일시적 실패로 **로그인 화면으로 쫓아내지 않는다.**
            // 자격증명은 아직 살아 있을 수 있고, 화면은 오류만 보여 주면 된다.
            return nil
        }
    }

    /// 회전을 **한 번만** 내보내는 문. 복원과 401 재시도가 여기서 만난다.
    ///
    /// 같은 세대의 회전만 나눠 쓴다 — 남의 세션 결과를 내 답으로 받으면, 그쪽의 확정
    /// 거부가 멀쩡한 내 세션을 끊는다.
    private func sharedRotate(
        generation gen: Int,
        using refreshToken: String,
        activity: Bool = false,
    ) async -> RotateOutcome {
        // 여기까지는 `await`이 없어 메인 액터 위에서 확인과 등록이 한 덩어리로 일어난다 —
        // 그래서 두 요청이 각자 회전을 띄우는 틈이 없다.
        if let inFlight = rotateTask, rotateGeneration == gen {
            return await inFlight.value
        }
        let task = Task { [weak self] () -> RotateOutcome in
            guard let self else { return .superseded }
            return await self.rotate(generation: gen, using: refreshToken, activity: activity)
        }
        rotateTask = task
        rotateGeneration = gen
        let outcome = await task.value
        // 내가 심은 슬롯일 때만 비운다 — 그사이 다음 세션의 회전이 자리를 차지했을 수 있다.
        if rotateGeneration == gen {
            rotateTask = nil
            rotateGeneration = nil
        }
        return outcome
    }

    /// 갱신 한 번의 결과. 무엇을 할지는 **부르는 쪽**이 정한다 — 자리마다 답이 다르다.
    private enum RotateOutcome {
        /// 회전했다. 새 자격증명이 저장돼 있다.
        case rotated
        /// 되살릴 수 없다 — 서버가 확정 거부했거나, 회전된 값을 저장하지 못했다.
        case rejected
        /// 이번엔 확인이 안 됐다(오프라인·5xx). 자격증명은 아직 살아 있을 수 있다.
        case inconclusive
        /// 그사이 자격증명이 갈렸다 — 이 응답은 남의 것이라 아무것도 하지 않는다.
        case superseded
    }

    /// 복원 경로의 갱신 — 확인이 안 되면 로그인 화면을 보인다(자격증명은 보존).
    ///
    /// 401 재시도와 **같은 문**(`sharedRotate`)을 쓴다. 각자 돌면 포그라운드 복귀의 복원과
    /// 화면의 401이 1회용 리프레시 자격증명을 동시에 써서 재사용 탐지에 걸린다.
    private func refreshOrSignOut(generation gen: Int, using refreshToken: String) async {
        // 앱을 다시 여는 것은 **활동**이다. 이 경로는 회전으로 끝나고 다시 보호된 요청을
        // 보내지 않으므로, 여기서 알리지 않으면 그 활동이 계산되지 않는다(plan/auth.md §6).
        switch await sharedRotate(generation: gen, using: refreshToken, activity: true) {
        case .rotated, .superseded:
            break
        case .rejected:
            applyFromRestore(gen) { self.publishSignedOut() }
        case .inconclusive:
            // 확인이 안 됐을 뿐이다 — 자격증명은 남기고, 끝났다고 말하지도 않는다.
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
    ///
    /// **상태를 로그아웃으로 바꾸지 않는다.** 실패를 어떻게 다룰지는 자리마다 다르기
    /// 때문이다: 앱 시작의 복원은 확인이 안 되면 로그인 화면을 보여야 하지만, 쓰는 도중의
    /// 갱신은 잠깐 끊긴 것만으로 사용자를 쫓아내면 안 된다.
    /// - Parameter activity: 이 회전을 **사용자가 시켰는가**(앱 복원). 참이면 서버가
    ///   회전 뒤 유휴 창도 민다 — 복원은 이 요청으로 끝나 다시 보호된 요청을 보내지 않는다.
    private func rotate(
        generation gen: Int,
        using refreshToken: String,
        activity: Bool = false,
    ) async -> RotateOutcome {
        let session: AuthSession
        do {
            session = try await service.refresh(refreshToken: refreshToken, activity: activity)
        } catch let error as APIError where error.isDefinitiveAuthFailure {
            discardIfCurrent(refreshToken: refreshToken, reason: "refresh rejected by server")
            return .rejected
        } catch {
            // 네트워크·5xx로 갱신에 실패한 것뿐이라면 자격증명을 지우지 않는다.
            Log.auth("refresh inconclusive — keeping credentials for retry")
            return .inconclusive
        }

        // 아래는 await가 없는 동기 구간이라 load→save/revoke가 원자적이다(TOCTOU 없음).
        let stored = keychain.load().credentials
        guard stored?.refreshToken == refreshToken else {
            // 그사이 자격증명이 바뀌었다(로그아웃 마커·새 로그인) — 낡은 응답이라 버린다.
            Log.auth("refresh superseded — discarding rotated response")
            return .superseded
        }
        // 물러나는 토큰을 기억해 둔다 — 같은 세션에서 그 토큰으로 이미 떠난 요청이
        // 401을 만나도 되살아날 수 있게(위 supersededTokens 설명).
        //
        // 기록은 **이 회전이 속한 세대**(gen)의 것이다. 지금 세대에 적으면 안 된다: 회전이
        // 네트워크에 매달려 있는 사이 새 로그인이 시작돼 세대가 이미 올라갔을 수 있고,
        // 그러면 **끝난 세션의 토큰이 다음 세션의 이름표를 받는다**(옛 요청이 새 계정에서
        // 재생된다). 세대가 갈렸으면 이 회전은 이미 남의 것이라 남길 자리가 없다.
        if gen == generation, let previous = stored?.accessToken {
            if supersededGeneration != gen {
                supersededTokens = []
                supersededGeneration = gen
            }
            supersededTokens = Array(
                ([previous] + supersededTokens).prefix(Self.supersededTokenMemory),
            )
        }
        guard keychain.save(
            .init(accessToken: session.accessToken, refreshToken: session.refreshToken),
        ) else {
            // 회전된 토큰을 저장하지 못하면 세션을 이을 방법이 없다(옛 값은 죽었다).
            // 죽은 옛 값이 아직 현재값이면 제거한다 — generation과 무관하게.
            discardIfCurrent(refreshToken: refreshToken, reason: "failed to persist rotated credentials")
            return .rejected
        }
        // 수명과 타이머는 **화면 상태와 함께** 간다 — 앞질러진 갱신이 남의 타이머를
        // 심지 않게.
        applyFromRestore(gen) {
            self.noteAccessToken(ttlMs: session.accessTokenTtlMs)
            self.state = .signedIn(session.user)
        }
        Log.auth("session refreshed")
        return .rotated
    }

    // MARK: - Private (로그인)

    private func signInWithApple(generation gen: Int, pushToken: String?) async throws {
        let credential = try await appleSignIn.signIn()
        let session = try await service.loginWithApple(
            identityToken: credential.identityToken,
            nonce: credential.nonce,
            name: credential.name,
            pushToken: pushToken,
        )
        try adopt(session, generation: gen)
    }

    private func signInWithGoogle(generation gen: Int, pushToken: String?) async throws {
        let idToken = try await social.googleIdToken()
        let session = try await service.loginWithGoogle(idToken: idToken, pushToken: pushToken)
        try adopt(session, generation: gen)
    }

    private func signInWithKakao(generation gen: Int, pushToken: String?) async throws {
        let accessToken = try await social.kakaoAccessToken()
        let session = try await service.loginWithKakao(
            accessToken: accessToken,
            pushToken: pushToken
        )
        try adopt(session, generation: gen)
    }

    // 데모: SDK 없이 서버가 시드 계정으로 바로 세션을 발급한다(토큰을 body로).
    private func signInWithDemo(generation gen: Int, pushToken: String?) async throws {
        let session = try await service.loginDemo(pushToken: pushToken)
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
        noteAccessToken(ttlMs: session.accessTokenTtlMs)
        endedUnexpectedly = false
        state = .signedIn(session.user)
        // 로그인 직후부터 세션이 밀리게 한다 — 다음 `/auth/me`까지 기다리지 않는다.
    }

    // MARK: - Private (가드·정리)

    /// 세션이 **확정적으로** 끝났다 — 로그인 화면으로 보내고, 필요하면 이유를 남긴다.
    ///
    /// 알릴지는 **어느 경로가 발견했는지가 아니라 무엇을 보고 있었는지**로 정한다. 같은
    /// 만료를 복원·예약 타이머·화면 요청이 동시에 발견할 수 있어, 경로로 정하면 누가 먼저
    /// 처리하느냐에 따라 같은 상황이 조용했다 시끄러웠다 한다(실제로 그랬다). 지금 보고
    /// 있던 것이 로그인된 화면이었을 때만 설명이 필요하다 — 앱을 켜자마자 실패한 것은
    /// 자격증명이 아예 없는 첫 방문과 같은 화면이라 알릴 일이 아니다.
    ///
    /// **확인이 안 된 것(오프라인·5xx)에는 쓰지 않는다.** 세션이 끝났다고 말할 수 없다.
    private func publishSignedOut() {
        if case .signedIn = state { endedUnexpectedly = true }
        state = .signedOut
    }

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
        // **소유권 확인이 먼저다.** 앞서 타이머부터 끄면, 우리 값이 이미 현재값이 아닌
        // 경우(그사이 새 로그인이 끝난 경우)에 아무것도 버리지 않으면서 **지금 세션의**
        // 예약만 꺼 버린다 — 멀쩡히 로그인된 채로 선제 갱신만 죽어, 방치된 화면이 idle
        // 창에서 조용히 만료된다.
        guard keychain.load().credentials?.refreshToken == refreshToken else { return }
        Log.auth("discarding credentials: \(reason)")
        forgetAccessToken()
        _ = keychain.revoke()
    }

    // 회전으로 물러난 토큰을 몇 개까지 기억할지. 한 번의 401 무리에서 회전은 한 번만
    // 나가므로(single-flight) 하나면 대개 충분하고, 선제 회전이 겹칠 때를 위해 여유를 둔다.
    private static let supersededTokenMemory = 3

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
