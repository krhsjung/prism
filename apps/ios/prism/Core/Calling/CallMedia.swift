//
//  CallMedia.swift
//  prism
//
//  Path: Core/Calling/CallMedia.swift
//

import AVFoundation
import Foundation
import WebRTC

/// 카메라·마이크를 여는 자리. `RTCPeerConnection`은 여기를 지나지 않는다 —
/// 미디어를 얻는 일과 그것을 나르는 일을 갈라 두면, 권한 실패가 통화 실패와 섞이지 않는다
/// (웹 `lib/webrtc/media.ts`와 같은 경계).

/// 선택 메뉴 한 줄.
struct MediaDeviceOption: Identifiable, Equatable, Sendable {
    let id: String
    let label: String
}

/// 미디어를 얻지 못한 이유. 화면이 갈라 그려야 하는 것은 이 셋뿐이다.
///  - denied:      사용자가 거부했다 → 화면의 **목적이** 통화 시작에서 권한 고치기로 바뀐다
///  - notFound:    카메라·마이크가 없다 → 고칠 수 있는 것은 기기 쪽이다
///  - unavailable: 다른 앱이 쥐고 있거나 하드웨어가 답하지 않는다 → 다시 시도가 뜻이 있다
enum MediaErrorKind: Sendable {
    case denied
    case notFound
    case unavailable
}

/// 카메라·마이크·트랙을 쥐고 있는 자리.
///
/// **팩토리는 하나뿐이다.** `RTCPeerConnectionFactory`는 무겁고(인코더·디코더·오디오
/// 장치를 통째로 세운다) 여러 개를 만들면 오디오 장치를 서로 뺏는다. 통화가 끝나도
/// 팩토리는 남기고 **트랙과 캡처만** 놓는다.
@MainActor
final class CallMedia {
    /// 해상도를 **고르게 하지 않는다**(plan/webrtc.md §4). ideal만 주고 실제로 무엇이
    /// 잡혔는지는 진단의 `Video` 지표가 말한다 — 고르게 하면 기기가 지원하지 않는
    /// 조합에서 조용히 실패하고, 그 실패를 설명하는 화면을 또 만들어야 한다.
    private static let idealWidth: Int32 = 1_280
    private static let idealHeight: Int32 = 720
    private static let idealFps = 30

    let factory: RTCPeerConnectionFactory

    private(set) var localVideoTrack: RTCVideoTrack?
    private(set) var localAudioTrack: RTCAudioTrack?

    private var videoSource: RTCVideoSource?
    private var capturer: RTCCameraVideoCapturer?
    #if targetEnvironment(simulator)
    /// 시뮬레이터에는 캡처 장치가 없다 — 합성 프레임으로 통화 경로를 실제로 태운다.
    private var synthetic: SimulatorVideoCapturer?
    #endif
    /// 지금 잡고 있는 카메라. 장치를 바꿀 때 같은 것을 다시 여는 일을 막는다.
    private(set) var cameraID: String?
    private(set) var microphoneID: String?

