//
//  DashboardViewModel.swift
//  prism
//
//  Path: Features/Dashboard/DashboardViewModel.swift
//

import Foundation
import Observation

/// 활성 세션 카드의 상태를 쥔다.
///
/// 세션 목록은 **서버만 안다** — 앱은 자기 세션 id조차 모른다(액세스 토큰 안에만 있고
/// 앱은 그 토큰을 열어 보지 않는다). 그래서 화면을 그릴 때마다 서버에 묻고, 폐기 결과도
/// 로컬 추측이 아니라 응답으로 확정한다.
///
/// `onSessionEnded`는 "이 앱의 세션이 방금 끝났다"를 알리는 콜백이다. 전체 폐기와 현재
/// 세션 해제는 내 토큰까지 무효로 만들므로, 화면이 스스로 로그인으로 돌아가는 대신
/// 세션의 주인(`AuthManager`)에게 넘긴다 — 세션 상태의 진실이 두 곳에 생기지 않게.
@MainActor
@Observable
final class DashboardViewModel {
    /// `nil`이면 아직 불러오는 중이다 — "비어 있음"과 구분해야 한다. 현재 세션은 항상
    /// 하나 존재하므로 진짜 빈 목록은 없고, 1개짜리가 "나 혼자"다(plan/dashboard.md §3.2).
    private(set) var sessions: [SessionListItem]?

    /// 오류는 문구가 아니라 **키**로 들고 있다가 그릴 때 번역한다 — 언어를 바꾸면 화면에
    /// 떠 있는 오류도 함께 바뀐다(로그인 화면과 같은 규칙).
    private(set) var loadErrorKey: MessageKey?
    private(set) var actionErrorKey: MessageKey?

    /// 지금 해제 중인 세션 id — 그 행의 버튼만 잠근다.
    private(set) var revokingID: String?
    private(set) var isSigningOutAll = false

    /// 나 말고 다른 세션이 있을 때만 "모두 로그아웃"이 의미가 있다.
    var hasOthers: Bool { (sessions?.count ?? 0) > 1 }

    @ObservationIgnored
    private let service: SessionsServicing
    @ObservationIgnored
    private let accessToken: () -> String?
    @ObservationIgnored
    private let onSessionEnded: () async -> Void

    init(
        service: SessionsServicing,
        accessToken: @escaping () -> String?,
        onSessionEnded: @escaping () async -> Void,
    ) {
        self.service = service
        self.accessToken = accessToken
        self.onSessionEnded = onSessionEnded
    }

    /// 목록을 **비우고** 다시 불러온다 — 처음 그릴 때와 재시도가 쓴다. 화면에 아직
    /// 아무것도 없거나, 있던 것이 틀렸다고 판명된 자리다.
    func load() async {
        sessions = nil
        await refresh()
    }

    /// 화면에 있는 목록을 **지우지 않고** 갱신한다 — 해제 직후처럼 이미 목록이 떠 있는
    /// 자리가 쓴다.
    ///
    /// 여기서 비우면 카드가 "불러오는 중"으로 접혔다가 다시 펴지며 화면이 통째로 흔들린다.
    /// 사라질 행은 하나인데 목록 전체가 깜빡이는 셈이다.
    /// - Parameter background: **소켓이 시킨** 재조회인가. 그렇다면 이 요청 때문에 도는
    ///   회전이 세션의 유휴 창을 밀지 않는다 — 사용자가 한 일이 아니기 때문이다
    ///   (plan/auth.md §6). 화면 진입·당겨 새로고침·해제 뒤의 갱신은 활동이므로 기본값이다.
    func refresh(background: Bool = false) async {
        loadErrorKey = nil
        guard let token = accessToken() else {
            // 토큰이 없으면 목록을 물을 수 없다. 세션 복원이 곧 로그인 화면으로 보낸다.
            loadErrorKey = .errorSessionsLoadFailed
            return
        }
        do {
            sessions = try await service.sessions(accessToken: token, background: background)
        } catch {
            Log.auth("sessions load failed")
            loadErrorKey = .errorSessionsLoadFailed
        }
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
            if session.isCurrent {
                // 내 세션을 내가 지웠다 — 토큰은 이미 무효다. 세션의 주인에게 넘긴다.
                await onSessionEnded()
                return
            }
            revokingID = nil
            await refresh()
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
            await onSessionEnded()
        } catch {
            Log.auth("sign out all failed")
            // 잠긴 채로 두면 재시도할 방법이 없다.
            isSigningOutAll = false
            actionErrorKey = .errorRevokeFailed
        }
    }
}
