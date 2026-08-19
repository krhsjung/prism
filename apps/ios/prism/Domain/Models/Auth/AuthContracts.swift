//
//  AuthContracts.swift
//  prism
//
//  Path: Domain/Models/Auth/AuthContracts.swift
//

import Foundation

// 서버와 공유하는 API 계약의 iOS 사본.
//
// 원천은 `apps/server/libs/common/src/types/contracts.ts`다. 웹은 생성 사본
// (`contracts.gen.ts`)을 쓰지만 언어가 달라 그대로 옮길 수 없으므로, 여기서는 손으로
// 옮기고 **필드 이름·오류 코드 문자열을 원천과 똑같이** 유지한다.
// 계약이 바뀌면 이 파일도 같이 고칠 것 — 어긋나면 디코딩이 실패해 드러난다.

/// 로그인 수단. `demo`는 OAuth가 아니라 시드된 데모 계정이다(plan/auth.md §2.1-b).
enum AuthProvider: String, CaseIterable, Codable, Sendable {
    case google
    case apple
    case kakao
    case demo

    /// 버튼에 그릴 문구.
    var messageKey: MessageKey {
        switch self {
        case .google: .authContinueWithGoogle
        case .apple: .authContinueWithApple
        case .kakao: .authContinueWithKakao
        case .demo: .authTryTheDemo
        }
    }
}

/// 소셜 로그인 **방식** — 같은 provider라도 앱은 두 경로로 로그인할 수 있다.
///  - native: provider 네이티브 SDK로 앱 안에서 토큰을 받는다(Apple/Google/Kakao).
///  - redirect: 시스템 웹 세션(ASWebAuthenticationSession)으로 서버 웹 OAuth를 진행하고
///    일회용 코드를 토큰과 교환한다. (서버는 flow=native로 처리)
enum AuthMethod: String, CaseIterable, Sendable {
    case native
    case redirect
}

/// 클라이언트에 반환되는 사용자 모델.
/// 개인정보 미저장 정책에 따라 email이 없고, `displayName`은 DB가 아니라 세션에서 온다.
///
/// 문자열 필드는 **빈 값을 거부한다** — 서버 계약의 `decodeString`이 `v === ''`을 막는
/// 것과 같은 규칙이다. 합성 `Codable`은 빈 `id`·빈 토큰을 통과시켜, 인증됐다고 믿는
/// 순간 실제로는 쓸 수 없는 값이 자격증명으로 저장되는 것을 막지 못한다.
struct User: Codable, Equatable, Sendable {
    let id: String
    let provider: AuthProvider
    let displayName: String
    let createdAt: String

    init(id: String, provider: AuthProvider, displayName: String, createdAt: String) {
        self.id = id
        self.provider = provider
        self.displayName = displayName
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id, provider, displayName, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeNonEmptyString(forKey: .id)
        provider = try c.decode(AuthProvider.self, forKey: .provider)
        displayName = try c.decodeNonEmptyString(forKey: .displayName)
        createdAt = try c.decodeNonEmptyString(forKey: .createdAt)
    }
}

/// 네이티브 로그인·갱신 응답. 웹의 쿠키 흐름에는 쓰이지 않는다 —
/// 네이티브는 쿠키 저장소가 부자연스러워 Bearer를 유지하고 Keychain에 보관한다.
struct AuthSession: Codable, Equatable, Sendable {
    let accessToken: String
    /// 액세스 토큰이 만료됐을 때 세션을 잇는 자격증명(1회용 — 쓰면 회전된다).
    let refreshToken: String
    let user: User

    init(accessToken: String, refreshToken: String, user: User) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.user = user
    }

    enum CodingKeys: String, CodingKey {
        case accessToken, refreshToken, user
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // 빈 토큰을 저장하면 Bearer 헤더가 `Bearer `가 되어 매 요청이 401로 돈다.
        accessToken = try c.decodeNonEmptyString(forKey: .accessToken)
        refreshToken = try c.decodeNonEmptyString(forKey: .refreshToken)
        user = try c.decode(User.self, forKey: .user)
    }
}

/// 쿠키 흐름(웹)의 로그인·세션 확인 응답. 토큰을 담지 않는다.
struct SessionUser: Codable, Equatable, Sendable {
    let user: User
    let accessTokenTtlMs: Int

    init(user: User, accessTokenTtlMs: Int) {
        self.user = user
        self.accessTokenTtlMs = accessTokenTtlMs
    }

    enum CodingKeys: String, CodingKey {
        case user, accessTokenTtlMs
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        user = try c.decode(User.self, forKey: .user)
        // 서버 계약의 decodePositiveInt와 같게 양수만 받는다(수명값이 0·음수일 수 없다).
        let ttl = try c.decode(Int.self, forKey: .accessTokenTtlMs)
        guard ttl > 0 else {
            throw DecodingError.dataCorruptedError(
                forKey: .accessTokenTtlMs,
                in: c,
                debugDescription: "expected positive integer",
            )
        }
        accessTokenTtlMs = ttl
    }
}

// `AuthErrorCode`·`ClientErrorCode`·`AUTH_PROVIDERS`는 서버 계약에서 **생성**된다
// (Contracts.gen.swift, `pnpm gen:contracts`). 오류 코드 문자열이 서버에서 바뀌면 그쪽만
// 고치면 되고, 어긋나면 `--check` 드리프트 가드가 잡는다.

/// 서버 계약에 없는 **앱 전용** 코드 — 서버는 발신하지 않고 앱이 스스로 만든다.
enum AppErrorCode {
    /// 서버에 그 흐름의 네이티브 엔드포인트가 아직 없다(웹 전용 경로).
    static let providerUnavailable = "PROVIDER_UNAVAILABLE"
}

/// 오류 응답 body. 서버는 항상 `{ "error": "<코드>" }` 형태로 준다.
struct ErrorResponse: Decodable, Sendable {
    let error: String
}

// MARK: - 경계 디코딩

private extension KeyedDecodingContainer {
    /// 비어 있거나 공백만 있는 문자열을 거부한다 — 서버 계약의 `decodeString`(v === '' 거부)과
    /// 같은 취지다. 공백만 있는 토큰·id는 형식상 존재하지만 쓸 수 없으므로 여기서 막는다.
    /// 원문은 그대로 돌려준다(트림은 검사용일 뿐 — 토큰·id를 임의로 바꾸지 않는다).
    func decodeNonEmptyString(forKey key: Key) throws -> String {
        let value = try decode(String.self, forKey: key)
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "empty or whitespace-only string not allowed",
            )
        }
        return value
    }
}
