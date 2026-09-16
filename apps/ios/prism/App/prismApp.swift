//
//  prismApp.swift
//  prism
//
//  Path: App/prismApp.swift
//  Created by Hee Seok Jung on 8/5/26.
//

import SwiftUI

@main
struct prismApp: App {
    /// 의존성은 한 곳에서 조립된다(Core/DI/ServiceContainer.swift).
    /// 여기서는 화면이 읽을 수 있도록 환경에 얹기만 한다.
    private let container = ServiceContainer.shared

    /// APNs 등록 결과와 알림 탭은 **UIKit 대리자에게만 온다** — SwiftUI에 대응물이
    /// 없어 이 한 줄로 대리자를 끼운다(App/AppDelegate.swift).
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        // 소셜 SDK 초기화(Kakao 앱 키 등)는 로그인 전에 한 번 끝나 있어야 한다.
        SocialSDK.initialize()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(container.authManager)
                .environment(container.localization)
                .environment(container.theme)
                // 카카오톡·구글에서 앱으로 돌아오는 redirect를 해당 SDK로 넘긴다.
                .onOpenURL { url in
                    _ = SocialSDK.handle(url)
                }
        }
    }
}
