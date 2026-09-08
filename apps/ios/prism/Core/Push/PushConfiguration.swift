//
//  PushConfiguration.swift
//  prism
//
//  Path: Core/Push/PushConfiguration.swift
//

import Foundation

/// 이 빌드에 FCM 설정이 들어 있는가.
///
/// `GoogleService-Info.plist`는 비밀이 아니지만(클라이언트에 박히는 값) 배포마다 다른
/// 값이라 레포에 두지 않는다(`.gitignore`, `Secrets.xcconfig`과 같은 규칙). 없으면
/// `FirebaseApp.configure()`가 앱을 죽이므로, **부르기 전에 여기서 확인한다** —
/// 새로 클론한 사람이 그대로 빌드해 실행할 수 있어야 한다.
nonisolated enum PushConfiguration {
    static let isConfigured: Bool =
        Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil
}
