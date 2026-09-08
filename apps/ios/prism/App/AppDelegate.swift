//
//  AppDelegate.swift
//  prism
//
//  Path: App/AppDelegate.swift
//

import FirebaseCore
import FirebaseMessaging
import UIKit
import UserNotifications

/// SwiftUI 라이프사이클에 **대리자를 하나 끼운다.**
///
/// 이 앱은 `prismApp`이 전부인 순수 SwiftUI 앱이었다. 그런데 APNs 등록 결과
/// (`didRegisterForRemoteNotificationsWithDeviceToken`)와 알림 탭
/// (`UNUserNotificationCenterDelegate`)은 **UIKit 대리자에게만 온다** — SwiftUI에
/// 대응물이 없다. 그래서 `@UIApplicationDelegateAdaptor`로 이 클래스를 끼운다.
///
/// 여기서 하는 일은 배선뿐이다. 상태는 `ServiceContainer`가 쥔다.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // `GoogleService-Info.plist`는 배포마다 다른 값이라 레포에 두지 않는다(.gitignore).
        // **없으면 `configure()`가 앱을 죽인다** — 새로 클론한 사람이 그대로 빌드해
        // 실행할 수 있어야 하므로(Secrets.xcconfig과 같은 성질), 있을 때만 켠다.
        // 없으면 푸시만 꺼진 앱이 되고, 그 사실은 화면이 말한다(`Notifications off`).
        guard PushConfiguration.isConfigured else {
            Log.ui("push not configured — notifications disabled")
            return true
        }
        FirebaseApp.configure()
        UNUserNotificationCenter.current().delegate = self
        // **버튼은 미리 등록해 둔 조합만 쓸 수 있다.** 서버가 그때그때 만든 목록을
        // 보낼 방법이 없어 조합 자체를 계약이 정한다(plan/push.md §5-13).
        UNUserNotificationCenter.current().setNotificationCategories(
            PushCategories.all(localization: ServiceContainer.shared.localization)
        )
        Messaging.messaging().delegate = self
        // 알림 권한은 **로그인 화면에서** 묻는다(plan/push.md §5-2) — 여기서는 이미
        // 허용된 기기가 APNs에 다시 등록되게만 한다.
        application.registerForRemoteNotifications()
        return true
    }

    /// APNs 토큰을 FCM에 넘긴다. **이것 없이는 `Messaging.token()`이 끝나지 않는다.**
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // 사유는 남기지 않는다 — 실패는 갈래가 하나뿐이고(등록 못 함), 화면은 그 결과를
        // `Notifications off`로 이미 말한다.
        Log.error("apns registration failed")
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    /// 앱이 떠 있을 때 온 알림도 **보이게** 한다.
    ///
    /// 기본값은 "앱이 앞에 있으면 그리지 않는다"인데, 그러면 다른 화면을 보고 있는
    /// 사용자에게 아무 일도 일어나지 않는다. 시연에서도 이쪽이 낫다.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    /// 알림을 눌렀다 — 통화면 그 통화를 열어 달라고 남긴다.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        // 닫기는 **아무것도 열지 않는다** — 알림을 치우려고 누른 사람에게 화면을
        // 띄우면 버튼을 둔 의미가 반대로 뒤집힌다.
        if response.actionIdentifier == PushCategories.dismissAction { return }

        let info = response.notification.request.content.userInfo
        PushLinks.shared.offer(
            kind: info[PushDataKey.kind] as? String,
            callId: info[PushDataKey.callId] as? String
        )
        // 링크가 있으면 그 주소를 연다. https만 서버가 통과시켰으므로 여기서 다시
        // 검사하지 않는다 — 두 곳에서 검사하면 규칙이 둘이 되고 한쪽만 고쳐진다.
        await PushLinks.shared.open(info[PushDataKey.link] as? String)
    }
}

extension AppDelegate: MessagingDelegate {
    /// 토큰이 회전했다(재설치·데이터 삭제·백업 복원).
    ///
    /// **여기서 할 수 있는 일이 없다.** 토큰은 로그인 시점에만 세션에 실리고
    /// (plan/push.md §5-2), 살아 있는 세션을 고치는 경로는 두지 않았다. 대신 푸시
    /// 화면이 지금 토큰과 로그인 때 보낸 값을 대조해 "다시 로그인하세요"를 띄운다.
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        // 토큰 값은 로그에 남기지 않는다 — 설치 단위 식별자이고 로그는 기기에 남는다.
        Log.ui("fcm registration token updated")
    }
}