    init() {
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory(),
        )
    }

    // MARK: - 권한

    /// 이 앱이 **이미 카메라·마이크를 쓸 수 있는가.**
    ///
    /// 웹은 "장치 이름이 채워졌는가"로 이것을 알아내지만(브라우저가 허용 뒤에야 이름을
    /// 준다), iOS에는 상태를 직접 묻는 API가 있다 — 같은 질문에 대한 **더 정확한 답**이라
    /// 그쪽을 쓴다. 어느 쪽이든 `getUserMedia`에 해당하는 것을 부르지 않으므로
    /// 카메라는 켜지지 않고 표시등도 꺼져 있다.
    static var isAuthorized: Bool {
        AVCaptureDevice.authorizationStatus(for: .video) == .authorized
            && AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    /// 권한을 **묻는다**. `Call`·`Accept`·`Test`를 누른 순간에만 불린다 — 로비에 들어온
    /// 것만으로는 부르지 않는다(plan/webrtc.md §7: 명시적 사용자 제스처 후).
    private static func request() async -> MediaErrorKind? {
        for media in [AVMediaType.video, .audio] {
            switch AVCaptureDevice.authorizationStatus(for: media) {
            case .authorized:
                continue
            case .notDetermined:
                if await AVCaptureDevice.requestAccess(for: media) { continue }
                return .denied
            default:
                // 거부·제한 — 앱 안에서 되돌릴 수 없다. 설정으로 가라고 화면이 말한다.
                return .denied
            }
        }
        return nil
    }

    // MARK: - 장치 목록

    /// 고를 수 있는 장치들.
    ///
    /// 권한 전에도 부를 수 있지만 화면은 **허용된 뒤에만** 이것을 그린다 — 고를 수
    /// 없는 목록을 띄우면 눌러도 아무 일이 없는 자리가 된다.
    /// - Parameter simulatorCameraLabel: 시뮬레이터의 합성 카메라에 붙일 이름. 화면에
    ///   보이므로 마스터 문구에서 온다 — 여기서 번역기를 들지 않는 것은 이 타입이
    ///   `@MainActor`가 아니기 때문이고, 기기 빌드에서는 쓰이지 않는다.
    static func devices(
        simulatorCameraLabel: String,
    ) -> (cameras: [MediaDeviceOption], microphones: [MediaDeviceOption]) {
        var cameras = RTCCameraVideoCapturer.captureDevices().map {
            MediaDeviceOption(id: $0.uniqueID, label: $0.localizedName)
        }
        #if targetEnvironment(simulator)
        // 시뮬레이터에는 캡처 장치가 없다. 그런데 `open()`은 합성 카메라로 갈아타 **실제로
        // 프레임을 낸다** — 목록만 비워 두면 "영상은 나오는데 고를 카메라가 없다"가 되어,
        // Android 에뮬레이터(가상 카메라를 실제로 센다)와 나란히 놓았을 때 iOS만 카메라
        // 선택이 없는 것처럼 읽힌다. 기기 빌드에는 이 갈래가 아예 없다.
        if cameras.isEmpty {
            cameras = [MediaDeviceOption(id: syntheticCameraID, label: simulatorCameraLabel)]
        }
        #endif
        // 마이크는 `AVAudioSession`이 가진다 — WebRTC는 iOS의 기본 입력을 그대로 쓰므로
        // 고르는 일도 그쪽에 맡긴다(장치를 직접 여는 카메라와 다른 점이다).
        let microphones = (AVAudioSession.sharedInstance().availableInputs ?? []).map {
            MediaDeviceOption(id: $0.uid, label: $0.portName)
        }
        return (cameras, microphones)
    }

    // MARK: - 열기 / 놓기

    /// 카메라·마이크를 연다. 실패하면 이유를 돌려준다(트랙은 그대로 둔다).
    ///
    /// **고른 장치가 없으면 기본 장치로 연다.** 뽑혔거나 id가 바뀐 장치를 고집하다
    /// 통화를 통째로 포기하는 것은 과하다 — 어느 장치로 붙었는지는 진단이 말해 준다.
    func open(cameraID wanted: String?, microphoneID wantedMic: String?) async -> MediaErrorKind? {
        if let failure = await Self.request() { return failure }
        configureAudioSession()

        let devices = RTCCameraVideoCapturer.captureDevices()

        #if targetEnvironment(simulator)
        // 시뮬레이터는 여기서 갈라진다. 기기 빌드에는 이 갈래가 아예 없다.
        if devices.isEmpty {
            openSynthetic()
            select(microphone: wantedMic)
            return nil
        }
        #endif

        guard !devices.isEmpty else { return .notFound }
        // 앞면 카메라가 기본이다 — 통화의 기본 피사체는 내 얼굴이다.
        let device = devices.first { $0.uniqueID == wanted }
            ?? devices.first { $0.position == .front }
            ?? devices[0]

        guard let format = Self.bestFormat(for: device) else { return .notFound }

        let source = videoSource ?? factory.videoSource()
        let capture = capturer ?? RTCCameraVideoCapturer(delegate: source)
        videoSource = source
        capturer = capture

        do {
            // 새 장치를 잡기 전에 **먼저 멈춘다** — 캡처러 하나가 두 장치를 동시에
            // 열 수 없다(장치를 바꿀 때만 실제로 일어난다).
            if cameraID != nil, cameraID != device.uniqueID {
                await capture.stopCapture()
            }
            try await capture.startCapture(
                with: device,
                format: format,
                fps: min(Self.idealFps, Int(format.videoSupportedFrameRateRanges
                    .map(\.maxFrameRate).max() ?? Double(Self.idealFps))),
            )
        } catch {
            Log.error("camera capture failed")
            return .unavailable
        }
        cameraID = device.uniqueID

        if localVideoTrack == nil {
            localVideoTrack = factory.videoTrack(with: source, trackId: "prism-video")
        }
        if localAudioTrack == nil {
            localAudioTrack = factory.audioTrack(
                with: factory.audioSource(with: nil),
                trackId: "prism-audio",
            )
        }

        select(microphone: wantedMic)
        return nil
    }

    #if targetEnvironment(simulator)
    /// 합성 카메라로 트랙을 세운다. 실제 카메라 경로와 **같은 소스·같은 트랙**을 쓴다 —
    /// 갈라지는 것은 프레임이 어디서 오느냐뿐이라, 협상부터 지표까지 나머지가 전부 같다.
    private func openSynthetic() {
        let source = videoSource ?? factory.videoSource()
        videoSource = source
        if synthetic == nil {
            let capture = SimulatorVideoCapturer(delegate: source)
            capture.startCapture()
            synthetic = capture
        }
        if localVideoTrack == nil {
            localVideoTrack = factory.videoTrack(with: source, trackId: "prism-video")
        }
        if localAudioTrack == nil {
            localAudioTrack = factory.audioTrack(
                with: factory.audioSource(with: nil),
                trackId: "prism-audio",
            )
        }
        // 화면이 "카메라를 쥐고 있다"를 이 값으로 판단한다(실제 카메라와 같은 규칙).
        cameraID = "simulator"
    }
    #endif

    #if targetEnvironment(simulator)
    /// 합성 카메라의 자리. 실제 장치 id와 겹치지 않게 접두어를 붙인다.
    static let syntheticCameraID = "prism.simulator.camera"
    #endif

    /// 오디오 세션을 **영상통화용으로** 세운다.
    ///
    /// 하지 않으면 WebRTC가 기본값(`.playAndRecord` + 수화기 출력)으로 시작한다 —
    /// 영상통화인데 소리가 귀에 대는 스피커로 나가고, 모드가 통화용이 아니라 하드웨어
    /// 에코 제거가 물리지 않아 상대에게 내 소리가 되돌아간다.
    ///
    /// `RTCAudioSession`을 지나는 이유: WebRTC가 이 세션을 소유하고 있어서, 바깥에서
    /// `AVAudioSession`을 직접 만지면 다음 활성화 때 조용히 되돌려진다. `lockForConfiguration`
    /// 안에서 바꿔야 그 소유권과 어긋나지 않는다.
    private func configureAudioSession() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .videoChat,
                // 영상통화의 기본 출력은 스피커다(손에 들고 화면을 본다). 이어폰·블루투스가
                // 꽂혀 있으면 시스템이 그쪽을 고르므로, 이 값은 "아무것도 없을 때"의 답이다.
                options: [.defaultToSpeaker, .allowBluetoothHFP],
            )
        } catch {
            // 실패해도 통화는 선다 — 라우팅이 기본값일 뿐이다.
            Log.error("audio_session_failed")
        }
    }

    /// 마이크를 고른다. 값이 없으면 시스템 기본을 그대로 둔다.
    func select(microphone id: String?) {
        guard let id else { return }
        let session = RTCAudioSession.sharedInstance()
        guard let input = session.session.availableInputs?.first(where: { $0.uid == id })
        else { return }
        // WebRTC가 세션을 소유하므로 잠금 안에서 바꾼다 — 바깥에서 만지면 다음 활성화
        // 때 조용히 되돌려진다.
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        // 실패해도 통화는 기본 입력으로 이어진다 — 고르지 못한 것이 못 붙을 이유는 아니다.
        try? session.session.setPreferredInput(input)
        microphoneID = id
    }

    /// 카메라·마이크를 **놓는다.** 표시등이 꺼지는 것이 이 함수의 관찰 가능한 결과다.
    ///
    /// 트랙을 `isEnabled = false`로 끄는 것(음소거·카메라 오프)과 다르다 — 그쪽은
    /// 장치를 계속 쥔 채 신호만 죽이므로 표시등이 켜져 있다. 통화가 끝났는데 표시등이
    /// 남으면 사용자는 우리가 아직 보고 있다고 읽는다.
    func release() async {
        #if targetEnvironment(simulator)
        synthetic?.stopCapture()
        synthetic = nil
        #endif
        if let capturer, cameraID != nil {
            await capturer.stopCapture()
        }
        cameraID = nil
        localVideoTrack = nil
        localAudioTrack = nil
        videoSource = nil
        capturer = nil
    }

    /// 트랙을 **멈추지 않고 끄기만** 한다 — 다시 켤 때 권한을 새로 묻지 않는다.
    func setEnabled(video: Bool? = nil, audio: Bool? = nil) {
        if let video { localVideoTrack?.isEnabled = video }
        if let audio { localAudioTrack?.isEnabled = audio }
    }

    /// 1280×720에 **가장 가까운** 포맷. 정확히 그것을 요구하지 않는 이유는 §4와 같다 —
    /// 기기가 지원하지 않는 조합을 고르면 조용히 실패한다.
    private static func bestFormat(for device: AVCaptureDevice) -> AVCaptureDevice.Format? {
        RTCCameraVideoCapturer.supportedFormats(for: device).min { lhs, rhs in
            distance(of: lhs) < distance(of: rhs)
        }
    }

    private static func distance(of format: AVCaptureDevice.Format) -> Int32 {
        let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        return abs(size.width - idealWidth) + abs(size.height - idealHeight)
    }
}
