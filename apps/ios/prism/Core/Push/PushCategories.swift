//
//  PushCategories.swift
//  prism
//
//  Path: Core/Push/PushCategories.swift
//

import UserNotifications

/// 알림에 붙는 버튼 — iOS가 **미리 등록해 둔 조합**만 쓸 수 있다.
///
/// 서버가 그때그때 만든 버튼 목록을 보낼 방법이 없어 조합 자체를 계약이 정하고
/// (`PushActionSet`), 서버는 `aps.category`로 그중 하나를 고른다(plan/push.md §5-13).
///
/// **문구는 여기서 그린다.** 등록은 앱이 뜰 때 한 번인데 그때는 요청이 없어 받는 사람의
/// 언어를 서버가 알 수 없다 — 세 플랫폼이 각자 자기 i18n으로 그리는 이유다.
///
/// 언어를 바꾸면 **그 자리에서 다시 등록한다**(`register`, RootView가 `locale`의 변화에
/// 부른다) — 등록은 덮어쓰기라 이미 떠 있는 알림은 그대로고, 다음 알림부터 새 문구가 붙는다.
/// 문구를 서버가 보내면 등록 자체가 필요 없지만, 그러려면 서버 문구 마스터에 사본을 두어야
/// 하고 그 사본은 client.csv와 갈라진다.
enum PushCategories {
    /// 지금 언어의 문구로 조합을 (다시) 등록한다. 앱이 뜰 때와 언어를 바꿀 때 부른다.
    @MainActor
    static func register(localization: LocalizationStore) {
        UNUserNotificationCenter.current().setNotificationCategories(all(localization: localization))
    }

    static let openAction = "prism.action.open"
    static let dismissAction = "prism.action.dismiss"

    /// `APNS_CATEGORIES`(서버)와 **같은 식별자**여야 한다.
    private static let open = "prism.open"
    private static let openDismiss = "prism.open_dismiss"

    @MainActor
    static func all(localization: LocalizationStore) -> Set<UNNotificationCategory> {
        let openButton = UNNotificationAction(
            identifier: openAction,
            title: localization(.pushActionOpen),
            options: [.foreground]
        )
        let dismissButton = UNNotificationAction(
            identifier: dismissAction,
            title: localization(.pushActionDismiss),
            // 앱을 열지 않는다 — 알림만 사라진다.
            options: []
        )
        return [
            UNNotificationCategory(
                identifier: open,
                actions: [openButton],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: openDismiss,
                actions: [openButton, dismissButton],
                intentIdentifiers: [],
                options: []
            ),
        ]
    }
}
