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
enum APIConfiguration {
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
        }
    }

    var method: String {
        switch self {
        case .me: "GET"
        case .appleNative, .googleNative, .kakaoNative, .demoNative, .nativeExchange,
            .refresh, .logout: "POST"
        }
    }

    /// `Authorization: Bearer` 헤더가 필요한가.
    /// 로그아웃은 서버가 토큰 없이도 받아주지만(멱등한 정리), 세션을 특정해 폐기하려면
    /// 토큰을 실어야 한다.
    var requiresAuth: Bool {
        switch self {
        case .me, .logout: true
        case .appleNative, .googleNative, .kakaoNative, .demoNative, .nativeExchange,
            .refresh:
            false
        }
    }

    var url: URL {
        APIConfiguration.baseURL.appending(path: path)
    }
}
