//
//  CallVideoTile.swift
//  prism
//
//  Path: Features/Call/CallVideoTile.swift
//

import SwiftUI
import WebRTC

/// 타일 안의 한 줄. **연결 상태 배지는 여기 있지 않다** — 그것은 통화의 상태이지 어느
/// 타일의 상태가 아니라서 카드 머리에 산다(plan/webrtc.md §4).
///
/// `failed`가 없는 것도 결정이다: 실패 타일은 문구를 갖지 않는다. 배지가 이미
/// "Connection failed"라고 말하고 있고 자세한 사정은 notice의 알림이 맡는다.
enum TileState {
    case live
    /// 아직 카메라를 켜지 않았다 — **실패가 아니라 아직 묻지 않은 것**이다(`noVideo`와 다르다).
    case idle
    case ringing
    case notified
    case connecting
    case reconnecting
    case cameraOff
    case noVideo

    /// 영상이 실제로 그려지는 상태. 나머지는 어두운 판 위에 상태 줄이 온다.
    var showsVideo: Bool { self == .live || self == .reconnecting }
}

/// `RTCVideoTrack`을 그리는 자리.
///
/// **셀프만 미러링한다**(§4) — 상대를 뒤집으면 상대가 든 글씨가 뒤집힌다. 뒤집기는
/// 렌더러의 변환으로 하고 트랙은 건드리지 않는다(보내는 영상은 그대로여야 한다).
struct CallVideoRenderer: UIViewRepresentable {
    let track: RTCVideoTrack?
    var mirrored = false

    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView()
        // 타일을 채운다 — 레터박스를 두면 어두운 판 위에 또 다른 어두운 띠가 생겨
        // 타일 경계가 어디인지 읽히지 않는다.
        view.videoContentMode = .scaleAspectFill
        view.clipsToBounds = true
        return view
    }

    func updateUIView(_ view: RTCMTLVideoView, context: Context) {
        view.transform = mirrored ? CGAffineTransform(scaleX: -1, y: 1) : .identity
        guard context.coordinator.track != track else { return }
        // 옛 트랙에서 **떼고 나서** 새 트랙에 붙인다 — 순서가 뒤집히면 한 렌더러가
        // 두 트랙에 걸려 프레임이 섞인다.
        context.coordinator.track?.remove(view)
        track?.add(view)
        context.coordinator.track = track
    }

    static func dismantleUIView(_ view: RTCMTLVideoView, coordinator: Coordinator) {
        coordinator.track?.remove(view)
        coordinator.track = nil
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var track: RTCVideoTrack?
    }
}

/// 통화 타일 — 시안 `Molecule/VideoTile`.
///
/// 크기는 변형이 아니라 **리사이즈**다(큰 타일도 PiP도 같은 컴포넌트). 다른 것은
/// PiP가 이름표를 달지 않고 흰 테두리를 갖는다는 점뿐이다 — 96 폭에서 칩이 판을 다
/// 먹고, 배경 타일과 같은 `Stage` 색이라 경계가 필요하다.
struct CallVideoTile<Action: View>: View {
    let track: RTCVideoTrack?
    var name: String?
    let state: TileState
    /// 셀프만 미러링한다 — 상대가 든 글씨가 뒤집히면 안 된다(§4).
    var mirrored = false
    var muted = false
    /// 상태 줄의 문구. 이미 번역해서 넘긴다.
    var message: String?
    /// 화면 안에 겹쳐 놓는 작은 타일(모바일의 셀프 PiP).
    var pip = false
    /// 상태 줄 아래의 단 하나의 행동(호출 중의 `Cancel`, 로비의 `카메라 켜기`).
    @ViewBuilder var action: () -> Action

    var body: some View {
        ZStack {
            AppColor.stage

            if state.showsVideo {
                CallVideoRenderer(track: track, mirrored: mirrored)
                    // 재연결 중에는 마지막 프레임이 멈춰 있다 — 흐리게 해서 "지금 것이
                    // 아니다"를 말한다(시안 `State=Reconnecting`).
                    .opacity(state == .reconnecting ? 0.5 : 1)
            } else {
                VStack(spacing: AppDimension.Call.tileContentSpacing) {
                    if let message {
                        Text(message)
                            .font(.system(size: AppDimension.FontSize.body))
                            .foregroundStyle(AppColor.stageForeground)
                            .multilineTextAlignment(.center)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    action()
                }
                .padding(AppDimension.Call.stagePadding)
            }

            // 이름표는 **좌하단**이다. 우상단은 PiP 자리이고, 우하단은 컨트롤과 겹친다.
            if let name, !pip {
                VStack {
                    Spacer()
                    HStack {
                        nameChip(name)
                        Spacer()
                    }
                }
                .padding(AppDimension.Call.pipInset)
            }

            // 음소거 표시는 이름표 반대쪽 — 같은 모서리에 두면 긴 이름에서 겹친다.
            if muted {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        PrismGlyph.MicOff()
                            .prismStroke(size: AppDimension.Call.controlGlyph)
                            .foregroundStyle(AppColor.stageForeground)
                            .frame(
                                width: AppDimension.Call.controlGlyph,
                                height: AppDimension.Call.controlGlyph,
                            )
                            .padding(AppDimension.Spacing.xs)
                            .background(.black.opacity(0.45), in: .circle)
                    }
                }
                .padding(AppDimension.Call.pipInset)
            }
        }
        .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
        .overlay {
            if pip {
                // 배경 타일과 같은 `Stage` 색이라 경계가 필요하다(시안 흰 테두리 2).
                RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                    .strokeBorder(
                        .white.opacity(0.5),
                        lineWidth: AppDimension.Call.pipBorderWidth,
                    )
            }
        }
    }

    /// 시안 `Label chip` — 어두운 알약. 배경은 토큰이 아니라 **영상 위의 반투명 검정**이라
    /// 라이트/다크 어느 쪽에서도 글자가 읽힌다.
    private func nameChip(_ name: String) -> some View {
        Text(name)
            .font(.system(size: AppDimension.Dashboard.badgeFontSize, weight: .semibold))
            .foregroundStyle(AppColor.stageForeground)
            .padding(.horizontal, AppDimension.Call.chipHorizontalPadding)
            .frame(height: AppDimension.Call.chipHeight)
            .background(.black.opacity(0.45), in: .capsule)
    }
}

extension CallVideoTile where Action == EmptyView {
    /// 행동이 없는 타일 — 대부분이 이쪽이다.
    init(
        track: RTCVideoTrack?,
        name: String? = nil,
        state: TileState,
        mirrored: Bool = false,
        muted: Bool = false,
        message: String? = nil,
        pip: Bool = false,
    ) {
        self.init(
            track: track,
            name: name,
            state: state,
            mirrored: mirrored,
            muted: muted,
            message: message,
            pip: pip,
        ) { EmptyView() }
    }
}
