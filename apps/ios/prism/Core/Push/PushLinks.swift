//
//  PushLinks.swift
//  prism
//
//  Path: Core/Push/PushLinks.swift
//

import Observation
import UIKit

/// 알림 링크가 가리키는 **앱 안의** 화면 — 웹 라우트를 옮긴 것이다(`/push` · `/webrtc` · 나머지).
enum PushDestination: Equatable {
    case dashboard
    case push
    case webrtc
}

/// 알림을 눌렀을 때 할 일.
enum PushOpen: Equatable {
    /// 아무것도 열지 않는다 — 통화(자기 화면으로 연다)거나 링크가 없다(앱만 앞으로 온다).
    case nothing
    /// 우리 주소다 — 앱 안의 그 화면으로 간다(딥링크). 브라우저로 나가면 같은 것을 두 번 본다.
    case page(PushDestination)
    /// 바깥 주소다 — 시스템에 넘긴다.
    case external(URL)
}

/// 알림이 열어 달라고 한 것 — 통화, 또는 앱 안의 화면.
///
/// 앱이 꺼져 있든 떠 있든 알림 탭은 `AppDelegate`의 대리자 하나로 들어오므로, 그 값이
/// 화면까지 가는 길이 필요하다. 화면은 이것을 **한 번만** 소비하고 비운다 — 남겨 두면
/// 화면을 되돌아올 때마다 같은 것을 다시 열려 한다.
///
/// 프로세스 메모리다. 앱이 죽으면 사라지고, 그러면 알림을 다시 누르는 것이 유일한
/// 경로가 된다 — **부재중 기록을 만들지 않기로 한 결정**과 같은 자리다(plan/webrtc.md §2).
@MainActor
@Observable
final class PushLinks {
    /// `AppDelegate`는 컨테이너를 거치지 않으므로(UIKit이 만든다) 여기만 공유 지점이다.
    static let shared = PushLinks()

    private(set) var pendingCallId: String?
    /// 통화 요청의 차례 — 같은 통화를 다시 열어 달라고 해도 **새 요청**으로 보이게 한다. 값만
    /// 보면 `"c"` → nil → `"c"`가 한 번의 변화로 접혀 화면의 `onChange`가 다시 돌지 않는다.
    private(set) var callSeq = 0
    /// 알림 링크가 가리킨 앱 안의 화면. `RootView`가 옮겨 간 뒤 비운다.
    private(set) var pendingPage: PushDestination?

    /// 통화 알림만 통화를 연다. 데모 알림도, `callId` 없는 통화 알림도 아무것도 하지
    /// 않는다 — 열어 봐야 물을 것이 없다.
    nonisolated func offer(kind: String?, callId: String?) {
        guard kind.flatMap(PushKind.init(rawValue:)) == .call, let callId, !callId.isEmpty
        else { return }
        Task { @MainActor in
            self.pendingCallId = callId
            self.callSeq += 1
            // 통화가 화면보다 우선이다 — 둘이 함께 남아 있으면 화면 쪽이 통화 화면을 덮는다.
            self.pendingPage = nil
        }
    }

    /// 처리한 요청을 비운다 — **그 차례일 때만.** 보내기를 기다리는 사이 다른 통화가 들어왔으면
    /// 그것은 새 요청이라 남긴다(앞 요청의 성공이 뒤 요청을 지우면 뒤 통화는 영영 묻지 못한다).
    func consume(seq: Int) {
        guard callSeq == seq else { return }
        pendingCallId = nil
    }

    /// 테스트·옛 호출부용 — 지금 것을 비운다.
    func consume() {
        consume(seq: callSeq)
    }

    /// 사람이 통화 화면을 떠났다 — **그때 묻지 못해 남긴 그 요청**을 버린다. 남겨 두면 다시 붙는
    /// 순간 통화 화면으로 끌려가고, 그때까지 화면 요청은 통화에 밀려 버려진다. 떠나는 사이에
    /// 들어온 다른 통화는 다른 차례라 남는다.
    func dropCall(seq: Int) {
        consume(seq: seq)
    }

    func consumePage() {
        pendingPage = nil
    }

    /// 알림이 가리키는 주소를 연다 — **우리 주소면 앱 안의 화면으로**, 바깥 주소면 브라우저로.
    ///
    /// 통화 알림은 열지 않는다(`offer`가 통화를 연다). 링크가 없으면 앱만 앞으로 온다.
    /// 서버는 사람이 적은 링크만 `data`에 싣지만, 옛 서버는 기본 주소(`/push`)까지 실었다 —
    /// 그것도 우리 주소라 앱 안에서 열린다.
    func open(_ link: String?, kind: String?, base: URL = APIConfiguration.baseURL) async {
        switch Self.resolve(link, kind: kind, base: base) {
        case .nothing:
            return
        case .page(let destination):
            // 통화가 기다리고 있으면 화면은 열지 않는다 — 통화가 우선이다.
            guard pendingCallId == nil else { return }
            pendingPage = destination
        case .external(let url):
            await UIApplication.shared.open(url)
        }
    }

    /// 판단만 하는 자리 — 테스트가 여기를 본다.
    nonisolated static func resolve(_ link: String?, kind: String?, base: URL) -> PushOpen {
        guard kind.flatMap(PushKind.init(rawValue:)) != .call,
              let link, !link.isEmpty, let url = URL(string: link)
        else { return .nothing }
        guard isSameOrigin(url, base) else { return .external(url) }
        return .page(destination(forPath: url.path))
    }

    /// 웹 라우트 → 앱 화면. 경로 **전체**로 견준다(끝의 `/`만 무시) — `/push/settings`처럼 웹에도
    /// 없는 경로는 대시보드다(앱에는 그 화면이 없다).
    nonisolated static func destination(forPath path: String) -> PushDestination {
        let trimmed = path.hasSuffix("/") && path.count > 1 ? String(path.dropLast()) : path
        switch trimmed {
        case "/push": return .push
        case "/webrtc": return .webrtc
        default: return .dashboard
        }
    }
}

/// 두 주소가 **같은 출처**(스킴·호스트·포트)인가. 호스트만 보면 같은 호스트의 다른 포트
/// (`https://prism.example:8443/page`)를 앱 링크로 읽어 앱 안에서 열려 한다 — Android와 같은 규칙.
nonisolated func isSameOrigin(_ a: URL, _ b: URL) -> Bool {
    guard let sa = a.scheme?.lowercased(), let sb = b.scheme?.lowercased(),
          let ha = a.host?.lowercased(), let hb = b.host?.lowercased()
    else { return false }
    func port(_ url: URL, _ scheme: String) -> Int {
        url.port ?? (scheme == "https" ? 443 : 80)
    }
    return sa == sb && ha == hb && port(a, sa) == port(b, sb)
}
