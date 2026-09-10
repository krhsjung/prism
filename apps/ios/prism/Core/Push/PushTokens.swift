//
//  PushTokens.swift
//  prism
//
//  Path: Core/Push/PushTokens.swift
//

import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

/// 이 기기의 알림 상태. 화면이 그릴 수 있는 갈래가 그대로다.
enum PushPermission {
    /// 설정이 없는 빌드 — 물어도 소용이 없다.
    case unsupported
    /// 아직 안 물었다 — 누를 수 있는 줄을 보여 준다.
    case askable
    case granted
    /// 사용자가 막았다. **다시 물을 수 없다** — 설정으로 안내한다.
    case denied
}

/// 이 기기의 FCM 등록 토큰.
///
/// **토큰은 로그인 요청에 실려야 세션 안으로 들어간다**(plan/push.md §5-2) — 살아 있는
/// 세션 레코드를 고치는 경로를 두지 않기로 했기 때문이다. 그래서 로그인 화면이 먼저
/// 권한을 받고 여기서 토큰을 얻은 뒤 로그인을 부른다.
///
/// 권한을 주지 않아도 로그인은 그대로 된다 — 그 세션이 `Notifications off`가 될 뿐이다.
@MainActor
final class PushTokens {
    func permission() async -> PushPermission {
        guard PushConfiguration.isConfigured else { return .unsupported }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: .granted
        case .denied: .denied
        default: .askable
        }
    }

    /// 권한을 묻고 등록 토큰을 받는다.
    ///
    /// **진입만으로 부르지 않는다.** 이 저장소가 카메라에 세운 규칙("명시적 제스처
    /// 뒤에만", plan/webrtc.md §7)과 같은 줄이다 — 로그인 화면의 `알림 켜기`와 푸시
    /// 화면에서만 부른다.
    func requestPermissionAndToken() async -> String? {
        guard PushConfiguration.isConfigured else { return nil }
        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return nil }
        // APNs 등록이 끝나야 FCM 토큰이 나온다 — 대리자가 그 결과를 Messaging에 넘긴다.
        UIApplication.shared.registerForRemoteNotifications()
        return await current()
    }

    /// 지금의 등록 토큰. 실패하면 nil — 로그인은 계속돼야 한다.
    func current() async -> String? {
        guard PushConfiguration.isConfigured else { return nil }
        do {
            return try await Messaging.messaging().token()
        } catch {
            // 사유는 남기지 않는다 — 결말은 하나뿐이고(토큰 없음), 화면이 그것을 말한다.
            Log.ui("fcm token unavailable")
            return nil
        }
    }

    /// 이 기기가 **받기로 했는가**. 토큰이 아니라 사람의 선택을 남긴다.
    ///
    /// 등록은 세션에 붙으므로 로그아웃하면 함께 사라진다(plan/push.md §5-2). 그때마다 다시
    /// 누르게 하면 토글이 "켜 두는 것"이 아니라 "매번 켜는 것"이 된다 — 그래서 선택만
    /// 남기고, 로그인한 뒤 그 선택대로 조용히 다시 붙인다(§5-16).
    ///
    /// **토큰을 남기지 않는 것이 핵심이다.** 토큰은 회전하므로 저장하면 금세 거짓이 된다.
    func rememberWanted(_ wanted: Bool) {
        UserDefaults.standard.set(wanted, forKey: StorageKeys.pushWanted)
    }

    var wanted: Bool {
        UserDefaults.standard.bool(forKey: StorageKeys.pushWanted)
    }
}
