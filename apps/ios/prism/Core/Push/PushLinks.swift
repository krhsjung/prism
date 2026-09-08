//
//  PushLinks.swift
//  prism
//
//  Path: Core/Push/PushLinks.swift
//

import Observation
import UIKit

/// 알림이 열어 달라고 한 통화.
///
/// 앱이 꺼져 있든 떠 있든 알림 탭은 `AppDelegate`의 대리자 하나로 들어오므로, 그 값이
/// 화면까지 가는 길이 필요하다. 화면은 이것을 **한 번만** 소비하고 비운다 — 남겨 두면
/// 화면을 되돌아올 때마다 같은 통화를 다시 열려 한다.
///
/// 프로세스 메모리다. 앱이 죽으면 사라지고, 그러면 알림을 다시 누르는 것이 유일한
/// 경로가 된다 — **부재중 기록을 만들지 않기로 한 결정**과 같은 자리다(plan/webrtc.md §2).
@MainActor
@Observable
final class PushLinks {
    /// `AppDelegate`는 컨테이너를 거치지 않으므로(UIKit이 만든다) 여기만 공유 지점이다.
    static let shared = PushLinks()

    private(set) var pendingCallId: String?

    /// 통화 알림만 화면을 연다. 데모 알림도, `callId` 없는 통화 알림도 아무것도 하지
    /// 않는다 — 열어 봐야 물을 것이 없다.
    nonisolated func offer(kind: String?, callId: String?) {
        guard kind == PushKind.call, let callId, !callId.isEmpty else { return }
        Task { @MainActor in self.pendingCallId = callId }
    }

    func consume() {
        pendingCallId = nil
    }

    /// 알림이 가리키는 주소를 연다.
    ///
    /// **우리 웹 앱의 주소면 열지 않는다** — 그건 이 앱이 이미 그리는 화면이라 브라우저로
    /// 나가면 같은 것을 두 번 보게 된다. 바깥 주소만 시스템에 넘긴다.
    func open(_ link: String?) async {
        guard let link, let url = URL(string: link), !isAppLink(url) else { return }
        await UIApplication.shared.open(url)
    }

    private func isAppLink(_ url: URL) -> Bool {
        guard let host = APIConfiguration.baseURL.host else { return false }
        return url.host == host
    }
}

/// 계약의 `PUSH_KINDS` 중 통화 갈래.
nonisolated enum PushKind {
    static let call = "call"
}
