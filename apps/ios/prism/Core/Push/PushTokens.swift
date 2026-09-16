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

/// 등록 코디네이터(`PushRegistration`)가 이 기기에 대해 묻고 남기는 것.
///
/// 프로토콜인 이유는 테스트다 — 실물은 Firebase와 시스템 설정을 읽어 테스트에서 세울 수
/// 없고, 코디네이터가 보는 것은 이 넷뿐이다.
@MainActor
protocol PushDevice: AnyObject {
    func permission() async -> PushPermission
    /// 지금의 등록 토큰. 받을 수 없으면 nil.
    func current() async -> String?
    /// 이 기기가 받기로 했는가 — 사람의 선택.
    var wanted: Bool { get }
    func rememberWanted(_ wanted: Bool)
    /// 끄기를 **시작했다** — 떼는 도중 앱이 죽거나 떼지 못해도 다음 맞추기가 이어서 뗀다.
    var disablePending: Bool { get }
    func rememberDisablePending(_ pending: Bool)
}

/// 이 기기의 FCM 등록 토큰과 알림 권한.
///
/// 토큰은 **살아 있는 세션에 붙는다**(`POST /auth/push/register`, plan/push.md §5-2를
/// 뒤집은 결과) — 로그인은 로그인만 하고, 붙이는 일은 `PushRegistration`이 한다.
/// 권한을 주지 않아도 로그인은 그대로 된다 — 그 세션이 `Notifications off`가 될 뿐이다.
@MainActor
final class PushTokens: PushDevice {
    func permission() async -> PushPermission {
        guard PushConfiguration.isConfigured else { return .unsupported }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: .granted
        case .denied: .denied
        default: .askable
        }
    }

    /// 권한을 묻는다 — **토큰은 받지 않는다.** 토큰을 받아 붙이는 일은 코디네이터의 줄
    /// 안에서 한다(`PushRegistration.enable`) — 여기서도 받으면 주인이 둘이 된다.
    ///
    /// **진입만으로 부르지 않는다.** 이 저장소가 카메라에 세운 규칙("명시적 제스처
    /// 뒤에만", plan/webrtc.md §7)과 같은 줄이다 — 푸시 화면의 `알림 켜기`만 부른다.
    func requestPermission() async -> Bool {
        guard PushConfiguration.isConfigured else { return false }
        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return false }
        // APNs 등록이 끝나야 FCM 토큰이 나온다 — 대리자가 그 결과를 Messaging에 넘긴다.
        // 결말은 **시도마다** 새로 기다린다: 앞 시도가 실패로 끝났다고 이번 시도의 콜백을
        // 기다리지 않으면, 다시 켜기가 APNs보다 먼저 토큰을 요청해 또 실패한다.
        apnsSettled = false
        UIApplication.shared.registerForRemoteNotifications()
        return true
    }

    /// 이 설치의 토큰을 **버린다** — 세션이 끝날 때 부른다(`AuthManager`).
    ///
    /// 로그아웃이 서버에서 실패해도 로컬은 지워지는데(사용자가 "로그아웃"으로 기대하는
    /// 최소한이다), 그러면 서버의 세션은 살아 있고 그 안의 토큰은 **이 기기**를 가리킨다.
    /// 다음에 다른 계정이 이 기기에 로그인하면 앞 계정의 알림(통화 제목·문구)이 여기로
    /// 온다. 토큰을 버리면 그 세션의 토큰은 죽은 값이 되고 — 다음 발송·통화가 거부를
    /// 받는 순간 서버가 세션에서 뗀다(`clearPushTokenIfMatches`).
    ///
    /// 성공한 로그아웃에서도 부른다 — 세션이 이미 사라져 잃을 것이 없고, 갈래를 둘로
    /// 두면 어느 쪽만 고쳐지는 날이 온다.
    ///
    /// **버려야 한다는 사실을 먼저 남긴다**(`pushPendingDelete`). 지금 실패하거나 앱이
    /// 죽어도 다음에 토큰을 얻으려는 자리(`current`)가 먼저 버리고, 버리지 못하면 토큰을
    /// 주지 않는다 — 앞 계정의 세션이 가리키는 값으로 새 계정을 등록하지 않기 위해서다.
    func deleteToken() {
        guard PushConfiguration.isConfigured else { return }
        UserDefaults.standard.set(true, forKey: StorageKeys.pushPendingDelete)
        Task { _ = await performDeleteToken() }
    }

    /// 버리기의 본체 — **한 번에 하나만 돈다.** 로그아웃과 다음 등록이 같은 순간에 부르면
    /// 같은 일을 기다리고, 성공하면 표식을 지운다.
    private var deleting: Task<Bool, Never>?

    private func performDeleteToken() async -> Bool {
        if let deleting { return await deleting.value }
        let task = Task<Bool, Never> {
            defer { self.deleting = nil }
            do {
                try await Messaging.messaging().deleteToken()
                UserDefaults.standard.removeObject(forKey: StorageKeys.pushPendingDelete)
                return true
            } catch {
                Log.ui("fcm token delete failed — will retry before the next registration")
                return false
            }
        }
        deleting = task
        return await task.value
    }

    /// 지금의 등록 토큰. 실패하면 nil — 로그인은 계속돼야 한다.
    ///
    /// ⚠️ **권한이 없으면 주지 않는다.** FCM 토큰은 알림 권한과 무관하게 존재하므로 이
    /// 문이 없으면, 방금 권한을 거부한 사람에게도 토큰이 나온다 — 그리고 호출부가 그것을
    /// 등록해 버린다. 그러면 화면은 "알림이 차단돼 있습니다"를 그리는데 서버 행은
    /// 등록됨이고, 다른 기기의 통화 로비는 이 기기를 `Will notify`로 그린다.
    /// 웹(`requestPermissionAndToken`)·Android(`PushTokens.current`)가 같은 문을 갖고 있다.
    func current() async -> String? {
        guard PushConfiguration.isConfigured else { return nil }
        guard await permission() == .granted else { return nil }
        // 앞 세션의 토큰을 아직 버리지 못했다면 **먼저 버린다.** 실패하면 토큰을 주지
        // 않는다 — 앞 계정의 세션이 가리키는 값이 그대로 새 계정의 등록이 되면 안 된다.
        if UserDefaults.standard.bool(forKey: StorageKeys.pushPendingDelete) {
            guard await performDeleteToken() else { return nil }
        }
        // APNs 등록이 끝나야 FCM 토큰이 나온다(`Messaging.token()`은 APNs 토큰이 없으면 바로
        // 실패한다). `알림 켜기`가 권한을 받고 등록을 **막 시작한** 직후가 정확히 그 순간이라,
        // 기다리지 않으면 첫 켜기가 조용히 실패하고 사람은 한 번 더 눌러야 한다. 대리자가
        // 결과(성공·실패)를 넘길 때까지, 길어야 잠깐 기다린다.
        await waitForAPNsRegistration()
        do {
            return try await Messaging.messaging().token()
        } catch {
            // 사유는 남기지 않는다 — 결말은 하나뿐이고(토큰 없음), 화면이 그것을 말한다.
            Log.ui("fcm token unavailable")
            return nil
        }
    }

    /// **이번 시도의** APNs 등록이 결말(성공·실패)을 냈다 — `AppDelegate`의 두 대리자 메서드가
    /// 넘기고, `requestPermission`이 새 시도를 시작할 때 되돌린다.
    private var apnsSettled = false

    func apnsRegistrationSettled() {
        apnsSettled = true
    }

    /// APNs 토큰이 생기거나 등록이 결말을 낼 때까지 기다린다 — 상한 안에서만(끝없이 기다리면
    /// 켜기가 멈춘다). 이미 토큰이 있으면 바로 돌아온다.
    private func waitForAPNsRegistration() async {
        for _ in 0..<Self.apnsWaitTicks where Messaging.messaging().apnsToken == nil && !apnsSettled {
            try? await Task.sleep(for: .milliseconds(Self.apnsWaitTickMs))
        }
    }

    private static let apnsWaitTicks = 50
    private static let apnsWaitTickMs = 200

    /// 이 기기가 **받기로 했는가**. 토큰이 아니라 사람의 선택을 남긴다.
    ///
    /// 등록은 세션에 붙으므로 로그아웃하면 함께 사라진다(plan/push.md §5-2). 그때마다 다시
    /// 누르게 하면 토글이 "켜 두는 것"이 아니라 "매번 켜는 것"이 된다 — 그래서 선택만
    /// 남기고, 로그인한 뒤 그 선택대로 조용히 다시 붙인다(§5-16).
    ///
    /// **설치 단위다 — 계정 단위가 아니다**(§5-21). "이 기기가 받는다"는 선택이라 다음에
    /// 로그인한 계정도 그대로 받는다. 앞 계정의 알림이 새는 것은 아니다 — 그 세션의
    /// 토큰은 로그아웃에서 버렸다(`deleteToken`).
    ///
    /// **토큰을 남기지 않는 것이 핵심이다.** 토큰은 회전하므로 저장하면 금세 거짓이 된다.
    func rememberWanted(_ wanted: Bool) {
        UserDefaults.standard.set(wanted, forKey: StorageKeys.pushWanted)
    }

    var wanted: Bool {
        UserDefaults.standard.bool(forKey: StorageKeys.pushWanted)
    }

    /// 끄기를 시작했다는 표식. 선택(`wanted`)은 서버에서 뗀 뒤에야 바꾸므로, 그 사이에 앱이
    /// 죽으면 선택은 켜진 채 서버는 떼였거나 남았거나다 — 이 표식이 "끄다 만 것"임을 말한다.
    func rememberDisablePending(_ pending: Bool) {
        UserDefaults.standard.set(pending, forKey: StorageKeys.pushDisablePending)
    }

    var disablePending: Bool {
        UserDefaults.standard.bool(forKey: StorageKeys.pushDisablePending)
    }
}
