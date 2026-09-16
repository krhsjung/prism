//
//  NotificationService.swift
//  prismNotificationService
//
//  Path: prismNotificationService/NotificationService.swift
//

import FirebaseMessaging
import UserNotifications

/// 알림 이미지를 **iOS에서 실제로 보이게** 하는 유일한 방법.
///
/// FCM에 이미지를 실어도 iOS는 그냥 무시한다. 알림을 그리기 전에 이 확장이 불려
/// 이미지를 내려받아 붙여야 하고, 확장이 불리는 조건이 `aps.mutable-content: 1`이다
/// (서버가 이미지가 있을 때만 그 한 줄을 싣는다 — plan/push.md §5-12).
///
/// **하는 일은 하나뿐이다**: FCM 헬퍼에 알림을 넘기고 받아 적는다. 헬퍼가
/// `fcm_options.image`를 읽어 내려받고 첨부까지 만든다.
///
/// 확장은 짧은 시간만 살고, 넘기면 시스템이 `serviceExtensionTimeWillExpire`를 부른 뒤
/// **원본 알림을 그대로 띄운다** — 그때는 이미지 없이 문구만 뜬다. 실패의 결말이
/// "알림이 안 뜬다"가 아니라 "이미지가 빠진다"인 것이 이 설계의 좋은 점이다.
final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        handler = contentHandler
        let mutable = request.content.mutableCopy() as? UNMutableNotificationContent
        content = mutable
        guard let mutable else {
            contentHandler(request.content)
            return
        }
        Messaging.serviceExtension().populateNotificationContent(
            mutable,
            withContentHandler: contentHandler
        )
    }

    /// 시간이 다 됐다 — 지금까지 만든 것을 그대로 띄운다(이미지는 빠질 수 있다).
    override func serviceExtensionTimeWillExpire() {
        guard let handler, let content else { return }
        handler(content)
    }
}
