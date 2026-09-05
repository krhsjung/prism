//
//  SessionSocket.swift
//  prism
//
//  Path: Core/Networking/SessionSocket.swift
//

import Foundation
import Observation

/// 서버가 보낸 오류 코드에 대한 소켓의 대응.
///
/// **순수 함수로 떼어 둔 이유**: 이것이 이 클라이언트에서 가장 틀리기 쉬운 판단이고,
/// 틀리면 오프라인이 곧 로그아웃이 되거나 "세션이 종료됐습니다"가 중복으로 뜬다.
/// 소켓을 띄우지 않고 못 박아 둔다(서버의 `authorizeUpgrade`와 같은 결).
enum SocketErrorAction: Equatable, Sendable {
    /// 갱신하면 살아난다 — **기존 공유 회전**을 타고 다시 붙는다.
    case refreshAndReconnect
    /// 갱신으로는 살아나지 않는다. 재연결을 멈추고 목록 재조회에 판단을 넘긴다 —
    /// 그 요청의 401을 이미 있는 중앙 경로가 표식과 대조해 처리한다.
    /// **여기서 로그아웃하지 않는다.**
    case stopAndRefetch

    static func of(code: String) -> SocketErrorAction {
        code == AuthErrorCode.sessionExpired ? .refreshAndReconnect : .stopAndRefetch
    }
}

/// 세션 소켓 클라이언트 — 붙어 있는 동안 "목록이 바뀌었다"는 신호를 받는다.
///
/// **이 소켓은 데이터를 나르지 않는다.** `sessionsChanged`를 받으면 화면이 기존
/// `GET /auth/sessions`를 다시 부른다 — 스탬핑·공유 회전·확정 거절 처리가 전부 그 HTTP
/// 경로에 있고(plan/auth.md §6.3), 소켓이 목록을 직접 주입하면 그것을 통째로 우회한다.
/// 특히 **세션 N이 연 소켓이 세션 N+1의 화면에 목록을 밀어 넣는** 경로가 열린다.
///
/// ⚠️ **이 타입은 인증 상태를 바꾸지 않는다.** 소켓이 끊기는 이유는 대부분 인증과
/// 무관하고(회선·프록시·파드 재시작), 그것으로 로그아웃하면 오프라인이 곧 로그아웃이 된다.
/// 서버가 확정 거절을 보내와도 여기서 판단하지 않고 **목록 재조회 한 번**을 시킨다 —
/// 그 요청의 401을 이미 있는 중앙 경로(NetworkManager → SessionAuthority)가 처리한다.
@MainActor
@Observable
final class SessionSocket {
    /// 소켓이 붙어 있는가.
    ///
    /// 화면은 이 값이 `true`일 때만 `SessionListItem.isConnected`를 믿는다. 붙어 있지
    /// 않으면 서버가 내려준 presence가 "아무도 안 붙었다"인지 "소켓 서비스가 죽었다"인지
    /// 구별할 수 없고, 후자를 전자로 읽으면 멀쩡한 기기들을 전부 "비활성"이라고 지어내게 된다.
    private(set) var isReady = false

    /// 목록이 바뀌었다는 신호가 온 횟수. 화면은 이 값이 늘면 다시 가져온다.
    private(set) var changed = 0

    @ObservationIgnored private let url: URL
    @ObservationIgnored private let accessToken: () -> String?
    @ObservationIgnored private weak var authority: (any SessionAuthority)?
    @ObservationIgnored private let session: URLSession

    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var silence: Task<Void, Never>?
    @ObservationIgnored private var attempt = 0
    @ObservationIgnored private var stopped = false
    /// 한 번이라도 붙은 적이 있는가 — 다음 `ready`가 "첫 연결"인지 "재연결"인지 가른다.
    @ObservationIgnored private var everReady = false

    /// 통화 메시지를 듣는 쪽.
    ///
    /// **상태로 쌓지 않는다.** 시그널링은 순서가 있는 사건의 흐름이라 마지막 하나만
    /// 남기면 offer와 ice가 서로를 덮어쓰고, 배열로 쌓으면 이미 처리한 것을 다시
    /// 렌더에서 만난다. 듣는 쪽에 그대로 넘기고 잊는다.
    @ObservationIgnored var onCallMessage: ((CallServerMessage) -> Void)?

