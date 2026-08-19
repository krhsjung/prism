//
//  SocialSDK.swift
//  prism
//
//  Path: Features/Auth/SocialSDK.swift
//

import Foundation
import GoogleSignIn
import KakaoSDKAuth
import KakaoSDKCommon

/// 소셜 로그인 SDK의 앱 수준 배선(초기화 + redirect URL 처리)을 한곳에 모은다.
///
/// SDK import가 여기와 각 컨트롤러에만 있어 `prismApp`은 깔끔하게 유지된다.
/// GoogleSignIn은 Info.plist의 `GIDClientID`를 기본 설정으로 읽으므로 별도 초기화가
/// 없고, Kakao만 앱 키로 한 번 초기화한다.
enum SocialSDK {
    /// Google iOS 클라이언트 ID. GoogleSignIn이 스스로 읽는 값과 같은 출처(Info.plist의
    /// `GIDClientID`)지만, **비어 있는지 미리 확인**하려고 여기서도 읽는다 — 값이 없으면
    /// SDK가 Swift로 못 잡는 ObjC 예외(`You must specify |clientID| in |GIDConfiguration|`)로
    /// 앱을 죽인다.
    static let googleClientID = infoValue("GIDClientID")

    /// Kakao 네이티브 앱 키. 없으면 `initSDK`를 건너뛰므로 Kakao 호출도 막아야 한다.
    static let kakaoAppKey = infoValue("KAKAO_NATIVE_APP_KEY")

    /// Kakao SDK 초기화. 키가 없으면(미설정 빌드) 건너뛴다 — 카카오 로그인만 막히고
    /// Google·Apple은 그대로 동작한다.
    static func initialize() {
        guard let key = kakaoAppKey else {
            Log.auth("KAKAO_NATIVE_APP_KEY not set — Kakao login disabled")
            return
        }
        KakaoSDK.initSDK(appKey: key)
    }

    /// Info.plist 문자열 값. 미설정 빌드에서는 `$(VAR)`가 **빈 문자열**로 치환되므로
    /// 빈 값도 nil과 같이 본다.
    private static func infoValue(_ key: String) -> String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// 외부 앱(카카오톡·구글)에서 돌아오는 redirect를 해당 SDK로 넘긴다.
    /// (카카오톡 로그인·구글 계정 전환 등이 앱으로 복귀할 때 호출된다.)
    @MainActor
    static func handle(_ url: URL) -> Bool {
        if AuthApi.isKakaoTalkLoginUrl(url) {
            return AuthController.handleOpenUrl(url: url)
        }
        return GIDSignIn.sharedInstance.handle(url)
    }
}
