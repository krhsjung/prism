//
//  WebRtcView.swift
//  prism
//
//  Path: Features/Call/WebRtcView.swift
//

import SwiftUI

/// 1:1 통화 화면 — 시안 `WebRTC / Mobile / Lobby`·`Ringing`·`In call`·`In call (diagnostics open)`.
///
/// 로비와 통화가 **한 카드**다. 방이 없으므로 "들어간다/나온다"가 없고, 통화가 끝나면
/// 같은 카드가 다시 로비가 된다 — 그래서 부재중 목록도 필요 없다: 주소록이 곧 그 화면이다
/// (plan/webrtc.md §4).
struct WebRtcView: View {
    @Environment(LocalizationStore.self) private var t

    let user: User
    let call: CallController
    let socket: SessionSocket
    let sessions: SessionsServicing
    let accessToken: () -> String?
    let onNavigate: (ShellPage) -> Void
    let onSignOut: () async -> Void

    @State private var list: [SessionListItem]?
    @State private var loadFailed = false
    /// 요청은 화면당 한 번만. 효과가 두 번 도는 경우에도 두 번 나가지 않게 한다.
    @State private var started = false
    @State private var handledChange: Int?

    private var inCall: Bool { call.call != nil }

    var body: some View {
        AppShellView(
            page: .webrtc,
            user: user,
            onNavigate: onNavigate,
            onSignOut: onSignOut,
        ) {
            VStack(spacing: 0) {
                ScrollView {
                    callCard
                        .padding(.horizontal, AppDimension.Call.cardInset)
                        .padding(.top, AppDimension.Call.bodyPadding)
                        .padding(.bottom, AppDimension.Spacing.lg)
                }
                // 컨트롤 바는 **화면 바닥 고정**이다. 카드 안에 두면 진단을 폈을 때 바가
                // 화면 밖으로 밀려 **종료 버튼에 닿을 수 없다**(§4). 상태에 따라 자리를
                // 옮기는 대신 통화 중에는 늘 여기 둔다.
                if inCall {
                    bottomBar
                }
            }
        }
        .task {
            // 로비에 들어온 것만으로 **카메라를 열지 않는다.** 이미 허용한 적이 있으면
            // 장치 목록만 읽어 선택 메뉴를 채운다(카메라는 켜지지 않는다).
            call.enterLobby()
            guard !started else { return }
            started = true
            handledChange = socket.changed
            await load()
        }
        // 화면을 벗어나면 **통화도 끝내고 장치도 놓는다** — 축소된 통화 UI가 없어서,
        // 안 그러면 보이지도 끊기지도 않는 유령 통화가 된다(§4).
        .onDisappear { call.leaveLobby() }
        // 소켓이 "바뀌었다"고 하면 목록을 다시 가져온다(비우지 않는다 — 깜빡임 방지).
        .onChange(of: socket.changed) { _, next in
            guard handledChange != next else { return }
            handledChange = next
            Task { await load(background: true) }
        }
    }

    // MARK: - 카드