    /// 소켓이 끊겼다 — **서버는 이미 진행 중이던 통화를 끝냈다.**
    ///
    /// 창구의 소켓이 사라지면 서버가 `ended{peer-gone}`으로 접고 상대에게만 알린다.
    /// 그 메시지는 없어진 소켓으로 오므로 이쪽은 영영 받지 못하고, 재연결해도 통화
    /// 상태를 되물을 길이 없다(`resume`은 벨 전용이다). 듣는 쪽이 스스로 접으라고
    /// 알려 주는 자리다.
    @ObservationIgnored var onDisconnected: (() -> Void)?

    /// 서버 하트비트는 20초 간격이다. 두 번을 놓칠 때까지 기다린 뒤 죽었다고 본다 —
    /// 한 번의 지연으로 끊으면 느린 회선에서 재연결만 반복한다.
    private static let silenceDeadline: Duration = .seconds(45)
    private static let backoffMs = [1_000, 2_000, 4_000, 8_000, 15_000]

    init(
        url: URL = APIConfiguration.socketURL,
        accessToken: @escaping () -> String?,
        authority: (any SessionAuthority)?,
        session: URLSession = .shared,
    ) {
        self.url = url
        self.accessToken = accessToken
        self.authority = authority
        self.session = session
    }

    func start() {
        guard task == nil, loop == nil else { return }
        stopped = false
        attempt = 0
        connect()
    }

    /// 소켓을 닫는다.
    ///
    /// - Parameter endingSession: 세션이 끝났는가(로그아웃).
    ///
    /// ⚠️ **연결 이력을 지우는 것은 세션이 끝날 때만이다.** 백그라운드로 잠깐 닫는 것은
    /// 같은 세션의 **일시 중단**이고, 그 뒤 다시 붙는 것은 "재연결"이다 — 끊겨 있던 동안
    /// `sessionsChanged`가 닿지 못해 다른 기기의 변화를 놓쳤을 수 있으므로 목록을 다시
    /// 가져와야 한다. 여기서 이력을 지우면 그 재연결이 "첫 연결"로 읽혀 재조회가 사라지고,
    /// 복귀한 화면에 낡은 목록이 남는다(웹은 숨은 탭에서 닫지 않아, Android는 같은 소켓
    /// 객체를 재사용해 이력이 유지되므로 둘 다 재조회한다 — iOS만 갈라져 있었다).
    ///
    /// 반대로 **로그아웃에서는 지워야 한다.** 이 소켓은 컨테이너가 들고 있어 재로그인을
    /// 건너 살아남는데, 이력을 남기면 다음 세션의 첫 연결이 "재연결"로 읽혀 필요 없는
    /// 재조회가 한 번 나간다(Android는 세션 스코프라 이 문제가 없다).
    func stop(endingSession: Bool = false) {
        stopped = true
        teardown()
        let wasReady = isReady
        isReady = false
        if wasReady { onDisconnected?() }
        if endingSession { everReady = false }
    }

    // MARK: - 보내기

