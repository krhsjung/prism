//
//  LoginViewModel.swift
//  prism
//
//  Path: Features/Auth/LoginViewModel.swift
//

import Foundation
import Observation

/// 로그인 버튼 하나의 정체 — provider와 방식(native/redirect)의 조합.
/// 같은 provider가 두 방식으로 두 번 나오므로, 어느 버튼이 눌렸는지 이걸로 구분한다.
struct AuthOption: Hashable, Sendable {
    let provider: AuthProvider
    let method: AuthMethod
}

/// 로그인 화면의 상태.
///
/// 화면이 아는 것은 셋뿐이다: 지금 어느 버튼이 진행 중인가(`pending`), 오류가 있는가,
/// 그리고 그 오류를 무엇으로 그릴 것인가. 세션을 만드는 일은 `AuthManager`가 한다.
@MainActor
@Observable
final class LoginViewModel {
    /// 진행 중인 로그인 버튼. nil이면 대기 상태다.
    /// 어느 버튼이 "Connecting…"이 되고 나머지가 비활성이 되는지를 이 값 하나로 정한다.
    private(set) var pending: AuthOption?

    /// 오류는 문구가 아니라 **키**로 들고 있다가 그릴 때 번역한다 — 언어를 바꾸면 화면에
    /// 떠 있는 오류도 함께 바뀐다(문구를 담아두면 그 오류만 이전 언어로 남는다).
    private(set) var errorKey: MessageKey?

    var isBusy: Bool { pending != nil }

    /// 알림 권한의 상태. **로그인 전에 묻는 이유는 등록 토큰이 로그인 요청에 실려야
    /// 세션 안으로 들어가기 때문이다**(plan/push.md §5-2).
    private(set) var pushPermission: PushPermission = .unsupported

    @ObservationIgnored
    private let authManager: AuthManager

    @ObservationIgnored
    private let pushTokens: PushTokens

    @ObservationIgnored
    private var task: Task<Void, Never>?
    /// busy 표시를 잠깐 미뤄 두는 작업(아래 [busyGrace] 참고).
    @ObservationIgnored
    private var busyTask: Task<Void, Never>?

    /// "Connecting…"·비활성 표시를 켜기까지의 유예. 이보다 빨리 끝나는 로그인은 busy를
    /// **아예 보이지 않는다** — 즉시 실패하는 경로(미설정 provider 등)에서 버튼이 한 프레임
    /// 깜박이는 것을 없앤다. 실제(네트워크) 로그인은 이보다 오래 걸려 정상적으로 표시된다.
    private static let busyGrace: Duration = .milliseconds(150)

    init(authManager: AuthManager, pushTokens: PushTokens) {
        self.authManager = authManager
        self.pushTokens = pushTokens
    }

    /// 화면에 들어올 때 읽는다. **진입만으로 묻지는 않는다** — 이 저장소가 카메라에
    /// 세운 규칙("명시적 제스처 뒤에만", plan/webrtc.md §7)과 같은 줄이다.
    func refreshPushPermission() async {
        pushPermission = await pushTokens.permission()
    }

    /// `알림 켜기`를 눌렀다.
    func allowNotifications() async {
        _ = await pushTokens.requestPermissionAndToken()
        pushPermission = await pushTokens.permission()
    }

    func signIn(_ option: AuthOption) {
        // 재진입 가드는 **동기 상태**(task)로 한다 — pending은 유예 뒤에야 켜지므로
        // pending으로 막으면 유예 중 두 번째 탭이 통과해 두 흐름이 겹친다.
        guard task == nil else { return }

        // busy 표시와 이전 오류 지우기는 **둘 다 유예 뒤에만** 한다. 오류를 여기서 미리 nil로
        // 만들면, 즉시 실패하는 경로(미설정 provider·데모)에서 catch가 곧바로 같은 오류를
        // 되돌려 배너가 `표시→nil→표시`로 토글되고, 그 높이 변화가 스크롤 레이아웃과 만나
        // 화면이 깜박인다(데모 연타). 유예 안에서 지우면 즉시 실패는 오류를 건드리지 않아
        // 같은 값 재대입이 되고, SwiftUI가 변화 없음으로 보아 재렌더가 없다. 로그인이 유예
        // 전에 끝나면 아래 defer가 이 작업을 취소하므로 pending도 켜지지 않는다.
        busyTask = Task {
            try? await Task.sleep(for: Self.busyGrace)
            if !Task.isCancelled {
                errorKey = nil
                pending = option
            }
        }

        task = Task {
            defer {
                busyTask?.cancel()
                busyTask = nil
                pending = nil
                task = nil
            }
            do {
                // 등록 토큰은 **로그인 요청에 실려야** 세션 안으로 들어간다. 권한이
                // 없으면 nil이고, 그 세션은 재로그인 전까지 `Notifications off`다.
                let pushToken = await pushTokens.current()
                try await authManager.signIn(
                    with: option.provider,
                    method: option.method,
                    pushToken: pushToken,
                )
                // 회전을 나중에 알아채려고 보낸 값을 남긴다 — 푸시 화면이 지금 토큰과
                // 대조해 "다시 로그인하세요"를 띄운다.
                if let pushToken { pushTokens.rememberSent(pushToken) }
                // 성공하면 화면 전환은 `AuthManager.state`를 보는 쪽이 한다 —
                // 여기서 화면을 밀면 세션의 진실이 두 곳에 생긴다.
            } catch is CancellationError {
                // 사용자가 시트를 닫았다. 오류가 아니므로 조용히 원상 복귀한다
                // (plan/auth.md §2.2 — 취소는 alert 없음).
                Log.ui("sign-in cancelled by user")
            } catch let error as APIError {
                errorKey = error.messageKey
            } catch {
                errorKey = .errorGeneric
            }
        }
    }

    /// 화면을 떠날 때 진행 중인 요청을 정리한다.
    func cancel() {
        busyTask?.cancel()
        busyTask = nil
        task?.cancel()
        task = nil
        pending = nil
    }

    /// 버튼에 그릴 기본 문구 — 진행 중인 버튼만 "Connecting…"으로 바뀐다.
    /// 방식(native/redirect) 태그는 화면(LoginView)이 이 위에 덧붙인다.
    func title(for option: AuthOption) -> MessageKey {
        pending == option ? .authConnecting : option.provider.messageKey
    }
}
