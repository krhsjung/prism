//
//  SocialSignIn.swift
//  prism
//
//  Path: Features/Auth/SocialSignIn.swift
//

import Foundation

/// provider 네이티브 SDK 로그인의 추상화 — 서버에 보낼 **토큰만** 얻어 온다.
///
/// `AuthManager`가 구체 SDK가 아니라 이 프로토콜에 의존해, SDK 없이도 로직을 테스트할 수
/// 있고 provider별 SDK 세부는 컨트롤러 안에 격리된다. 반환값은 서버
/// `/auth/{provider}/native`가 검증할 자격증명이다: Google=id_token, Kakao=access token.
///
/// 프로토콜 자체는 격리하지 않는다(nonisolated) — 요구사항이 전부 `async`라 실제 UI를
/// 띄우는 `@MainActor` 컨트롤러가 그대로 witness할 수 있다. 다만 이 모듈은 기본 격리가
/// MainActor라 아래 `UnavailableSocialSignIn`의 암묵 init도 `@MainActor`이므로,
/// `AuthManager.init`은 그 기본값을 기본 인자가 아니라 (메인 액터인) init 본문에서 만든다.
/// 사용자가 취소하면 `CancellationError`를 던진다(오류가 아니라 조용한 복귀 — Apple과 동일).
protocol SocialSignInProviding {
    func googleIdToken() async throws -> String
    func kakaoAccessToken() async throws -> String
}

/// SDK/키 미설정 시의 기본 — 네이티브 경로를 막는다(데모·Apple은 그대로 동작). 테스트 기본값.
struct UnavailableSocialSignIn: SocialSignInProviding {
    func googleIdToken() async throws -> String { throw APIError.providerUnavailable }
    func kakaoAccessToken() async throws -> String { throw APIError.providerUnavailable }
}

/// Google/Kakao 컨트롤러를 묶은 실제 구현. 컨테이너가 조립한다.
///
/// 컨트롤러(`@MainActor`)의 async 메서드를 `await`로 부르므로 이 타입 자체는 격리하지
/// 않아도 된다 — `await`가 메인 액터로 홉한다.
struct SocialSignInController: SocialSignInProviding {
    let google: GoogleSignInController
    let kakao: KakaoSignInController

    func googleIdToken() async throws -> String { try await google.idToken() }
    func kakaoAccessToken() async throws -> String { try await kakao.accessToken() }
}