    /// 세션 재검증을 청한다(클라 → 서버).
    ///
    /// **presence를 주장하지 않는다.** 그 방향을 열지 않았던 이유는 그대로다 — 살아
    /// 있다는 주장을 믿으면 반쯤 죽은 소켓이 계속 Active로 남는다. 이것은 주장이 아니라
    /// 요청이고, 서버는 이 말을 믿는 대신 세션 저장소를 자기가 다시 읽는다. 그래서 이
    /// 메시지에는 아무 권한도 실려 있지 않다(무엇을 폐기했는지조차 말하지 않는다).
    ///
    /// 왜 필요한가: 폐기는 auth 서비스가 처리하고 socket 서비스는 그 사실을 전달받는
    /// 통로가 없다. 이 한 마디가 없으면 폐기된 기기가 서버의 스윕(20초)까지 멀쩡히
    /// 앉아 있고, 다른 기기의 목록도 그만큼 늦게 갱신된다.
    ///
    /// **붙어 있지 않으면 보내지 않는다.** 큐에 쌓지 않는 것은 의도다 — 다시 붙을 때
    /// 서버가 업그레이드에서 세션을 검증하므로, 폐기된 기기는 그 자리에서 걸러진다.
    func send(_ type: SessionClientMessageType) {
        // 계약의 메시지는 `{ "type": ... }` 하나뿐이라 인코더를 세우지 않는다.
        send(frame: #"{"type":"\#(type.rawValue)"}"#)
    }

    /// 통화 시그널링을 보낸다. **보내지 못하면 false**다 — 소켓이 끊긴 사이의 `hangup`을
    /// 보낸 셈 치면 화면이 끝난 통화를 그대로 붙들고 있게 된다. 호출부가 알아야 한다.
    ///
    /// 큐에 쌓지 않는 것은 의도다: 시그널링 메시지는 그 통화에서만 뜻이 있어, 재연결 뒤에
    /// 밀어 넣으면 이미 끝난 통화에 대고 말하게 된다.
    @discardableResult
    func send(_ message: CallClientMessage) -> Bool {
        guard let data = try? JSONEncoder().encode(message),
              let frame = String(data: data, encoding: .utf8)
        else { return false }
        return send(frame: frame)
    }

    @discardableResult
    private func send(frame: String) -> Bool {
        guard isReady, let task else { return false }
        task.send(.string(frame)) { error in
            // 못 보냈다고 할 수 있는 일이 없다 — 화면이 상태로 판단한다.
            if error != nil { Log.network("socket send failed") }
        }
        return true
    }

    // MARK: - 연결

    private func connect() {
        guard !stopped else { return }
        // 토큰은 **그때그때 읽는다** — 사본을 들고 있으면 회전 뒤 옛 토큰으로 다시 붙는다.
        guard let token = accessToken() else {
            // 자격증명이 없으면 붙을 수 없다. 인증 상태를 바꾸지는 않는다 —
            // 로그인 여부의 판단은 AuthManager의 몫이다.
            scheduleReconnect()
            return
        }

        var request = URLRequest(url: url)
        // 브라우저와 달리 네이티브는 핸드셰이크에 헤더를 붙일 수 있다.
        // 서버는 HTTP와 **같은 규칙**으로 읽는다(Bearer 우선, 없으면 쿠키).
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let socket = session.webSocketTask(with: request)
        task = socket
        socket.resume()
        armSilenceTimer()

        loop = Task { [weak self] in
            await self?.receiveLoop(socket, usedAccessToken: token)
        }
    }

    private func receiveLoop(
        _ socket: URLSessionWebSocketTask,
        usedAccessToken: String,
    ) async {
        while !Task.isCancelled {
            do {
                let message = try await socket.receive()
                guard !Task.isCancelled else { return }
                armSilenceTimer()
                handle(decode(message), usedAccessToken: usedAccessToken)
            } catch {
                // 끊김은 **판정 불가**다 — 회선·프록시·파드 재시작이 대부분이고,
                // 여기서 세션을 건드리면 오프라인이 곧 로그아웃이 된다.
                guard !Task.isCancelled else { return }
                dropped()
                return
            }
        }
    }

    /// 내려온 프레임을 **두 계약으로 갈라** 받는다.
    ///
    /// presence와 통화가 한 소켓을 나눠 쓰지만 계약은 갈라져 있다. 통화 쪽으로 간 것은
    /// `isConnected`를 정하는 데 쓰이지 않는다 — presence는 여전히 **소켓의 존재만** 본다.
    /// 통화였으면 nil을 돌려줘 presence 경로가 아무 일도 하지 않게 한다.
    private func decode(
        _ message: URLSessionWebSocketTask.Message,
    ) -> SocketServerMessage? {
        let data: Data? = switch message {
        case .string(let text): text.data(using: .utf8)
        case .data(let raw): raw
        @unknown default: nil
        }
        guard let data else { return nil }
        if let call = try? JSONDecoder().decode(CallServerMessage.self, from: data) {
            onCallMessage?(call)
            return nil
        }
        // 계약에 없는 메시지는 무시한다 — 형식이 어긋났다고 연결을 끊을 이유는 없다.
        return try? JSONDecoder().decode(SocketServerMessage.self, from: data)
    }

    private func handle(
        _ message: SocketServerMessage?,
        usedAccessToken: String,
    ) {
        switch message {
        case .ready:
            // 붙었다 = 소켓 서비스가 살아 있다 = presence를 믿어도 된다.
            attempt = 0
            isReady = true
            // **첫 연결에서는 가져오지 않는다.** 화면이 이미 가져왔고 그 데이터는 정확하다 —
            // 다른 기기의 presence는 각자의 소켓이 쓴 값이라 우리가 붙는 것과 무관하고,
            // 우리 자신의 행은 `isCurrent`로 그려져 isConnected를 읽지도 않는다.
            // 여기서 바뀌는 것은 배지가 두 갈래에서 세 갈래가 되는 것뿐이다.
            //
            // **재연결이라면 가져온다.** 끊겨 있던 동안에는 sessionsChanged가 우리에게
            // 닿지 못해, 다른 기기의 변화를 통째로 놓쳤을 수 있다.
            if everReady { changed += 1 }
            everReady = true
        case .sessionsChanged:
            changed += 1
        case .heartbeat, .none:
            break // armSilenceTimer가 이미 처리했다
        case .error(let code):
            handleError(code, usedAccessToken: usedAccessToken)
        }
    }

    private func handleError(_ code: String, usedAccessToken: String) {
        guard SocketErrorAction.of(code: code) == .refreshAndReconnect else {
            // 확정 거절(UNAUTHORIZED·INVALID_TOKEN) — **여기서 로그아웃하지 않는다.**
            // 목록을 다시 부르게 하고, 그 요청의 401을 중앙 경로가 표식과 대조해 처리한다.
            // 소켓이 직접 세션을 끝내면 공지가 중복되거나, 이미 끝난 세션의 오류로
            // 새 세션을 끊는다(AuthManager.endSession은 여는 시점의 토큰이 아직
            // 현재값일 것을 요구하는데, 몇 시간 사는 소켓의 그 토큰은 이미 회전으로 갈렸다).
            stop()
            changed += 1
            return
        }

        Task { [weak self] in
            guard let self, let authority = self.authority else { return }
            // **직접 회전하지 않는다.** refreshForRetry는 restore·선제 갱신·HTTP 401이
            // 공유하는 회전이라, 여러 곳이 동시에 만료를 만나도 회전은 한 번만 나간다.
            // 리프레시 자격증명은 1회용이고 서버가 응답 전에 회전시키므로, 두 번째 회전은
            // 재사용 탐지에 걸려 멀쩡한 세션을 죽인다.
            guard let mark = authority.sessionMark(usedAccessToken: usedAccessToken) else {
                // 이 소켓은 **지난 세션**의 것이다. 조용히 물러난다.
                self.stop()
                return
            }
            let rotated = await authority.refreshForRetry(
                mark: mark,
                usedAccessToken: usedAccessToken,
            )
            guard !self.stopped else { return }
            if rotated != nil { self.attempt = 0 }
            // 갱신하지 못한 이유가 확정 거절인지 일시적 실패인지 여기서는 알 수 없다 —
            // 어느 쪽이든 백오프로 다시 시도하고, 확정이라면 다음 HTTP 요청이 정리한다.
            self.scheduleReconnect()
        }
    }

    // MARK: - 수명

    /// 서버가 20초마다 보내는 하트비트가 끊기면 회선이 죽은 것이다.
    ///
    /// `URLSessionWebSocketTask`는 상대가 조용히 사라진 것을 스스로 알려 주지 않는다 —
    /// 이것이 없으면 죽은 소켓을 몇 시간이고 붙들고 앉아 목록이 영영 갱신되지 않는다.
    private func armSilenceTimer() {
        silence?.cancel()
        silence = Task { [weak self] in
            try? await Task.sleep(for: Self.silenceDeadline)
            guard !Task.isCancelled, let self, !self.stopped else { return }
            self.dropped()
        }
    }

    private func dropped() {
        teardown()
        // 붙어 있지 않으면 presence를 믿을 수 없다 — 화면은 두 갈래로 후퇴한다.
        let wasReady = isReady
        isReady = false
        if wasReady { onDisconnected?() }
        scheduleReconnect()
    }

    private func teardown() {
        silence?.cancel()
        silence = nil
        loop?.cancel()
        loop = nil
        // 정상 종료를 알려 두면 서버가 TTL을 기다리지 않고 presence를 지운다.
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func scheduleReconnect() {
        guard !stopped else { return }
        let index = min(attempt, Self.backoffMs.count - 1)
        attempt += 1
        // 지터를 섞는다 — 서버가 재시작하면 모든 클라이언트가 같은 순간에 끊긴다.
        // 정확히 같은 간격으로 재시도하면 그 무리가 유지돼 복구 직후를 다시 두드린다.
        let base = Double(Self.backoffMs[index])
        let delay = Duration.milliseconds(Int(base * Double.random(in: 0.8...1.2)))
        loop = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self, !self.stopped else { return }
            self.loop = nil
            self.connect()
        }
    }
}
