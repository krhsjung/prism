//
//  StorageKeys.swift
//  prism
//
//  Path: Core/Utils/StorageKeys.swift
//

/// UserDefaults 키.
///
/// 웹과 같은 이름을 쓴다(`prism.theme` / `prism.locale`) — 같은 설정을 플랫폼마다
/// 다른 이름으로 부르면, 나중에 설정을 계정에 동기화할 때 매핑 표가 하나 더 생긴다.
///
/// ⚠️ 세션 자격증명은 여기 오지 않는다. UserDefaults는 평문 plist라
/// 액세스 토큰·리프레시 자격증명은 Keychain에만 둔다(plan/auth.md §6).
enum StorageKeys {
    static let theme = "prism.theme"
    static let locale = "prism.locale"
}
