//
//  SessionStore.swift
//  prism
//
//  Path: Core/Sessions/SessionStore.swift
//

import Foundation
import Observation

/// 내 활성 세션 목록을 **앱에 하나만** 둔다.
///
/// 이 목록은 대시보드의 것이 아니다 — 대시보드가 관리하고, 통화가 상대를 고르고, 푸시가
/// 대상을 고른다. 세 화면이 각자 조회하고 각자 소켓 신호를 듣던 때는 **화면마다 신선도가
/// 달랐다**: 대시보드와 통화 로비는 신호를 들었지만 푸시 화면은 듣지 않아, 다른 기기가
/// 로그인하거나 사라져도 그 화면만 낡은 채로 남았다. 화면을 하나 더 만들 때마다 같은
/// 규칙을 옮겨 적어야 하는 구조 자체가 그 버그의 원인이다.
///
/// **수명은 세션이다.** 컨테이너가 들고 있어 화면 전환에는 살아남고, 로그아웃에서
/// [reset]으로 비운다(소켓·통화가 같은 자리에서 같은 일을 한다 — `RootView`).
///
/// ⚠️ **소켓이 목록을 나르지는 않는다.** 신호를 받으면 여기서 기존 `GET /auth/sessions`를
/// 다시 부른다 — 스탬핑·공유 회전·401 처리가 전부 그 HTTP 경로에 있고, 소켓이 목록을
/// 직접 주입하면 그것을 통째로 우회한다(plan/auth.md §6.3). 신호를 이 store에 이어 주는
/// 자리는 `RootView` 한 곳이다 — 화면이 아니라 세션에 매달아야 보고 있지 않은 화면의
/// 목록도 함께 새로워진다.
@MainActor
@Observable
final class SessionStore {
    /// `nil`이면 아직 불러오는 중이다 — "비어 있음"과 구분해야 한다. 현재 세션은 항상
    /// 하나 존재하므로 진짜 빈 목록은 없고, 1개짜리가 "나 혼자"다(plan/dashboard.md §3.2).
    private(set) var sessions: [SessionListItem]?

    /// 오류는 문구가 아니라 **키**로 들고 있다가 그릴 때 번역한다 — 언어를 바꾸면 화면에
    /// 떠 있는 오류도 함께 바뀐다(로그인 화면과 같은 규칙).
    private(set) var loadErrorKey: MessageKey?

    /// 나 말고 다른 세션이 있는가 — "모두 로그아웃"이 의미를 갖는 조건이다.
    var hasOthers: Bool { (sessions?.count ?? 0) > 1 }

    /// 지금 세션의 세대. `reset()`이 올린다.
    ///
    /// **늦게 도착한 응답을 버리는 표식이다.** 로그아웃 순간에 떠 있던 조회는 그대로
    /// 살아 있다가 다음 로그인 뒤에 끝날 수 있고, 값만 비우면 그 응답이 **앞 사용자의
    /// 목록을 다음 사용자 화면에 그린다**(`isCurrent` 행까지 그대로). 웹은 목록에 주인을
    /// 적어 두고 읽을 때 대조하고, Android는 `SessionScope`가 저장소째 갈아 끼워 코루틴이
    /// 취소된다 — iOS만 그 방어가 없었다. `AuthManager`가 쓰는 generation과 같은 수법이다.
    @ObservationIgnored private var generation = 0
    /// 마지막으로 **출발한** 조회의 번호. 조회는 겹칠 수 있고 응답은 순서대로 오지 않는다 —
    /// 로그인 직후의 첫 조회가 등록 뒤의 재조회보다 늦게 돌아오면 `pushRegistered: true`를
    /// false로 덮는다. 자기보다 새 조회가 출발한 뒤 돌아온 응답은 버린다.
    @ObservationIgnored private var latestRequest = 0

    @ObservationIgnored private let service: SessionsServicing
    @ObservationIgnored private let accessToken: () -> String?
    /// 다른 기기에 "목록이 바뀌었다"를 전하는 통로(소켓). 기본값은 아무것도 하지 않는다 —
    /// 테스트는 소켓 없이 이 타입을 세운다.
    @ObservationIgnored private let notify: () -> Void

