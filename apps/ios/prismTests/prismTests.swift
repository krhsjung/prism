//
//  prismTests.swift
//  prismTests
//
//  Created by Hee Seok Jung on 8/5/26.
//

import Foundation
import Testing
@testable import prism

// 화면 언어를 고르는 규칙. 기기가 주는 태그는 거의 항상 지역까지 붙어 있어(ko-KR)
// 정확히 일치하는 경우가 오히려 드물다 — 여기가 어긋나면 앱이 조용히 영어로만 뜬다.
@Suite("locale negotiation")
struct LocaleNegotiationTests {
    @Test("지역 하위 태그를 떼고 맞춘다")
    func stripsSubtags() {
        #expect(AppLocale.matching("ko-KR") == .ko)
        #expect(AppLocale.matching("ja-JP") == .ja)
        #expect(AppLocale.matching("en") == .en)
    }

    @Test("대소문자·공백은 무시한다")
    func normalizesCasing() {
        #expect(AppLocale.matching(" KO-kr ") == .ko)
    }

    @Test("지원하지 않는 언어는 없음으로 답한다")
    func rejectsUnsupported() {
        #expect(AppLocale.matching("fr-FR") == nil)
        #expect(AppLocale.matching("") == nil)
    }

    @Test("선호 순서대로 훑어 처음 지원되는 언어를 고른다")
    func picksFirstSupported() {
        #expect(AppLocale.negotiated(from: ["fr-FR", "ja-JP", "ko-KR"]) == .ja)
    }

    @Test("하나도 지원하지 않으면 기본 언어로 떨어진다")
    func fallsBackToDefault() {
        #expect(AppLocale.negotiated(from: ["fr-FR"]) == AppLocale.fallback)
        #expect(AppLocale.negotiated(from: []) == AppLocale.fallback)
    }
}

// 앱 안에서 언어를 바꾸는 경로. `String(localized:)`는 시스템 언어로만 해석하므로
// 선택한 언어의 `.lproj` 번들에서 직접 읽는데, 그 번들이 실제로 빌드에 들어갔는지는
// (프로젝트의 knownRegions에 달려 있다) 코드만 봐서는 알 수 없다 — 여기서 확인한다.
@MainActor
@Suite("localization store")
struct LocalizationStoreTests {
    /// 실제 UserDefaults를 건드리지 않도록 테스트마다 빈 저장소를 준다.
    private func makeDefaults() -> UserDefaults {
        let suite = UserDefaults(suiteName: "prismTests.\(UUID().uuidString)")!
        return suite
    }

    @Test("고른 언어의 문구를 돌려준다")
    func readsSelectedLocale() {
        let store = LocalizationStore(defaults: makeDefaults())

        store.setLocale(.ko)
        #expect(store(.authWelcomeBack) == "다시 오셨네요")

        store.setLocale(.ja)
        #expect(store(.authWelcomeBack) == "おかえりなさい")

        store.setLocale(.en)
        #expect(store(.authWelcomeBack) == "Welcome back")
    }

    @Test("모든 언어·모든 키가 번들에 있다")
    func allKeysResolve() {
        let store = LocalizationStore(defaults: makeDefaults())
        for locale in AppLocale.allCases {
            store.setLocale(locale)
            for key in MessageKey.allCases {
                // 키를 못 찾으면 시스템이 키 문자열을 그대로 돌려준다 —
                // 카탈로그에서 빠진 문구를 잡아내는 신호다.
                #expect(store(key) != key.rawValue, "\(locale.rawValue) / \(key.rawValue)")
            }
        }
    }

    @Test("런타임 변수를 채운다")
    func interpolatesValues() {
        let store = LocalizationStore(defaults: makeDefaults())
        store.setLocale(.en)
        #expect(store(.dashboardSignedInAs, ["name": "Ada"]) == "Signed in as Ada")
    }

    @Test("고른 언어는 저장되어 다음 실행에도 유지된다")
    func persistsSelection() {
        let defaults = makeDefaults()
        LocalizationStore(defaults: defaults).setLocale(.ja)
        #expect(LocalizationStore(defaults: defaults).locale == .ja)
    }

    // #6 회귀: 문구를 읽은 뷰가 언어 변경 시 무효화되어야 화면 전체가 새 언어로 다시
    // 그려진다. callAsFunction이 파생 캐시(bundle)만 읽고 locale을 안 읽으면, 언어를
    // 바꿔도 t(...)를 부른 뷰는 observation 의존성이 없어 옛 언어로 남는다.
    @Test("언어를 바꾸면 문구를 읽은 뷰가 무효화된다")
    func invalidatesReadersOnLocaleChange() {
        let store = LocalizationStore(defaults: makeDefaults())
        store.setLocale(.en)

        var invalidated = false
        withObservationTracking {
            _ = store(.authWelcomeBack)
        } onChange: {
            invalidated = true
        }

        store.setLocale(.ja)
        #expect(invalidated)
    }
}

// 오류를 문구가 아니라 코드로 들고 다니는 만큼, 코드 → 문구 매핑이 화면의 전부다.
@Suite("api error messages")
struct APIErrorTests {
    @Test("아는 코드는 전용 문구로 옮긴다")
    func mapsKnownCodes() {
        #expect(APIError(status: 401, code: AuthErrorCode.signinFailed).messageKey == .errorSigninFailed)
        #expect(APIError(status: 503, code: AuthErrorCode.demoDisabled).messageKey == .errorDemoDisabled)
        #expect(APIError.network.messageKey == .errorNetworkError)
        #expect(APIError.providerUnavailable.messageKey == .errorProviderUnavailable)
    }

