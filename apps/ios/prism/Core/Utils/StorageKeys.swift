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
/// ⚠️ **`nonisolated`가 필요하다.** 이 타깃은 `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`라
/// 격리를 적지 않은 타입이 전부 MainActor의 것이 된다. 그러면 컴파일 시점 문자열 상수를
/// 네트워크 계층(Sendable)이나 `nonisolated` 함수에서 읽을 때 경고가 난다 —
/// 실제로 `LocalizationStore.detect`가 그랬다.
nonisolated enum StorageKeys {
    static let theme = "prism.theme"
    static let locale = "prism.locale"
    /// 이 기기가 알림을 받기로 했는가(plan/push.md §5-16). 웹·Android와 같은 이름이다.
    static let pushWanted = "prism.push.wanted"
}
