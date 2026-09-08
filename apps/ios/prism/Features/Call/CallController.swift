//
//  CallController.swift
//  prism
//
//  Path: Features/Call/CallController.swift
//

import Foundation
import Observation
import WebRTC

/// 통화의 상태. **배지 여섯 변형과 1:1**이다(plan/webrtc.md §4) — 화면이 배지를 그리려고
/// 상태를 다시 조합하지 않게, 여기서 이미 그 모양으로 나눠 둔다.
///
/// `notified`(푸시로 깨웠다)는 아직 도달할 수 없다 — 소켓이 없는 기기는 서버가
/// `unreachable`로 거절하고, 푸시 경로는 push 슬라이스와 함께 붙는다(§8-11).
/// 문구와 배지는 이미 있으므로 그때 갈래 하나만 늘면 된다.
enum CallStatus: Sendable {
    case ringing
    /// 상대에게 **소켓이 없어 푸시로 알렸다.** 기다리는 성격이 `ringing`과 다르므로
    /// 배지와 문구를 가른다(plan/webrtc.md §4).
    case notified
    case connecting
    case connected
    case reconnecting
    case failed
}

/// ICE 정책. 화면에서 바꿀 수 있는 두 가지 중 하나다(§4).
enum IcePolicy: Sendable {
    case all
    case relay
}

/// 로비에 띄우는 한 줄. **통화가 끝난 뒤에도 남는 것은 이것뿐이다** — 부재중 목록을
/// 두지 않기로 했고(§2), 저장이 생기면 그 저장은 세션보다 오래 살기 때문이다.
enum CallNotice: Equatable, Sendable {
    case declined
    case ended(reason: CallEndReason)
    case error(code: CallErrorCode)
    /// 알림을 늦게 열었다. `from`은 없을 수 있다 — 서버가 그 통화를 더는 기억하지
    /// 못하거나 애초에 내 통화가 아니었으면 기기 종류를 지어내지 않는다(§6).
    case expired(from: SessionRef?)
}

struct ActiveCall: Equatable, Sendable {
    /// 서버가 발급한다. `call`을 보내고 `ringing`을 받기 전까지는 **없다**.
    var callId: String?
    /// 상대. 루프백에서는 없다 — 상대가 나 자신이라 기기 종류를 말할 것이 없다.
    var peer: SessionRef?
    var status: CallStatus
    /// 건 쪽인가. **offer를 내는 역할이 여기서 나온다**(§6).
    var isCaller: Bool
    /// 한 화면 안의 두 PeerConnection — 소켓도 서버도 지나지 않는다(§4).
    var isLoopback: Bool
    var connectedAt: Date?
}

/// 통화 하나를 붙들고 있는 자리(웹 `lib/webrtc/CallProvider.tsx`와 같은 역할).
///
/// **화면이 아니라 앱에 매단다.** 걸려 온 통화는 통화 화면이 아니라 앱 위에 떠야
/// 하고(plan/webrtc.md §4), 대시보드를 보고 있어도 울려야 한다 — 소켓이 이미 앱 전역에
/// 붙어 있는 것과 같은 이유다.
///
/// **미디어도 여기서 연다.** 수락은 카메라를 먼저 얻은 **뒤에** 서버로 나간다 —
/// 반대로 하면 `offer`가 스트림보다 먼저 도착해 트랙 없는 응답을 만들고, 카메라가
/// 실패한 통화를 이미 수락해 버린 상태가 된다.
@MainActor
@Observable
final class CallController {
    /// 지표를 읽는 간격. 1초보다 촘촘하면 숫자가 읽기 전에 바뀌고, 느리면 통화 품질이
    /// 무너지는 순간을 놓친다.
    private static let statsInterval: Duration = .seconds(1)

    /// `연결 중`이 이보다 오래 가면 실패로 본다.
    ///
    /// 벨의 상한(45초)은 **붙기 전에만** 도는 서버 시계라, 수락한 뒤 협상이 멈춘 통화는
    /// 아무도 끝내 주지 않는다. TURN까지 도는 ICE는 느려도 십수 초면 끝난다.
    private static let connectTimeout: Duration = .seconds(30)

    /// 보낸 `call`의 답(`ringing`·`callError`)을 기다리는 상한.
    ///
    /// 서버는 `call` 하나에 **정확히 한 번** 답하지만, 그 프레임이 상한에 걸려 버려지면
    /// 답이 영영 오지 않는다. 그동안 다음 통화를 막아 두므로(`starting`), 풀어 주는
    /// 시계가 없으면 화면이 걸린 채로 남는다.
    private static let answerTimeout: Duration = .seconds(10)

    // ── 로비(장치) ──
    private(set) var localVideoTrack: RTCVideoTrack?
    private(set) var remoteVideoTrack: RTCVideoTrack?
    private(set) var mediaError: MediaErrorKind?
    private(set) var cameras: [MediaDeviceOption] = []
    private(set) var microphones: [MediaDeviceOption] = []
    private(set) var cameraID: String?
    private(set) var microphoneID: String?
    private(set) var micOn = true
    private(set) var cameraOn = true
    /// 카메라를 쥐고 있는가. 로비의 "카메라 켜기" 버튼이 이 값으로 사라진다.
    var hasMedia: Bool { localVideoTrack != nil }