    @Test("모르는 코드는 일반 문구로 떨어진다")
    func fallsBackToGeneric() {
        // 서버가 새 코드를 내보내도 화면이 깨지지 않아야 한다.
        #expect(APIError(status: 500, code: "SOMETHING_NEW").messageKey == .errorGeneric)
    }

    @Test("갱신할 값어치가 있는 401만 세션 만료로 본다")
    func detectsSessionExpiry() {
        #expect(APIError(status: 401, code: AuthErrorCode.sessionExpired).isSessionExpired)
        // 자격증명이 없거나 폐기된 세션은 갱신해도 같은 이유로 실패한다.
        #expect(!APIError(status: 401, code: AuthErrorCode.unauthorized).isSessionExpired)
        #expect(!APIError(status: 500, code: AuthErrorCode.sessionExpired).isSessionExpired)
    }

    // 자격증명을 지울지(확정 실패) vs 보존할지(일시적 실패)를 가르는 기준.
    // 여기가 어긋나면 오프라인 실행이 유효 세션을 파괴하거나, 폐기된 세션이 남는다.
    @Test("서버가 확정한 인증 실패만 자격증명을 지운다")
    func detectsDefinitiveAuthFailure() {
        #expect(APIError(status: 401, code: AuthErrorCode.invalidToken).isDefinitiveAuthFailure)
        #expect(APIError(status: 401, code: AuthErrorCode.unauthorized).isDefinitiveAuthFailure)
        // 갱신하면 살아나는 401은 확정 실패가 아니다(refresh 경로로 간다).
        #expect(!APIError(status: 401, code: AuthErrorCode.sessionExpired).isDefinitiveAuthFailure)
        // 일시적 실패 — 오프라인·타임아웃·5xx는 자격증명을 보존해야 한다.
        #expect(!APIError.network.isDefinitiveAuthFailure)
        #expect(!APIError(status: 503, code: ClientErrorCode.requestFailed).isDefinitiveAuthFailure)
    }
}

// 네트워크 경계 디코딩 — 빈 문자열·비양수 수명값을 거부한다(서버 계약과 같은 규칙).
// 합성 Codable이 그대로 통과시키면 빈 토큰이 자격증명으로 저장돼 매 요청이 401로 돈다.
@Suite("contract decoding")
struct ContractDecodingTests {
    private let decoder = JSONDecoder()

    private func decodeSession(_ json: String) throws -> AuthSession {
        try decoder.decode(AuthSession.self, from: Data(json.utf8))
    }

    @Test("정상 응답은 그대로 디코딩된다")
    func decodesValidSession() throws {
        let session = try decodeSession("""
        {"accessToken":"a.b.c","refreshToken":"sid.secret","user":
         {"id":"u1","provider":"apple","displayName":"Member","createdAt":"2026-01-01T00:00:00Z"},"accessTokenTtlMs":900000}
        """)
        #expect(session.accessToken == "a.b.c")
        #expect(session.user.provider == .apple)
    }

    @Test("빈 토큰을 거부한다")
    func rejectsEmptyToken() {
        #expect(throws: (any Error).self) {
            try decodeSession("""
            {"accessToken":"","refreshToken":"sid.secret","user":
             {"id":"u1","provider":"apple","displayName":"Member","createdAt":"2026-01-01T00:00:00Z"},"accessTokenTtlMs":900000}
            """)
        }
    }

    @Test("빈 사용자 id를 거부한다")
    func rejectsEmptyUserId() {
        #expect(throws: (any Error).self) {
            try decodeSession("""
            {"accessToken":"a.b.c","refreshToken":"sid.secret","user":
             {"id":"","provider":"apple","displayName":"Member","createdAt":"2026-01-01T00:00:00Z"},"accessTokenTtlMs":900000}
            """)
        }
    }

    @Test("알 수 없는 provider를 거부한다")
    func rejectsUnknownProvider() {
        #expect(throws: (any Error).self) {
            try decodeSession("""
            {"accessToken":"a.b.c","refreshToken":"sid.secret","user":
             {"id":"u1","provider":"facebook","displayName":"Member","createdAt":"2026-01-01T00:00:00Z"},"accessTokenTtlMs":900000}
            """)
        }
    }

    @Test("AuthSession도 비양수 accessTokenTtlMs를 거부한다")
    func rejectsNonPositiveSessionTtl() {
        // 수명이 0이면 선제 갱신 스케줄이 즉시(하한으로) 돌아 요청만 낭비된다.
        #expect(throws: (any Error).self) {
            try decodeSession("""
            {"accessToken":"a.b.c","refreshToken":"sid.secret","user":
             {"id":"u1","provider":"apple","displayName":"Member","createdAt":"2026-01-01T00:00:00Z"},
             "accessTokenTtlMs":0}
            """)
        }
    }

    @Test("비양수 accessTokenTtlMs를 거부한다")
    func rejectsNonPositiveTtl() {
        #expect(throws: (any Error).self) {
            try decoder.decode(SessionUser.self, from: Data("""
            {"user":{"id":"u1","provider":"demo","displayName":"Demo User","createdAt":"2026-01-01T00:00:00Z"},
             "accessTokenTtlMs":0}
            """.utf8))
        }
    }
}
