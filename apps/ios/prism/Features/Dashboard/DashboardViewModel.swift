//
//  DashboardViewModel.swift
//  prism
//
//  Path: Features/Dashboard/DashboardViewModel.swift
//

import Foundation
import Observation

/// 활성 세션 카드에서 **할 수 있는 일**을 쥔다 — 해제와 전체 로그아웃.
///
/// 목록 자체는 여기 없다. 그것은 통화·푸시 화면과 같은 것이고 `SessionStore`가 앱에
/// 하나만 들고 있다 — 화면마다 따로 들고 있으면 화면마다 신선도가 갈린다
/// (Core/Sessions/SessionStore.swift). 이 타입은 그 목록을 **바꾸는 쪽**이다.
///
/// 세션 목록은 **서버만 안다** — 앱은 자기 세션 id조차 모른다(액세스 토큰 안에만 있고
/// 앱은 그 토큰을 열어 보지 않는다). 그래서 폐기 결과도 로컬 추측이 아니라 응답으로
/// 확정한다.
///
/// `onSessionEnded`는 "이 앱의 세션이 방금 끝났다"를 알리는 콜백이다. 전체 폐기와 현재
/// 세션 해제는 내 토큰까지 무효로 만들므로, 화면이 스스로 로그인으로 돌아가는 대신
/// 세션의 주인(`AuthManager`)에게 넘긴다 — 세션 상태의 진실이 두 곳에 생기지 않게.
@MainActor
@Observable
final class DashboardViewModel {
    /// 오류는 문구가 아니라 **키**로 들고 있다가 그릴 때 번역한다 — 언어를 바꾸면 화면에
    /// 떠 있는 오류도 함께 바뀐다(로그인 화면과 같은 규칙).
    private(set) var actionErrorKey: MessageKey?

    /// 지금 해제 중인 세션 id — 그 행의 버튼만 잠근다.
    private(set) var revokingID: String?
    private(set) var isSigningOutAll = false

    @ObservationIgnored
    private let service: SessionsServicing
    @ObservationIgnored
    private let accessToken: () -> String?
    /// 바꾼 뒤 다시 물어볼 곳 — 목록의 주인이다.
    @ObservationIgnored
    private let store: SessionStore
    @ObservationIgnored
    private let onSessionEnded: () async -> Void

    init(
        service: SessionsServicing,
        accessToken: @escaping () -> String?,
        store: SessionStore,
        onSessionEnded: @escaping () async -> Void,
    ) {
        self.service = service
        self.accessToken = accessToken
        self.store = store
        self.onSessionEnded = onSessionEnded
    }

    /// 세션 하나를 해제한다.
    ///
    /// 성공하면 목록을 **다시 불러온다** — 로컬에서 그 행만 지우면 서버가 아는 목록과
    /// 어긋날 수 있다(그사이 다른 기기에서 로그인·만료가 일어난다).
    func revoke(_ session: SessionListItem) async {
        guard revokingID == nil, !isSigningOutAll, let token = accessToken() else { return }
        revokingID = session.id
        actionErrorKey = nil
        do {
            try await service.revoke(id: session.id, accessToken: token)
            // **끊긴 기기가 서버의 스윕(20초)을 기다리지 않게 한다.** 폐기는 auth
            // 서비스가 처리하고 socket 서비스는 그 사실을 전달받는 통로가 없다 —
            // 소켓은 이미 붙어 있으니 우리가 깨워 준다(서버는 믿지 않고 다시 읽는다).
            store.notifyChanged()
            if session.isCurrent {
                // 내 세션을 내가 지웠다 — 토큰은 이미 무효다. 세션의 주인에게 넘긴다.
                await onSessionEnded()
                return
            }
            revokingID = nil
            await store.refresh()
        } catch {
            Log.auth("session revoke failed")
            revokingID = nil
            // 실패했는데 목록이 사라지면 다시 시도할 대상이 화면에서 없어진다.
            actionErrorKey = .errorRevokeFailed
        }
    }

    /// 내 모든 세션을 폐기한다 — 현재 세션도 사라지므로 끝나면 로그인 화면으로 간다.
    func signOutAll() async {
        guard !isSigningOutAll, let token = accessToken() else { return }
        isSigningOutAll = true
        actionErrorKey = nil
        do {
            try await service.revokeAll(accessToken: token)
            // 전체 폐기도 같다 — 다만 이 요청은 내 세션까지 끝내므로, 곧 로그인 화면으로
            // 간다. 그 전에 다른 기기들이 즉시 쫓겨나게 해 둔다.
            store.notifyChanged()
            await onSessionEnded()
        } catch {
            Log.auth("sign out all failed")
            // 잠긴 채로 두면 재시도할 방법이 없다.
            isSigningOutAll = false
            actionErrorKey = .errorRevokeFailed
        }
    }
}