    // ── 통화 ──
    private(set) var call: ActiveCall?
    /// 걸려 온 통화. **앱 어디서든** 뜬다(§4).
    private(set) var incoming: (callId: String, from: SessionRef)?
    private(set) var notice: CallNotice?
    /// 받는 쪽이 수락했다 — 화면을 통화로 옮겨야 한다(웹의 `navigate('/webrtc')`).
    private(set) var wantsCallScreen = false

    // ── 진단 ──
    private(set) var stats: CallStats?
    private(set) var log: [SignalLogEntry] = []
    private(set) var icePolicy: IcePolicy = .all

    @ObservationIgnored private let socket: SessionSocket
    @ObservationIgnored private let media = CallMedia()
    @ObservationIgnored private var peer: RTCPeerConnection?
    @ObservationIgnored private var peerDelegate: PeerDelegate?
    /// 루프백의 두 연결과 그 대리자. 대리자를 함께 붙들지 않으면 곧바로 해제된다.
    @ObservationIgnored private var loopback: [RTCPeerConnection] = []
    @ObservationIgnored private var loopbackDelegates: [PeerDelegate] = []
    @ObservationIgnored private var iceServers: [IceServer] = []
    /// `setRemoteDescription` 전에 온 후보는 넣을 수 없다 — 붙들고 있다가 나중에 넣는다.
    @ObservationIgnored private var pendingRemote: [RTCIceCandidate] = []
    @ObservationIgnored private let sampler = StatsSampler()
    @ObservationIgnored private var statsLoop: Task<Void, Never>?
    /// 이번 로비 방문에서 장치 목록을 이미 읽었는가.
    @ObservationIgnored private var probed = false
    /// 내가 낸 offer의 답을 기다리는 중인가. **glare(양쪽이 동시에 재협상)를 가르는 값이다.**
    @ObservationIgnored private var offering = false
    /// `연결 중`에 상한을 두는 시계.
    @ObservationIgnored private var connectTimer: Task<Void, Never>?
    /// `ringing`을 기다리는 사이에 취소했다. id를 알게 되는 순간 서버에도 알려야 한다.
    @ObservationIgnored private var cancelPending = false
    /// 보낸 `call`이 아직 답을 못 받았다 — 두 번째 누름을 막는 문.
    ///
    /// ⚠️ **취소한 뒤에도 답이 올 때까지 닫혀 있다.** `ringing`과 `callError`에는 어느
    /// 시도의 답인지가 실려 있지 않아서, 취소하자마자 새로 걸면 앞 시도의 `ringing`이
    /// 새 통화의 것으로 읽힌다(그리고 앞 통화는 서버에 남아 상대 벨을 계속 울린다).
    /// 한 번에 하나만 떠 있게 하면 그 모호함이 아예 생기지 않는다.
    private(set) var starting = false
    @ObservationIgnored private var answerTimer: Task<Void, Never>?
    /// 지금 돌고 있는 "카메라를 열고 그다음 무엇을 한다" 한 벌.
    ///
    /// 이것을 붙들지 않으면 `카메라 켜기`·`걸기`를 누른 **직후** 화면을 벗어났을 때
    /// 정리할 것을 찾지 못한다 — 그 순간에는 트랙도 통화도 아직 없기 때문이다. 뒤늦게
    /// 획득이 끝나면 카메라가 켜진 채 남거나, 보이지도 끊기지도 않는 통화가 시작된다(§4).
    @ObservationIgnored private var pending: Task<Void, Never>?

    /// 장치 **이름**을 만들려면 번역기가 필요하다 — Android의 `CallMedia`가 `context`를
    /// 들고 `getString`을 부르는 것과 같은 자리다.
    @ObservationIgnored private let t: LocalizationStore

    init(socket: SessionSocket, localization: LocalizationStore) {
        self.socket = socket
        t = localization
        socket.onCallMessage = { [weak self] message in
            guard let self else { return }
            Task { await self.handle(message) }
        }
        // 소켓이 끊기면 서버는 이미 통화를 끝냈다 — 이쪽도 접지 않으면 카메라를 쥔 채
        // `연결됨`을 그리고 있는데 상대는 로비로 돌아간 화면이 된다. 루프백은 소켓을
        // 쓰지 않으므로 건드리지 않는다.
        socket.onDisconnected = { [weak self] in
            guard let self else { return }
            // 기다리던 `call`의 답도 오지 않는다 — 소켓이 없으면 서버는 답할 길이 없다.
            // 문을 열어 두지 않으면 재연결(또는 재로그인) 뒤에도 걸 수 없다.
            settleAttempt()
            cancelPending = false
            guard let call, !call.isLoopback else { return }
            finish(.ended(reason: .peerGone))
        }
    }

    // MARK: - 미디어