    init(
        service: SessionsServicing,
        accessToken: @escaping () -> String?,
        notify: @escaping () -> Void = {},
    ) {
        self.service = service
        self.accessToken = accessToken
        self.notify = notify
    }

    /// 목록을 **비우고** 다시 불러온다 — 세션이 시작될 때와 재시도가 쓴다. 화면에 아직
    /// 아무것도 없거나, 있던 것이 틀렸다고 판명된 자리다.
    func load() async {
        sessions = nil
        await refresh()
    }

    /// 화면에 있는 목록을 **지우지 않고** 갱신한다 — 해제 직후·소켓 신호·당겨 새로고침이
    /// 쓴다.
    ///
    /// 여기서 비우면 카드가 "불러오는 중"으로 접혔다가 다시 펴지며 화면이 통째로 흔들린다.
    /// 사라질 행은 하나인데 목록 전체가 깜빡이는 셈이다.
    ///
    /// - Parameter background: **내가 시킨 일이 아닌** 재조회인가(소켓 신호). 그렇다면 이
    ///   요청 때문에 도는 회전이 세션의 유휴 창을 밀지 않는다 — 사용자가 한 일이 아니기
    ///   때문이다(plan/auth.md §6). 화면 진입·당겨 새로고침·해제 뒤의 갱신은 활동이므로
    ///   기본값이다.
    func refresh(background: Bool = false) async {
        loadErrorKey = nil
        guard let token = accessToken() else {
            // 토큰이 없으면 목록을 물을 수 없다. 세션 복원이 곧 로그인 화면으로 보낸다.
            loadErrorKey = .errorSessionsLoadFailed
            return
        }
        let gen = generation
        latestRequest += 1
        let request = latestRequest
        // 그사이 세션이 끝났거나(앞 세션의 응답) 더 새 조회가 출발했으면 버린다.
        let fresh = { gen == self.generation && request == self.latestRequest }
        do {
            let list = try await service.sessions(accessToken: token, background: background)
            guard fresh() else { return }
            sessions = list
        } catch {
            guard fresh() else { return }
            Log.auth("sessions load failed")
            loadErrorKey = .errorSessionsLoadFailed
        }
    }

    /// **다른 기기에도 알린다** — 방금 HTTP로 내 세션 레코드를 고쳤다(해제 · 전체 해제 ·
    /// 알림 등록/해제). 서버는 이 말을 믿지 않고 세션 저장소를 다시 읽은 뒤, 남은 기기에
    /// `sessionsChanged`를 보낸다.
    ///
    /// **목록을 쥔 쪽이 이 일도 맡는다.** 바꾸는 화면마다 소켓을 따로 들고 있으면 어느
    /// 화면은 알리고 어느 화면은 잊는다 — 알림 끄기가 실제로 그랬다(푸시 화면에는 소켓이
    /// 없어, 끈 사실이 다른 기기의 목록에 **영영 닿지 않았다**).
    ///
    /// 소켓이 붙어 있지 않으면 나가지 않는다(큐에 쌓지도 않는다) — 다시 붙을 때 서버가
    /// 업그레이드에서 세션을 검증한다.
    ///
    /// ⚠️ **그동안은 스윕도 못 메운다.** 서버의 스윕은 세션 **id 목록**을 지난 틱과
    /// 대조하므로(`noticeExpiries`) 폐기처럼 구성원이 바뀌는 변화만 잡는다 — 알림
    /// 등록/해제는 구성원이 그대로라 브로드캐스트가 나가지 않는다. 남은 기기는 자기가
    /// 재연결할 때(첫 ready가 신호를 올린다) 비로소 맞는다.
    func notifyChanged() {
        notify()
    }

    /// 세션이 끝났다 — 다음 로그인이 앞 세션의 목록을 물려받지 않게 비운다.
    ///
    /// 이 store는 컨테이너가 들고 있어 **재로그인을 건너 살아남는다.** 비우지 않으면 다음
    /// 사용자의 대시보드에 앞 사람의 기기 목록이 한 프레임 그려진다.
    func reset() {
        // 먼저 세대를 올린다 — 지금 떠 있는 조회의 응답이 아래 비우기를 되돌리지 않게.
        generation += 1
        sessions = nil
        loadErrorKey = nil
    }
}
