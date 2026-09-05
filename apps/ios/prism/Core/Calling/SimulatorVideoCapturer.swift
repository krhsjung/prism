//
//  SimulatorVideoCapturer.swift
//  prism
//
//  Path: Core/Calling/SimulatorVideoCapturer.swift
//

#if targetEnvironment(simulator)
import CoreVideo
import Foundation
import WebRTC

/// 시뮬레이터에서 통화 경로를 **실제로 태우기 위한** 합성 카메라.
///
/// iOS 시뮬레이터에는 캡처 장치가 없다 — `RTCCameraVideoCapturer.captureDevices()`가 빈
/// 배열이라 통화가 `not-found`에서 멈추고, 그러면 이 앱에서 가장 중요한 경로(협상 · ICE ·
/// 지표 · 두 타일)를 기기 없이는 한 번도 확인할 수 없다. 여기서 만드는 프레임은 **테스트용
/// 그림이 아니라 진짜 비디오 트랙**이라, 인코더 · SRTP · 상대의 디코더까지 그대로 지난다.
///
/// **기기 빌드에는 들어가지 않는다**(`#if targetEnvironment(simulator)`). 시뮬레이터에
/// 카메라가 생기면 이 파일은 통째로 지우면 된다 — 호출부도 `captureDevices()`가 비었을
/// 때만 여기로 온다.
///
/// 움직이는 그림을 그리는 이유: 정지 화면은 인코더가 거의 아무것도 보내지 않아 비트레이트
/// 지표가 0에 붙는다. 매 프레임 달라져야 `Sending`·`Video`가 실제 값을 갖는다.
final class SimulatorVideoCapturer: RTCVideoCapturer {
    private let width = 640
    private let height = 480
    private let fps = 15

    private var timer: DispatchSourceTimer?
    private let queue = DispatchQueue(label: "prism.simulator-capture")
    private var frameIndex: UInt64 = 0
    /// 픽셀 버퍼를 매 프레임 새로 만들지 않는다 — 15fps로도 금방 메모리가 튄다.
    private var pool: CVPixelBufferPool?

    func startCapture() {
        stopCapture()
        pool = Self.makePool(width: width, height: height)

        let source = DispatchSource.makeTimerSource(queue: queue)
        source.schedule(deadline: .now(), repeating: .milliseconds(1_000 / fps))
        source.setEventHandler { [weak self] in self?.emit() }
        timer = source
        source.resume()
    }

    func stopCapture() {
        timer?.cancel()
        timer = nil
        pool = nil
    }

    deinit {
        timer?.cancel()
    }

    private func emit() {
        guard let pool, let buffer = Self.makeBuffer(from: pool) else { return }
        Self.draw(into: buffer, frame: frameIndex)
        frameIndex += 1

        // 타임스탬프는 **나노초**다. 여기가 어긋나면 인코더가 프레임을 버리거나 fps를
        // 엉뚱하게 계산해 `Video` 지표가 흔들린다.
        let timestamp = Int64(Date().timeIntervalSince1970 * 1_000_000_000)
        let frame = RTCVideoFrame(
            buffer: RTCCVPixelBuffer(pixelBuffer: buffer),
            rotation: ._0,
            timeStampNs: timestamp,
        )
        delegate?.capturer(self, didCapture: frame)
    }

    private static func makePool(width: Int, height: Int) -> CVPixelBufferPool? {
        let attributes: [CFString: Any] = [
            // 카메라가 내는 것과 같은 형식(NV12) — 인코더가 변환 없이 받는다.
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
        ]
        var pool: CVPixelBufferPool?
        CVPixelBufferPoolCreate(
            kCFAllocatorDefault,
            nil,
            attributes as CFDictionary,
            &pool,
        )
        return pool
    }

    private static func makeBuffer(from pool: CVPixelBufferPool) -> CVPixelBuffer? {
        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &buffer)
            == kCVReturnSuccess
        else { return nil }
        return buffer
    }

    /// 대각선으로 흐르는 줄무늬 + 도는 색. 사람이 봐도 "지금 들어오는 영상"임이 분명하고,
    /// 매 프레임 달라져서 인코더가 실제로 일한다.
    private static func draw(into buffer: CVPixelBuffer, frame: UInt64) {
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let shift = Int(frame) * 3

        if let luma = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) {
            let rowBytes = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
            let plane = luma.assumingMemoryBound(to: UInt8.self)
            for y in 0..<height {
                let row = plane + y * rowBytes
                for x in 0..<width {
                    row[x] = UInt8((x + y + shift) % 256)
                }
            }
        }
        // 색차는 프레임마다 천천히 돈다 — 화면이 단색으로 굳지 않게.
        if let chroma = CVPixelBufferGetBaseAddressOfPlane(buffer, 1) {
            let rowBytes = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1)
            let plane = chroma.assumingMemoryBound(to: UInt8.self)
            let cb = UInt8((Int(frame) / 2) % 256)
            let cr = UInt8(255 - (Int(frame) / 2) % 256)
            for y in 0..<(height / 2) {
                let row = plane + y * rowBytes
                for x in stride(from: 0, to: width, by: 2) {
                    row[x] = cb
                    row[x + 1] = cr
                }
            }
        }
    }
}
#endif