    /// 카메라·마이크를 연다. 얻지 못하면 `mediaError`가 서고 false가 돌아온다.
    ///
    /// **트랙을 먼저 얻고 그 다음에 통화를 건다.** 반대로 하면 상대의 벨만 울리고
    /// 이쪽은 붙을 수 없는 통화가 된다.
    @discardableResult
    private func acquire(cameraID wanted: String?, microphoneID wantedMic: String?) async -> Bool {
        let failure = await media.open(
            cameraID: wanted ?? cameraID,
            microphoneID: wantedMic ?? microphoneID,
        )
        // 여는 동안 화면을 벗어났다면 **연 것을 그대로 놓는다.** `media.open`은 중간에
        // 멈추지 않으므로(카메라를 반쯤 연 상태를 만들지 않는다) 끝난 뒤에 판단한다.
        if Task.isCancelled {
            await media.release()
            return false
        }
        if let failure {
            // 화면은 세 갈래로만 말하므로, 무엇이 났는지는 개발 로그가 갖는다.
            Log.error("media_failed")
            mediaError = failure
            return false
        }
        mediaError = nil
        localVideoTrack = media.localVideoTrack
        cameraID = media.cameraID
        microphoneID = media.microphoneID
        // 지금의 음소거·카메라 상태를 새 트랙에도 그대로 입힌다.
        media.setEnabled(video: cameraOn, audio: micOn)
        readDevices()

        // 통화 중이라면 보내는 트랙도 갈아 끼운다(재협상 없이 되는 유일한 교체다).
        if let peer {
            for sender in peer.senders {
                switch sender.track?.kind {
                case "video": sender.track = media.localVideoTrack
                case "audio": sender.track = media.localAudioTrack
                default: continue
                }
            }
        }
        return true
    }

    /// 로비에 들어오면 **장치 목록만** 읽는다.
    ///
    /// 카메라를 열지 않으므로 권한 팝업도 뜨지 않고 표시등도 켜지지 않는다. 이미
    /// 허용한 적이 있으면 목록이 채워지고, 그때 시안대로 선택 메뉴가 그려진다.
    /// 허용한 적이 없으면 아무것도 그리지 않고 타일에 "카메라 켜기" 버튼 하나만 둔다.
    func enterLobby() {
        guard !probed else { return }
        probed = true
        guard CallMedia.isAuthorized else { return }
        readDevices()
    }

    private func readDevices() {
        let devices = CallMedia.devices(simulatorCameraLabel: t(.webrtcCameraSimulator))
        cameras = devices.cameras
        microphones = devices.microphones
    }

    /// 로비에서 미리 켜 본다(= 권한을 처음 묻는다). 통화 시작과 같은 경로를 타므로
    /// **자동으로는 켜지지 않는다**(§7).
    func startPreview() {
        run { await self.acquire(cameraID: nil, microphoneID: nil) }
    }

    /// 미디어를 여는 작업을 **한 번에 하나만** 돌린다. 앞의 것이 남아 있으면 취소한다 —
    /// 프리뷰를 연타하거나 열자마자 걸면 두 획득이 같은 카메라를 두고 겹친다.
    private func run(_ operation: @escaping () async -> Void) {
        pending?.cancel()
        pending = Task { await operation() }
    }

    func selectCamera(_ id: String) {
        cameraID = id
        // `run`을 지나야 `leaveLobby`가 취소할 수 있다 — 따로 띄운 Task는 아무도
        // 붙들지 못해, 고른 직후 화면을 벗어나면 카메라가 켜진 채 남는다.
        run { await self.acquire(cameraID: id, microphoneID: nil) }
    }

    func selectMicrophone(_ id: String) {
        microphoneID = id
        // 마이크는 열려 있는 트랙을 건드리지 않고 **입력만** 바꾼다(카메라와 다른 점).
        media.select(microphone: id)
    }

    func toggleMic() {
        micOn.toggle()
        media.setEnabled(audio: micOn)
    }

    func toggleCamera() {
        cameraOn.toggle()
        media.setEnabled(video: cameraOn)
    }

    /// 카메라·마이크를 **놓는다**(표시등이 꺼진다).
    func releaseMedia() {
        localVideoTrack = nil
        mediaError = nil
        Task { await media.release() }
    }

    // MARK: - 피어 연결

    private func teardownPeer() {
        connectTimer?.cancel()
        connectTimer = nil
        offering = false
        peer?.close()
        peer = nil
        peerDelegate = nil
        for connection in loopback { connection.close() }
        loopback = []
        loopbackDelegates = []
        pendingRemote = []
        sampler.reset()
        remoteVideoTrack = nil
        stats = nil
        statsLoop?.cancel()
        statsLoop = nil
    }

    /// 새 `RTCPeerConnection`을 만든다. **있던 것은 버린다** — offer를 받을 때마다
    /// 새로 만드는 것이 재협상(ICE 정책 전환)까지 한 규칙으로 덮는 가장 단순한 길이다.
    private func buildPeer(callId: String) -> RTCPeerConnection? {
        self.peer?.close()
        pendingRemote = []
        sampler.reset()

        let config = RTCConfiguration()
        config.iceServers = iceServers.map {
            RTCIceServer(urlStrings: $0.urls, username: $0.username, credential: $0.credential)
        }
        // 화면에서 바꿀 수 있는 두 가지 중 하나(§4). `relay`는 일부러 직접 경로를
        // 막아 TURN이 실제로 값을 하는지 보여 준다.
        config.iceTransportPolicy = icePolicy == .relay ? .relay : .all
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually

        let delegate = PeerDelegate()
        guard let peer = media.factory.peerConnection(
            with: config,
            constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil),
            delegate: delegate,
        ) else {
            Log.error("peer_connection_failed")
            return nil
        }