    /// 카드 구조는 dashboard.md §4 규칙 그대로다 — 카드 `padding: 0`, 좌우 여백은 각
    /// 구획이 갖고, **구분선은 각 구획의 위**에 둔다.
    private var callCard: some View {
        PrismCard(padding: 0, spacing: 0) {
            head
            notices
            if let active = call.call {
                stage(active)
            } else {
                lobbyBody
            }
            if let active = call.call {
                CallDiagnostics(
                    stats: call.stats,
                    connectedAt: active.connectedAt,
                    isLoopback: active.isLoopback,
                    log: call.log,
                    icePolicy: call.icePolicy,
                    cameras: call.cameras,
                    microphones: call.microphones,
                    cameraID: call.cameraID,
                    microphoneID: call.microphoneID,
                    onClearLog: call.clearLog,
                    onIcePolicy: call.setIcePolicy,
                    onSelectCamera: call.selectCamera,
                    onSelectMicrophone: call.selectMicrophone,
                )
            } else {
                // 미디어가 서버를 지나지 않는 것이 이 슬라이스의 핵심이라 화면에도 한
                // 줄로 적는다 — 카드 바닥의 제 구획이다(시안 Foot).
                Rectangle().fill(AppColor.border).frame(height: 1)
                Text(t(.webrtcP2pNote))
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, AppDimension.Call.cardInset)
                    .padding(.vertical, AppDimension.Call.footPadding)
            }
        }
    }

    /// 카드 머리는 **지금 무엇을 하는 중인가**를 말한다. 붙은 뒤에는 부제를 두지 않는다 —
    /// 상대가 누구인지는 타일의 이름표가 이미 말하고, 상태는 오른쪽 배지가 말한다(시안 Head).
    private var head: some View {
        HStack(alignment: .center, spacing: AppDimension.Spacing.sm) {
            VStack(alignment: .leading, spacing: AppDimension.Dashboard.headSpacing) {
                Text(headTitle)
                    .font(.system(size: AppDimension.FontSize.sectionTitle, weight: .semibold))
                    .foregroundStyle(AppColor.heading)
                if let subtitle = headSubtitle {
                    Text(subtitle)
                        .font(.system(size: inCall
                            ? AppDimension.Call.fontCaption
                            : AppDimension.FontSize.body))
                        .foregroundStyle(AppColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: AppDimension.Spacing.sm)
            // 연결 상태 배지는 **카드 머리**에 둔다 — 그것은 통화의 상태이지 어느 타일의
            // 상태가 아니다(§4).
            if let active = call.call {
                PrismBadge(
                    title: t(Self.statusKey(active.status)),
                    variant: Self.statusVariant(active.status),
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, AppDimension.Call.cardInset)
        .padding(.vertical, inCall
            ? AppDimension.Call.headPadding
            : AppDimension.Call.lobbyHeadPadding)
    }

    private var headTitle: String {
        guard let active = call.call else { return t(.webrtcLobbyTitle) }
        guard active.status == .ringing else { return t(.webrtcInCall) }
        return t(.webrtcCalling, ["device": peerLabel])
    }

    private var headSubtitle: String? {
        guard let active = call.call else { return t(.webrtcLobbyDesc) }
        // 상한(45초)은 **이 한 줄에만** 둔다 — 만료 화면에서 되풀이하지 않는다(§4).
        return active.status == .ringing ? t(.webrtcRingTimeoutNote) : nil
    }

    /// 상대 이름은 **기기 종류**다. 루프백에서는 두 타일이 같은 카메라를 나눠 쓰므로
    /// 이름표가 `Loopback`이다.
    private var peerLabel: String {
        guard let active = call.call else { return "" }
        if active.isLoopback { return t(.webrtcLoopbackPeer) }
        guard let peer = active.peer else { return "" }
        return t(DashboardView.deviceLabel(peer.device))
    }

    /// 알림 한 줄 — 거절·종료·오류·만료가 여기로 온다. 통화가 끝난 뒤 남는 것은 이것뿐이고,
    /// 기록은 남기지 않는다(§2). **닫기 버튼을 두지 않는다** — 다시 걸 수 있는 목록이
    /// 바로 아래에 있고, 다음 통화를 시작하면 사라진다.
    @ViewBuilder
    private var notices: some View {
        if let error = call.mediaError {
            notice(t(Self.mediaErrorKey(error)), isError: Self.mediaErrorIsError(error))
        } else if let pending = call.notice {
            let described = describe(pending)
            notice(described.text, isError: described.isError)
        }
        if loadFailed {
            VStack(alignment: .leading, spacing: AppDimension.Spacing.sm) {
                PrismErrorAlert(message: t(.errorSessionsLoadFailed))
                PrismButton(title: t(.commonRetry), variant: .secondary, fillsWidth: false) {
                    loadFailed = false
                    Task { await load() }
                }
            }
            .padding(.horizontal, AppDimension.Call.cardInset)
            .padding(.bottom, AppDimension.Call.bodySpacing)
        }
    }

    private func notice(_ message: String, isError: Bool) -> some View {
        Group {
            if isError {
                PrismErrorAlert(message: message)
            } else {
                // 정보 알림 — 거절·상대 종료처럼 **오류가 아닌 사실 통지**다(§4).
                Text(message)
                    .font(.system(size: AppDimension.FontSize.small))
                    .lineSpacing(AppDimension.Alert.lineSpacing)
                    .foregroundStyle(AppColor.info)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, AppDimension.Alert.horizontalPadding)
                    .padding(.vertical, AppDimension.Alert.verticalPadding)
                    .background(AppColor.infoBackground)
                    .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
                    .accessibilityAddTraits(.isStaticText)
            }
        }
        .padding(.horizontal, AppDimension.Call.cardInset)
        .padding(.bottom, AppDimension.Call.bodySpacing)
    }

    // MARK: - 무대(통화 중)

    /// **판은 Surface, 타일은 Stage** — 판까지 어두우면 타일 경계가 사라진다(§4).
    ///
    /// 375에서는 두 타일을 나란히 두는 대신 **피어 전면 + 셀프 PiP(우상단)**다.
    /// 우하단은 이름 칩·컨트롤과 겹치고 좌하단은 이름 칩 자리다 — 상태 배지를 카드
    /// 머리에 둔 결정이 우상단을 비워 줬다.
    private func stage(_ active: ActiveCall) -> some View {
        VStack(spacing: 0) {
            Rectangle().fill(AppColor.border).frame(height: 1)
            ZStack(alignment: .topTrailing) {
                CallVideoTile(
                    track: call.remoteVideoTrack,
                    name: peerLabel,
                    state: Self.peerTileState(active.status, call.remoteVideoTrack != nil),
                    message: peerTileMessage(active.status, call.remoteVideoTrack != nil),
                ) {
                    // 타일의 행동은 **하나뿐이다.** 호출 중에는 나가는 길이 `Cancel`
                    // 하나여야 해서 컨트롤 바에 종료를 그리지 않고 타일이 이 버튼을
                    // 갖고(§4), 실패에는 문구가 없으므로 `Try again`만 남는다.
                    if active.status == .ringing {
                        PrismButton(
                            title: t(.commonCancel),
                            variant: .secondary,
                            fillsWidth: false,
                            action: call.cancelCall,
                        )
                    } else if active.status == .failed {
                        PrismButton(
                            title: t(.commonRetry),
                            variant: .secondary,
                            fillsWidth: false,
                            action: call.retryCall,
                        )
                    }
                }
                .frame(height: AppDimension.Call.stageHeight)

                // 셀프 PiP — 이름표 없이 흰 테두리만. **셀프만 미러링한다**(§4).
                CallVideoTile(
                    track: call.localVideoTrack,
                    state: Self.selfTileState(call.cameraOn, call.hasMedia, call.mediaError),
                    mirrored: true,
                    muted: !call.micOn,
                    pip: true,
                )
                .frame(
                    width: AppDimension.Call.pipWidth,
                    height: AppDimension.Call.pipHeight,
                )
                .shadow(color: .black.opacity(0.1), radius: 4, y: 4)
                .padding(AppDimension.Call.pipInset)
                .accessibilityLabel(t(.webrtcYou))
            }
            .padding(AppDimension.Call.stagePadding)
            .background(AppColor.surface)
        }
    }

    // MARK: - 로비

    /// 프리뷰(컨트롤이 **타일 위에 얹힌다**) + 카메라·마이크 + 기기 목록.
    private var lobbyBody: some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.bodySpacing) {
            ZStack(alignment: .bottom) {
                CallVideoTile(
                    track: call.localVideoTrack,
                    name: t(.webrtcYou),
                    state: Self.selfTileState(call.cameraOn, call.hasMedia, call.mediaError),
                    mirrored: true,
                    muted: !call.micOn,
                    message: selfTileMessage,
                ) {
                    // 미리 켜 보는 길. **자동으로는 켜지지 않는다** — 누르는 것이 곧
                    // 제스처다(§7). 아직 허용한 적이 없으면 이 버튼이 장치 이름을 얻는
                    // 유일한 길이기도 하다.
                    //
                    // ⚠️ **실패한 뒤에도 남는다.** 오류 문구가 하나같이 "고치고 다시"라고
                    // 말하는데(권한 허용·다른 앱 종료·장치 연결) 버튼을 치우면 그 자리가
                    // 막다른 길이 된다. 라벨은 **상태와 무관하게 하나다** — 이 버튼이 하는
                    // 일은 어느 상태에서나 "카메라를 연다" 하나뿐이고, 무엇이 잘못됐는지는
                    // 알림과 타일 이름표가 이미 말한다(웹과 같은 규칙).
                    if !call.hasMedia {
                        PrismButton(
                            title: t(.webrtcPreviewStart),
                            variant: .secondary,
                            fillsWidth: false,
                            action: call.startPreview,
                        )
                    }
                }
                .frame(height: AppDimension.Call.previewHeight)

                // 로비에서는 컨트롤이 프리뷰 위에 얹힌다(시안 Preview).
                controls
                    .padding(.bottom, AppDimension.Call.bodySpacing)
            }

            // 장치 선택은 **고를 것이 생긴 뒤에** 나타난다. 권한을 통화 시작으로 미뤘으므로
            // 첫 통화 전에는 목록이 비어 있다 — 빈 셀렉트 위에 라벨만 띄우면 고칠 수 없는
            // 빈 자리가 된다.
            if !call.cameras.isEmpty {
                CallField(label: t(.webrtcCamera)) {
                    CallDeviceSelect(
                        label: t(.webrtcCamera),
                        options: call.cameras,
                        selectedID: call.cameraID,
                        onSelect: call.selectCamera,
                    )
                }
            }
            if !call.microphones.isEmpty {
                CallField(label: t(.webrtcMicrophone)) {
                    CallDeviceSelect(
                        label: t(.webrtcMicrophone),
                        options: call.microphones,
                        selectedID: call.microphoneID,
                        onSelect: call.selectMicrophone,
                    )
                }
            }

            if let list {
                CallTargetList(
                    sessions: list,
                    socketReady: socket.isReady,
                    busy: call.starting,
                    onCall: { session in
                        call.startCall(to: SessionRef(id: session.id, device: session.device))
                    },
                    onLoopback: call.startLoopback,
                )
            } else if !loadFailed {
                Text(t(.commonLoading))
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.muted)
            }
        }
        .padding(AppDimension.Call.bodyPadding)
        .overlay(alignment: .top) {
            Rectangle().fill(AppColor.border).frame(height: 1)
        }
    }

    // MARK: - 컨트롤

    private var controls: some View {
        CallControls(
            micOn: call.micOn,
            cameraOn: call.cameraOn,
            // 로비에도, 호출 중에도 종료는 **없다** — 아직 통화가 아니고, 나가는 길은
            // 호출 중이라면 `Cancel` 하나여야 한다(§4).
            end: inCall && call.call?.status != .ringing,
            onToggleMic: call.toggleMic,
            onToggleCamera: call.toggleCamera,
            onHangUp: call.hangUp,
        )
    }

    /// 시안 `BottomBar (fixed)` — 카드 색 판에 위 테두리. 아래 여백은 홈 인디케이터를
    /// 피하는 몫이라 안전 영역이 있으면 그쪽에 맡긴다.
    private var bottomBar: some View {
        controls
            .frame(maxWidth: .infinity)
            .padding(.top, AppDimension.Call.barTopPadding)
            .padding(.bottom, AppDimension.Call.barTopPadding)
            .background(AppColor.card)
            .overlay(alignment: .top) {
                Rectangle().fill(AppColor.border).frame(height: 1)
            }
    }

    // MARK: - 목록

    private func load(background: Bool = false) async {
        guard let token = accessToken() else { return }
        do {
            // 목록은 대시보드와 **같은 HTTP 경로**에서 온다 — 소켓은 신호만 준다.
            list = try await sessions.sessions(accessToken: token, background: background)
            loadFailed = false
        } catch {
            loadFailed = true
        }
    }

    // MARK: - 상태 → 화면

    /// 배지는 `Atom/Badge`의 **기존 변형을 그대로** 쓴다 — 새 변형 없음(§4).
    static func statusKey(_ status: CallStatus) -> MessageKey {
        switch status {
        case .ringing: .webrtcStatusRinging
        case .connecting: .webrtcStatusConnecting
        case .connected: .webrtcStatusConnected
        case .reconnecting: .webrtcStatusReconnecting
        case .failed: .webrtcStatusFailed
        }
    }

    static func statusVariant(_ status: CallStatus) -> PrismBadge.Variant {
        switch status {
        case .ringing: .neutral
        case .connecting: .info
        case .connected: .success
        case .reconnecting: .warning
        case .failed: .error
        }
    }

    static func mediaErrorKey(_ kind: MediaErrorKind) -> MessageKey {
        switch kind {
        case .denied: .errorCameraPermissionDenied
        case .notFound: .errorCameraNotFound
        case .unavailable: .errorCameraInUse
        }
    }

    /// 타일에 얹는 짧은 한 줄. **알림과 달리 갈래마다 다르다.**
    ///
    /// 하나로 뭉쳐 두었더니 영어가 "No camera access"였다 — 장치가 아예 없는 기기에는
    /// 접근 권한 이야기가 틀린 말이다. 타일은 좁아서 이유를 담을 수 없으니 **알림이
    /// 설명하고 타일은 이름표만 단다**(웹 `MEDIA_TILES`와 같은 표).
    static func mediaTileKey(_ kind: MediaErrorKind) -> MessageKey {
        switch kind {
        case .denied: .webrtcTileCameraDenied
        case .notFound: .webrtcTileCameraMissing
        case .unavailable: .webrtcTileCameraBusy
        }
    }

    /// 이 갈래를 **빨강으로 말할 것인가.**
    ///
    /// ⚠️ 셋이 다 오류는 아니다. `.notFound`는 사용자가 만든 실패가 아니라 **기기의
    /// 사실**이고, 고칠 것이 없는 사람에게 오류로 말하면 "뭔가 잘못했다"로 읽힌다.
    /// 나머지 둘은 손댈 자리가 분명해서 그대로 오류다(웹 `MEDIA_ERRORS`와 같은 표).
    static func mediaErrorIsError(_ kind: MediaErrorKind) -> Bool {
        kind != .notFound
    }

    static func selfTileState(
        _ cameraOn: Bool,
        _ hasMedia: Bool,
        _ mediaError: MediaErrorKind?,
    ) -> TileState {
        if mediaError != nil { return .noVideo }
        // 트랙이 없는 것은 **실패가 아니다** — 통화 전에는 열지 않기 때문이다.
        if !hasMedia { return .idle }
        return cameraOn ? .live : .cameraOff
    }

    private var selfTileMessage: String? {
        if let error = call.mediaError { return t(Self.mediaTileKey(error)) }
        if !call.hasMedia { return t(.webrtcTileCameraIdle) }
        return call.cameraOn ? nil : t(.webrtcTileCameraOff)
    }

    static func peerTileState(_ status: CallStatus, _ hasTrack: Bool) -> TileState {
        if status == .ringing { return .ringing }
        if status == .reconnecting { return .reconnecting }
        if !hasTrack { return .connecting }
        return status == .connected ? .live : .connecting
    }

    private func peerTileMessage(_ status: CallStatus, _ hasTrack: Bool) -> String? {
        if status == .ringing { return t(.webrtcTileRinging) }
        if status == .reconnecting { return t(.webrtcTileReconnecting) }
        // 실패 타일은 **문구를 갖지 않는다** — 배지가 이미 그 말을 한다(§4).
        if status == .failed { return nil }
        return hasTrack ? nil : t(.webrtcTileConnecting)
    }

    /// 로비에 남는 한 줄. 거절·상대 종료는 Info, 권한·통화 중·실패는 Error다(§4).
    private func describe(_ notice: CallNotice) -> (text: String, isError: Bool) {
        switch notice {
        case .declined:
            return (t(.webrtcDeclined), false)
        case let .ended(reason):
            // 응답 없음만 오류다 — 사람이 끊은 것과 소켓이 사라진 것은 **그저 끝**이다.
            return reason == .timeout
                ? (t(.errorNoAnswer), true)
                : (t(.webrtcPeerLeft), false)
        case let .expired(from):
            guard let from else { return (t(.webrtcExpiredTitle), false) }
            return (
                t(.webrtcExpiredBody, ["device": t(DashboardView.deviceLabel(from.device))]),
                false
            )
        case let .error(code):
            return (t(Self.callErrorKey(code)), true)
        }
    }

    /// 계약의 유니온을 키로 쓴다 — 오류 코드가 늘면 여기서 컴파일이 걸린다.
    static func callErrorKey(_ code: CallErrorCode) -> MessageKey {
        switch code {
        case .unreachable: .errorDeviceUnreachable
        case .busy: .errorDeviceBusy
        case .unknownSession: .errorDeviceOffline
        // 루프백이 클라이언트 안에서 끝나므로 자기 자신을 소켓으로 부를 길은 없다 —
        // 여기까지 왔다면 우리 쪽 버그다.
        case .selfCall: .errorCallFailed
        }
    }
}
