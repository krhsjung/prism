//
//  APIEndpoint.swift
//  prism
//
//  Path: Core/Networking/APIEndpoint.swift
//

import Foundation

/// API 접속 설정.
///
/// 주소는 소스에 박지 않고 Info.plist의 `PRISM_API_URL`에서 읽는다 — 빌드 설정
/// `PRISM_API_URL`(환경 변수)이 그 값을 채운다. 웹이 `VITE_API_URL`을 쓰는 것과 같은
/// 구조이며, 값이 없으면 로컬 개발 서버로 떨어진다.
///
/// - Note: 로컬 폴백은 http라 ATS가 막는다. 시뮬레이터에서 로컬 서버를 붙이려면
///   Info.plist에 `NSAllowsLocalNetworking` 예외가 필요하다(운영 빌드에는 넣지 말 것).
// 프로젝트 기본 격리가 MainActor라(SWIFT_DEFAULT_ACTOR_ISOLATION) 아무 표시가 없으면 이
// 상수들도 MainActor의 것이 된다. 그러면 **기본 인자**처럼 비격리 문맥에서 읽는 자리마다
// 경고가 난다(SessionSocket.init의 url이 그랬다). 값은 Info.plist에서 한 번 읽어 굳는
// 불변 설정이고 UI와 아무 상관이 없으므로, 격리를 벗겨 어디서나 읽게 둔다.
nonisolated enum APIConfiguration {
    /// 값이 비어 있을 때의 개발용 주소. 웹의 `api.ts` 기본값과 같다.
    private static let developmentURL = "https://hsjung.asuscomm.com"

    static let baseURL: URL = {
        let configured = Bundle.main.object(forInfoDictionaryKey: "PRISM_API_URL") as? String
        let trimmed = configured?.trimmingCharacters(in: .whitespaces) ?? ""
        let raw = trimmed.isEmpty ? developmentURL : trimmed
        guard let url = URL(string: raw) else {
            Log.error("invalid PRISM_API_URL — falling back to development server")
            // 여기까지 오면 설정이 잘못된 것이다. 앱을 죽이는 대신 개발 주소로 떨어뜨리고
            // 로그를 남긴다 — 어차피 첫 요청이 실패해 화면에 오류로 드러난다.
            return URL(string: developmentURL)!
        }
        return url
    }()

    /// 값이 비어 있을 때의 개발용 소켓 주소. 웹의 `VITE_SOCKET_URL` 기본값과 같은 역할이다.
    private static let developmentSocketURL = "wss://hsjung.asuscomm.com/socket"

    /// 세션 소켓(= socket 서비스) 주소.
    ///
    /// **baseURL에서 유도하지 않는다.** 로컬에서 auth는 :3000이고 socket은 :3002라
    /// 스킴만 바꿔서는 닿지 않는다. 운영에서는 반드시 `wss://` — 세션 쿠키는 앱에서
    /// 쓰지 않지만(Bearer로 인증한다) 평문 전송으로 토큰을 흘릴 이유가 없다.
    static let socketURL: URL = {
        let configured = Bundle.main.object(forInfoDictionaryKey: "PRISM_SOCKET_URL") as? String
        let trimmed = configured?.trimmingCharacters(in: .whitespaces) ?? ""
        let raw = trimmed.isEmpty ? developmentSocketURL : trimmed
        guard let url = URL(string: raw) else {
            Log.error("invalid PRISM_SOCKET_URL — falling back to development server")
            return URL(string: developmentSocketURL)!
        }
        return url
    }()

    /// 요청 하나의 데드라인. 서버 무응답 시 로그인 화면이 무한 대기하지 않게 한다.
    static let requestTimeout: TimeInterval = 10
    /// 리소스 전체(재시도 포함)의 상한.
    static let resourceTimeout: TimeInterval = 30
}