        delegate.onCandidate = { [weak self] candidate in
            guard let self else { return }
            send(.ice(callId: callId, candidate: IceCandidatePayload(
                candidate: candidate.sdp,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
            )))
        }
        delegate.onRemoteTrack = { [weak self] track in
            self?.remoteVideoTrack = track
        }
        delegate.onConnectionState = { [weak self] state in
            self?.apply(connectionState: state)
        }

        attachLocalTracks(to: peer)
        peerDelegate = delegate
        self.peer = peer
        return peer
    }

    private func attachLocalTracks(to peer: RTCPeerConnection) {
        if let video = media.localVideoTrack {
            peer.add(video, streamIds: ["prism"])
        }
        if let audio = media.localAudioTrack {
            peer.add(audio, streamIds: ["prism"])
        }
    }

    private func apply(connectionState state: RTCPeerConnectionState) {
        guard var current = call else { return }
        switch state {
        case .connected:
            current.status = .connected
            current.connectedAt = current.connectedAt ?? Date()
        // 끊김은 **실패가 아니다** — ICE가 스스로 되찾는 경우가 흔하다.
        case .disconnected:
            current.status = .reconnecting
        case .failed:
            current.status = .failed
        default:
            return
        }
        call = current
    }

    private func drainRemoteCandidates(_ peer: RTCPeerConnection) async {
        let queued = pendingRemote
        pendingRemote = []
        for candidate in queued {
            // 한 후보가 못 들어가도 통화는 다른 후보로 붙는다.
            try? await peer.add(candidate)
        }
    }

    // MARK: - 통화 끝내기

    private func finish(_ next: CallNotice?) {
        teardownPeer()
        call = nil
        notice = next
        // 통화가 끝나면 **장치도 놓는다.** 로비로 돌아왔다고 카메라를 쥐고 있을 이유가
        // 없고, 다음 통화는 어차피 다시 연다(권한은 한 번 준 뒤로 다시 묻지 않는다).
        releaseMedia()
    }

    // MARK: - 보내기 / 받기

    /// **보내지 못한 것은 로그에 남기지 않는다.** 로그는 "무슨 일이 있었나"인데,
    /// 나가지 않은 줄이 섞이면 상대가 왜 못 받았는지를 로그가 설명하지 못한다.
    @discardableResult
    private func send(_ message: CallClientMessage) -> Bool {
        let ok = socket.send(message)
        if ok {
            log = SignalLog.append(log, SignalLog.entry(
                .sent,
                type: message.logType,
                detail: message.logDetail,
                isError: false,
            ))
        } else {
            Log.network("call_send_dropped")
        }
        return ok
    }

    private func handle(_ message: CallServerMessage) async {
        log = SignalLog.append(log, SignalLog.entry(
            .received,
            type: message.logType,
            detail: message.logDetail,
            isError: message.isLogError,
        ))

        switch message {
        case let .incoming(callId, from):
            // **자동 수락은 없다.** 내 기기라도 카메라가 말없이 켜지면 안 된다(§4).
            // 이미 통화 중이면 서버가 `busy`로 막으므로 여기 오지 않는다.
            incoming = (callId, from)

        // 둘은 **같은 답이고 다른 상태다**: 서버가 상대에게 닿는 방법을 골랐고
        // (소켓이냐 알림이냐), 그 선택이 화면의 배지와 문구를 가른다(§4).
        // 클라이언트는 경로를 요청하지 않는다 — 그러면 푸시를 강제로 쏘는 길이 열린다.
        case let .ringing(callId):
            answerToCall(callId, status: .ringing)

        case let .notified(callId):
            answerToCall(callId, status: .notified)

        case let .accepted(callId, servers):
            guard let current = call, current.callId == callId else { return }
            iceServers = servers
            incoming = nil
            patch { $0.status = .connecting }
            armConnectTimeout()
            // **`accepted`를 받은 거는 쪽이 offer를 낸다** — 첫 협상의 방향은 여기서
            // 확정되므로 glare가 없다(§6). 받는 쪽은 offer를 기다린다.
            startStatsLoop()
            guard current.isCaller else { return }
            guard await offerNow(callId: callId) else { return failCall() }

        case let .offer(callId, sdp):
            guard let current = call, current.callId == callId else { return }
            // ⚠️ **glare**: 양쪽이 동시에 재협상을 낼 수 있다(ICE 정책은 각자 바꾼다).
            // 서로의 offer가 서로의 연결을 갈아 치우면 뒤이은 answer가 갈 곳을 잃는다.
            //
            // 그래서 역할로 가른다 — **거는 쪽이 무례하고 받는 쪽이 정중하다.** 무례한
            // 쪽은 자기 offer를 지키고 상대 것을 버리며, 정중한 쪽은 자기 것을 접고
            // 상대 offer에 답한다. 정중한 쪽의 정책 변경도 사라지지 않는다 —
            // `iceTransportPolicy`는 각 연결의 지역 설정이고 아래에서 다시 세운다.
            if offering, current.isCaller {
                Log.network("call_offer_ignored_glare")
                return
            }
            offering = false
            // offer가 올 때마다 연결을 새로 세운다 — 통화 시작과 ICE 정책 전환에 따른
            // 재협상을 **한 규칙**으로 덮는다.
            guard let peer = buildPeer(callId: callId) else { return failCall() }
            do {
                try await peer.setRemoteDescription(
                    RTCSessionDescription(type: .offer, sdp: sdp),
                )
            } catch {
                // 그냥 돌아서면 화면이 `연결 중`에 갇힌다 — 벨 상한은 붙기 전에만 돈다.
                Log.error("set_remote_offer_failed")
                return failCall()
            }
            await drainRemoteCandidates(peer)
            guard let answer = await createAnswer(peer) else { return failCall() }
            send(.answer(callId: callId, sdp: answer.sdp))
            patch { $0.status = .connecting }
            armConnectTimeout()
            startStatsLoop()

        case let .answer(callId, sdp):
            guard let peer, let current = call, current.callId == callId else { return }
            // 내가 낸 offer의 답이 아니면 버린다 — 늦게 온 답이나 버려진 offer의 답이
            // `stable`인 연결에 들어가면 그대로 실패한다.
            guard offering else {
                Log.network("call_answer_ignored")
                return
            }
            offering = false
            do {
                try await peer.setRemoteDescription(
                    RTCSessionDescription(type: .answer, sdp: sdp),
                )
            } catch {
                Log.error("set_remote_answer_failed")
                return failCall()
            }
            await drainRemoteCandidates(peer)

        case let .ice(callId, payload):
            guard let current = call, current.callId == callId else { return }
            let candidate = RTCIceCandidate(
                sdp: payload.candidate,
                sdpMLineIndex: payload.sdpMLineIndex ?? 0,
                sdpMid: payload.sdpMid,
            )
            // 원격 기술이 아직 없으면 넣을 수 없다 — 붙들고 있다가 넣는다.
            guard let peer, peer.remoteDescription != nil else {
                pendingRemote.append(candidate)
                return
            }
            try? await peer.add(candidate)

        // 다른 기기가 먼저 받았다. **끝이 아니라 "내 차례가 아니었다"라서** 벨만 닫고
        // 알림은 남기지 않는다 — 통화는 이 기기의 것이 아니었으므로 건드릴 것도 없다.
        case let .claimed(callId):
            if incoming?.callId == callId { incoming = nil }

        case let .declined(callId):
            // 거절은 **벨을 함께 받았던 기기에도** 온다 — 그 창을 닫아 주는 것이 이 줄이다.
            if incoming?.callId == callId { incoming = nil }
            guard call?.callId == callId else { return }
            finish(.declined)

        case let .ended(callId, reason):
            // 벨을 받고 있던 다른 화면에도 온다 — 그 창을 닫아 주는 것이 이 줄이다.
            if incoming?.callId == callId { incoming = nil }
            guard call?.callId == callId else { return }
            finish(.ended(reason: reason))

        case let .expired(callId, from):
            // **내 통화에 대한 답일 때만 끝낸다.** callId를 보지 않으면 지난 통화에 대한
            // 늦은 답 하나가 지금 붙어 있는 통화를 끊는다.
            if incoming?.callId == callId { incoming = nil }
            guard call == nil || call?.callId == callId else { return }
            finish(.expired(from: from))

        case let .callError(code):
            // 화면 전환 없이 알림 한 줄로 받는다 — 아직 통화가 아니었다(§3.2).
            //
            // **아직 callId를 받지 못한 통화의 답이다.** 이미 callId가 있는 통화를 이걸로
            // 끝내면, 두 번째 시도가 받은 `busy` 하나가 울리고 있는 첫 통화를 지운다.
            guard call?.callId == nil else { return }
            // 서버는 `call` 하나에 `ringing`이나 `callError` **하나로만** 답한다.
            settleAttempt()
            // 오류로 답했다면 취소할 통화가 애초에 서지 않았으니 기다리던 취소도 함께 접는다.
            if cancelPending {
                cancelPending = false
                // 사용자는 이미 취소했다 — 그 뒤에 온 오류를 알림으로 띄우지 않는다.
                return
            }
            finish(.error(code: code))
        }
    }

    /// 협상이 더 갈 수 없다 — 배지가 `연결 실패`를 말하게 한다.
    ///
    /// 그냥 돌아서면 화면이 `연결 중`에 영원히 갇힌다: 벨 상한(45초)은 붙기 **전에만**
    /// 도는 서버 시계라, 협상이 깨진 통화를 끝내 주지 않는다.
    private func failCall() {
        connectTimer?.cancel()
        connectTimer = nil
        offering = false
        patch { $0.status = .failed }
    }

    /// 서버가 보낸 `call`에 답했다 — `ringing`(소켓으로 울렸다)이든 `notified`(알림으로
    /// 알렸다)든 이후 흐름은 같고, 화면에 그릴 상태만 다르다.
    private func answerToCall(_ callId: String, status: CallStatus) {
        // 어느 쪽으로 갈리든 다음 통화를 열어 준다.
        settleAttempt()
        // 기다리는 사이에 취소했다 — 이제야 id를 알았으니 그때 못 보낸 것을 보낸다.
        if cancelPending {
            cancelPending = false
            send(.cancel(callId: callId))
            return
        }
        guard var current = call, current.callId == nil else { return }
        current.callId = callId
        current.status = status
        call = current
    }

    /// 보낸 `call`의 답이 왔다(또는 더 기다리지 않는다) — 다음 통화를 열어 준다.
    private func settleAttempt() {
        answerTimer?.cancel()
        answerTimer = nil
        starting = false
    }

    /// `연결 중`에 상한을 둔다 — 협상이 조용히 멈춘 통화를 끝내 주는 것은 이것뿐이다.
    private func armConnectTimeout() {
        connectTimer?.cancel()
        connectTimer = Task { [weak self] in
            try? await Task.sleep(for: Self.connectTimeout)
            guard !Task.isCancelled, let self, let call, call.status != .connected else { return }
            failCall()
        }
    }

    /// 연결을 새로 세우고 offer를 낸다 — 통화 시작과 재협상이 **같은 길**을 쓴다.
    ///
    /// `offering`을 세우는 것이 두 번째 일이다: 답을 기다리는 중인지가 glare를 가르는
    /// 값이고, 늦게 온 answer를 버리는 근거이기도 하다.
    private func offerNow(callId: String) async -> Bool {
        guard let peer = buildPeer(callId: callId) else { return false }
        guard let offer = await createOffer(peer) else { return false }
        offering = true
        send(.offer(callId: callId, sdp: offer.sdp))
        return true
    }

    private func patch(_ change: (inout ActiveCall) -> Void) {
        guard var current = call else { return }
        change(&current)
        call = current
    }

    // MARK: - 사용자가 하는 것

    func startCall(to target: SessionRef) {
        // ⚠️ **문을 먼저 닫는다.** 카메라를 얻는 동안에는 아직 통화가 없어서, 두 번
        // 누르면 두 획득이 겹치고 `call`이 두 번 나간다 — 두 번째가 받는 `busy` 하나가
        // 울리고 있는 첫 통화를 지운다. 화면도 이 값으로 버튼을 잠근다.
        guard !starting, call == nil else { return }
        starting = true
        cancelPending = false
        run { [self] in
            notice = nil
            // 카메라를 **먼저** 얻는다. 얻지 못하면 걸지 않는다 — 상대의 벨만 울리고
            // 이쪽은 붙을 수 없는 통화가 되기 때문이다.
            // `||`로 잇지 않는다 — 오른쪽이 autoclosure라 `await`가 들어갈 수 없다.
            var ready = media.localVideoTrack != nil
            if !ready { ready = await acquire(cameraID: nil, microphoneID: nil) }
            guard ready else { return settleAttempt() }
            localVideoTrack = media.localVideoTrack
            call = ActiveCall(
                callId: nil,
                peer: target,
                status: .ringing,
                isCaller: true,
                isLoopback: false,
                connectedAt: nil,
            )
            guard send(.call(to: target.id)) else {
                settleAttempt()
                return finish(.error(code: .unreachable))
            }
            // 나갔다 — 이제 문은 **서버의 답이 열어 준다**(위 `starting` 주석).
            answerTimer = Task { [weak self] in
                try? await Task.sleep(for: Self.answerTimeout)
                guard !Task.isCancelled, let self else { return }
                // 자기 자신을 취소하지 않게 먼저 놓는다 — `settleAttempt`이 붙들고 있는
                // 시계를 끄는데, 그게 지금 돌고 있는 이 작업이다.
                answerTimer = nil
                settleAttempt()
                cancelPending = false
                // 답 없이 시간이 지났다 — 서 있던 통화가 있으면 그 자리에서 접는다.
                if let call, call.callId == nil { finish(.error(code: .unreachable)) }
            }
        }
    }

    /// 알림을 열고 들어왔다 — **이 통화가 아직 살아 있나**(§6).
    ///
    /// 늦게 온 기기의 유일한 질문이다. 살아 있으면 서버가 `incoming`으로 답해 벨이 다시
    /// 울리고, 아니면 `expired`로 "이미 끝난 통화"를 그린다 — 그것이 **푸시 경로의 정상
    /// 결말**이다(§8-10).
    ///
    /// 이미 통화 중이거나 벨이 울리는 중이면 아무것도 하지 않는다 — 그 화면이 이미 답이다.
    func resumeCall(_ callId: String) {
        guard call == nil, incoming == nil else { return }
        send(.resume(callId: callId))
    }

    func acceptIncoming() {
        guard let request = incoming else { return }
        run { [self] in
            notice = nil
            // `||`로 잇지 않는다 — 오른쪽이 autoclosure라 `await`가 들어갈 수 없다.
            var ready = media.localVideoTrack != nil
            if !ready { ready = await acquire(cameraID: nil, microphoneID: nil) }
            guard ready else {
                // 카메라를 얻지 못하면 수락할 수 없다. 아무 말도 하지 않으면 상대가
                // 45초를 다 기다리므로 **사실대로 거절**하되, 여기서 끝내면 받는 쪽에는
                // 창이 사라진 것 말고 아무 일도 없다 — "받기를 눌렀는데 거절됐다"로
                // 보인다. 그래서 이유를 그릴 수 있는 화면으로 옮긴다.
                send(.decline(callId: request.callId))
                incoming = nil
                wantsCallScreen = true
                return
            }
            localVideoTrack = media.localVideoTrack
            call = ActiveCall(
                callId: request.callId,
                peer: request.from,
                status: .connecting,
                isCaller: false,
                isLoopback: false,
                connectedAt: nil,
            )
            incoming = nil
            send(.accept(callId: request.callId))
            startStatsLoop()
            // 대시보드에서 받았을 수 있다 — 통화는 통화 화면에서 그린다.
            wantsCallScreen = true
        }
    }

    func declineIncoming() {
        guard let pending = incoming else { return }
        send(.decline(callId: pending.callId))
        incoming = nil
    }

    /// 통화를 접으면서 서버에도 끝을 알린다. `cancel`과 `hangup`이 나눠 쓰는 몸통이다.
    ///
    /// ⚠️ **아직 callId가 없는 자리를 여기서 함께 본다** — `call`은 보냈고 `ringing`은
    /// 오지 않은 왕복 사이다. 그냥 지우면 서버의 통화는 살아 있어 상대 벨이 45초를 마저
    /// 울리고, 상대가 받으면 offer를 낼 사람이 없는 통화가 선다. 그래서 **끝낼 뜻을
    /// 기억했다가** `ringing`이 오는 순간 보낸다. 취소 버튼만이 아니라 화면을 벗어나는
    /// 길도 이 자리를 지나야 한다 — 서버가 보기에는 같은 사건이다.
    private func endCall(_ verb: (String) -> CallClientMessage) {
        if let current = call, !current.isLoopback {
            // 기억해 두는 동사는 언제나 `cancel`이다 — 그 시점의 서버 통화는 반드시
            // 벨 단계이고, 거는 쪽이 벨을 접는 동사가 그것이다.
            if let callId = current.callId { send(verb(callId)) } else { cancelPending = true }
        }
        finish(nil)
    }

    /// 벨을 접는다(거는 쪽). 붙은 뒤로는 `hangUp`의 자리다.
    func cancelCall() { endCall { .cancel(callId: $0) } }

    func hangUp() { endCall { .hangup(callId: $0) } }

    /// 실패한 통화를 **같은 상대에게** 다시 건다(§4: "타일에는 `Try again`만 둔다").
    ///
    /// 새로 거는 것이지 되살리는 것이 아니다 — 서버의 통화는 이미 끝났고 `callId`도
    /// 새로 받는다. 끊는 길을 먼저 지나야 피어와 장치가 정리된다(웹 `retryCall`).
    func retryCall() {
        guard let current = call else { return }
        hangUp()
        if current.isLoopback {
            startLoopback()
        } else if let peer = current.peer {
            startCall(to: peer)
        }
    }

    /// 화면이 통화로 옮겨 갔다 — 신호를 내린다.
    func consumeCallScreenRequest() {
        wantsCallScreen = false
    }

    func clearLog() {
        log = []
    }

    // MARK: - 루프백

    /// 한 화면 안의 두 연결. **소켓도 서버도 지나지 않는다** — 그래서 시그널링 로그가
    /// 비어 있는 것이 정상이고, 진단이 그 자리에 그렇게 적는다(§4).
    func startLoopback() {
        run { [self] in
            notice = nil
            // `||`로 잇지 않는다 — 오른쪽이 autoclosure라 `await`가 들어갈 수 없다.
            var ready = media.localVideoTrack != nil
            if !ready { ready = await acquire(cameraID: nil, microphoneID: nil) }
            guard ready else { return }
            localVideoTrack = media.localVideoTrack
            teardownPeer()

            let config = RTCConfiguration()
            config.sdpSemantics = .unifiedPlan
            let constraints = RTCMediaConstraints(
                mandatoryConstraints: nil,
                optionalConstraints: nil,
            )
            let callerDelegate = PeerDelegate()
            let calleeDelegate = PeerDelegate()
            guard let caller = media.factory.peerConnection(
                with: config, constraints: constraints, delegate: callerDelegate,
            ), let callee = media.factory.peerConnection(
                with: config, constraints: constraints, delegate: calleeDelegate,
            ) else {
                Log.error("loopback_peer_failed")
                return
            }
            loopback = [caller, callee]
            loopbackDelegates = [callerDelegate, calleeDelegate]

            callerDelegate.onCandidate = { candidate in
                Task { try? await callee.add(candidate) }
            }
            calleeDelegate.onCandidate = { candidate in
                Task { try? await caller.add(candidate) }
            }
            calleeDelegate.onRemoteTrack = { [weak self] track in
                self?.remoteVideoTrack = track
            }
            callerDelegate.onConnectionState = { [weak self] state in
                self?.apply(connectionState: state)
            }
            attachLocalTracks(to: caller)

            // 지표는 보내는 쪽에서 읽는다 — 화면의 `Video`가 상대 타일의 값이어야 한다.
            peer = caller
            call = ActiveCall(
                callId: nil,
                peer: nil,
                status: .connecting,
                isCaller: true,
                isLoopback: true,
                connectedAt: nil,
            )
            // 루프백도 같은 시계를 쓴다 — 한 화면 안이라도 붙지 못하면 `연결 중`에 갇힌다.
            armConnectTimeout()
            startStatsLoop()

            guard let offer = await createOffer(caller) else { return failCall() }
            try? await callee.setRemoteDescription(offer)
            guard let answer = await createAnswer(callee) else { return failCall() }
            try? await caller.setRemoteDescription(answer)
        }
    }

    // MARK: - ICE 정책

    func setIcePolicy(_ policy: IcePolicy) {
        icePolicy = policy
        // 통화 중이면 **다시 붙인다** — 정책은 연결을 세울 때만 쓰이므로 지금 것에는
        // 소급되지 않는다. 서버는 offer의 방향을 강제하지 않아 어느 쪽이든 재협상을 낼 수 있다.
        guard let current = call, let callId = current.callId, !current.isLoopback else { return }
        Task {
            guard await offerNow(callId: callId) else { return failCall() }
            patch {
                $0.status = .connecting
                $0.connectedAt = nil
            }
            armConnectTimeout()
        }
    }

    // MARK: - 지표

    /// 통화가 시작되면 지표를 되풀이해 읽는다. 벨이 울리는 동안은 읽을 것이 없다.
    private func startStatsLoop() {
        statsLoop?.cancel()
        statsLoop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if let peer = self.peer {
                    let next = await self.sampler.read(peer)
                    if Task.isCancelled { return }
                    self.stats = next
                }
                try? await Task.sleep(for: Self.statsInterval)
            }
        }
    }

    /// 통화 화면을 벗어나면 **통화를 끝내고 장치를 놓는다.**
    ///
    /// 통화만 남기고 미디어를 놓을 수는 없다(상대에게 검은 화면과 침묵이 간다). 통화를
    /// 남기는 쪽도 안 된다 — 이 앱에는 축소된 통화 UI가 없어서, 다른 화면에서는 통화를
    /// 보거나 끝낼 방법이 없는 **유령 상태**가 된다. 그래서 나가는 것이 곧 끊는 것이다.
    func leaveLobby() {
        probed = false
        // **진행 중인 획득을 먼저 취소한다.** 이것이 없으면 방금 누른 `걸기`가 화면이
        // 사라진 뒤에 끝나면서 통화를 시작해 버린다 — 보이지도 끊기지도 않는 유령 통화다.
        let wasPending = pending != nil
        pending?.cancel()
        pending = nil
        guard call != nil || media.localVideoTrack != nil || wasPending else { return }
        if call != nil { hangUp() } else { releaseMedia() }
    }

    /// 세션이 끝났다 — 통화도 상태도 남기지 않는다.
    ///
    /// ⚠️ **이 컨트롤러는 로그아웃을 건너 살아남는다**(`ServiceContainer`가 들고 있다).
    /// 그래서 화면에 보이는 것만 지우면 부족하다 — 답을 기다리던 문(`starting`)과
    /// 기억해 둔 취소, 화면 이동 요청까지 지워야 다음 세션이 그것들을 물려받지 않는다.
    /// 소켓이 이미 끊겨 있었으면 `onDisconnected`도 오지 않으므로 여기가 유일한 자리다.
    /// (Android는 세션 스코프라 같은 일을 `dispose`가 한다)
    func reset() {
        pending?.cancel()
        pending = nil
        settleAttempt()
        cancelPending = false
        wantsCallScreen = false
        teardownPeer()
        call = nil
        incoming = nil
        notice = nil
        log = []
        releaseMedia()
    }

    // MARK: - SDP (콜백을 async로 접는다)

    private func createOffer(_ peer: RTCPeerConnection) async -> RTCSessionDescription? {
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let offer = try? await peer.offer(for: constraints) else {
            Log.error("create_offer_failed")
            return nil
        }
        // **붙이지 못한 기술은 내보내지 않는다.** 보내 버리면 상대는 내가 설치한 적 없는
        // offer로 협상을 이어가고, 이쪽은 ICE 수집도 시작하지 못해 양쪽이 `연결 중`에
        // 갇힌다(웹은 `await`가 그대로 던져 여기서 흐름이 끊긴다).
        do {
            try await peer.setLocalDescription(offer)
        } catch {
            Log.error("set_local_offer_failed")
            return nil
        }
        return offer
    }

    private func createAnswer(_ peer: RTCPeerConnection) async -> RTCSessionDescription? {
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let answer = try? await peer.answer(for: constraints) else {
            Log.error("create_answer_failed")
            return nil
        }
        do {
            try await peer.setLocalDescription(answer)
        } catch {
            Log.error("set_local_answer_failed")
            return nil
        }
        return answer
    }
}

/// `RTCPeerConnectionDelegate`를 클로저로 접는 대리자.
///
/// 컨트롤러가 직접 채택하지 않는 이유: 이 프로토콜은 `NSObject`를 요구하는데, 그러면
/// `@Observable`과 한 타입에서 만나게 된다. 게다가 루프백은 **연결이 둘**이라 한
/// 대리자로는 어느 쪽이 부른 것인지 가릴 수 없다 — 연결마다 하나씩 둔다.
private final class PeerDelegate: NSObject, RTCPeerConnectionDelegate {
    var onCandidate: ((RTCIceCandidate) -> Void)?
    var onRemoteTrack: ((RTCVideoTrack) -> Void)?
    var onConnectionState: ((RTCPeerConnectionState) -> Void)?

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        // 대리자는 시그널링 스레드에서 불린다 — 상태를 건드리기 전에 메인으로 옮긴다.
        Task { @MainActor in self.onCandidate?(candidate) }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd receiver: RTCRtpReceiver, streams: [RTCMediaStream]) {
        guard let track = receiver.track as? RTCVideoTrack else { return }
        Task { @MainActor in self.onRemoteTrack?(track) }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        Task { @MainActor in self.onConnectionState?(newState) }
    }

    // 나머지는 계약이 요구하는 자리만 채운다 — 화면이 읽는 것은 위 셋뿐이다.
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