/// 서버 엔드포인트. 경로 문자열이 호출부에 흩어지지 않도록 여기 모은다.
/// (계약: plan/auth.md §5, apps/server/services/auth/src/auth.controller.ts)
enum APIEndpoint {
    /// iOS 네이티브 Sign in with Apple. `AuthSession`(토큰)을 돌려준다.
    case appleNative
    /// Google 네이티브(GoogleSignIn SDK) — id_token을 보내고 `AuthSession`을 받는다.
    case googleNative
    /// Kakao 네이티브(Kakao SDK) — access token을 보내고 `AuthSession`을 받는다.
    case kakaoNative
    /// 네이티브 데모 로그인. 웹 `/auth/demo`(쿠키)와 세션은 같고 전달만 다르다 —
    /// `AuthSession`(토큰)을 body로 받아 Keychain에 담는다. body가 없다.
    case demoNative
    /// 네이티브 웹-redirect(ASWebAuthenticationSession)의 일회용 코드를 토큰으로 교환.
    case nativeExchange
    /// 액세스 토큰 갱신. 네이티브는 자격증명을 body로 보내고 body로 받는다.
    case refresh
    /// 세션 확인 + 사용자 정보.
    case me
    case logout
    /// 내 활성 세션 목록(대시보드).
    case sessions
    /// 세션 하나를 원격 폐기. id는 서버가 준 값을 그대로 되돌려 보낸다.
    case revokeSession(id: String)
    /// 내 모든 세션을 폐기 — 현재 세션까지 포함한다.
    case revokeAllSessions
    /// 내 기기**들**에 알림을 보낸다. **등록 토큰은 싣지 않는다** — 서버가 세션
    /// 레코드에서 꺼낸다(plan/push.md §5-3). 대상이 여럿이라 세션 하위 경로가 아니다.
    case sendPush

    var path: String {
        switch self {
        case .appleNative: "/auth/apple/native"
        case .googleNative: "/auth/google/native"
        case .kakaoNative: "/auth/kakao/native"
        case .demoNative: "/auth/demo/native"
        case .nativeExchange: "/auth/native/exchange"
        case .refresh: "/auth/refresh"
        case .me: "/auth/me"
        case .logout: "/auth/logout"
        case .sessions: "/auth/sessions"
        case .revokeSession(let id): "/auth/sessions/\(id)/revoke"
        case .revokeAllSessions: "/auth/sessions/revoke-all"
        case .sendPush: "/auth/push/send"
        }
    }

    var method: String {
        switch self {
        case .me, .sessions: "GET"
        case .appleNative, .googleNative, .kakaoNative, .demoNative, .nativeExchange,
            .refresh, .logout, .revokeSession, .revokeAllSessions, .sendPush: "POST"
        }
    }

    /// `Authorization: Bearer` 헤더가 필요한가.
    /// 로그아웃은 서버가 토큰 없이도 받아주지만(멱등한 정리), 세션을 특정해 폐기하려면
    /// 토큰을 실어야 한다.
    var requiresAuth: Bool {
        switch self {
        case .me, .logout, .sessions, .revokeSession, .revokeAllSessions, .sendPush: true
        case .appleNative, .googleNative, .kakaoNative, .demoNative, .nativeExchange,
            .refresh:
            false
        }
    }

    /// 401의 뒷일(갱신·세션 종료)을 전송 계층이 맡을지.
    ///
    /// 인증 자신의 호출(`/auth/me`·`/auth/logout`)만 끈다 — 그 결정은 `AuthManager`의
    /// 것이고, 그쪽은 이미 자기 직렬화 안에서 이 호출을 하므로 여기서 부르면 그 안으로
    /// 다시 들어가게 된다. 나머지는 토큰이 없어 되살릴 세션도 없다.
    var recoversSession: Bool {
        switch self {
        case .sessions, .revokeSession, .revokeAllSessions, .sendPush: true
        case .me, .logout, .appleNative, .googleNative, .kakaoNative, .demoNative,
            .nativeExchange, .refresh:
            false
        }
    }

    var url: URL {
        APIConfiguration.baseURL.appending(path: path)
    }
}
