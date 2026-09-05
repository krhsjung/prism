//
//  CallControls.swift
//  prism
//
//  Path: Features/Call/CallControls.swift
//

import SwiftUI

/// 음소거 · 카메라 · 종료 — 시안 `Molecule/CallControls`.
///
/// **빨강은 종료에만 쓴다**(plan/webrtc.md §4). 음소거를 빨강으로 칠하는 관행이 있지만
/// 그러면 화면에 빨간 원이 둘 생기고 **되돌릴 수 있는 것과 없는 것**이 같은 색이 된다.
/// 꺼짐은 Warning(내가 지금 꺼 두었다는 알림), 종료는 Destructive.
///
/// **보이는 라벨을 두지 않고 접근성 이름만 둔다** — 세 글리프는 관습이 굳었고, 라벨을
/// 달면 바 폭이 세 배가 되며 ko·ja에서 줄바꿈된다. "터치엔 hover가 없다"는 대시보드
/// 규칙에 대한 의식적 예외다.
struct CallControls: View {
    @Environment(LocalizationStore.self) private var t

    let micOn: Bool
    let cameraOn: Bool
    /// 종료 버튼을 둘 것인가(시안 `End` 불리언).
    ///
    /// 로비와 호출 중에는 **없앤다** — 끄는 것이 아니다. 아직 통화가 아니고, 나가는 길은
    /// 호출 중이라면 `Cancel` 하나여야 한다. 흐린 빨간 원을 남기면 누를 수 있는 것처럼
    /// 보이고, 무대 위에 빨강이 하나 더 생긴다.
    var end = true
    let onToggleMic: () -> Void
    let onToggleCamera: () -> Void
    let onHangUp: () -> Void

    var body: some View {
        HStack(spacing: AppDimension.Call.endSpacing) {
            HStack(spacing: AppDimension.Call.controlSpacing) {
                control(
                    glyph: AnyShape(micOn ? AnyShape(PrismGlyph.Mic()) : AnyShape(PrismGlyph.MicOff())),
                    isOff: !micOn,
                    label: t(micOn ? .webrtcMute : .webrtcUnmute),
                    action: onToggleMic,
                )
                control(
                    glyph: AnyShape(cameraOn
                        ? AnyShape(PrismGlyph.Camera())
                        : AnyShape(PrismGlyph.CameraOff())),
                    isOff: !cameraOn,
                    label: t(cameraOn ? .webrtcCameraOff : .webrtcCameraOn),
                    action: onToggleCamera,
                )
            }
            // 종료 앞의 24는 **안전 여백**이다 — 되돌릴 수 없는 버튼이 반복 조작하는
            // 버튼에 이어 붙으면 오탭이 생긴다(대시보드가 "모두 로그아웃"을 `Revoke`
            // 기둥에 붙이지 않은 것과 같은 규칙).
            if end {
                Button(action: onHangUp) {
                    PrismGlyph.PhoneOff()
                        .prismStroke(size: AppDimension.Call.controlGlyph)
                        // 하드코딩 흰색이면 다크의 밝은 빨강 위에서 대비가 나오지 않는다.
                        .foregroundStyle(AppColor.errorForeground)
                        .frame(
                            width: AppDimension.Call.controlGlyph,
                            height: AppDimension.Call.controlGlyph,
                        )
                        .frame(
                            width: AppDimension.Call.controlSize,
                            height: AppDimension.Call.controlSize,
                        )
                        .background(AppColor.error, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t(.webrtcEndCall))
            }
        }
    }

    /// 되돌릴 수 있는 토글 하나. 꺼져 있으면 Warning으로 물든다 — 색이 곧 "지금 꺼 뒀다"다.
    private func control(
        glyph: AnyShape,
        isOff: Bool,
        label: String,
        action: @escaping () -> Void,
    ) -> some View {
        Button(action: action) {
            glyph
                .prismStroke(size: AppDimension.Call.controlGlyph)
                .foregroundStyle(isOff ? AppColor.warning : AppColor.secondaryForeground)
                .frame(
                    width: AppDimension.Call.controlGlyph,
                    height: AppDimension.Call.controlGlyph,
                )
                .frame(
                    width: AppDimension.Call.controlSize,
                    height: AppDimension.Call.controlSize,
                )
                .background(
                    isOff ? AppColor.warningBackground : AppColor.secondaryBackground,
                    in: .circle,
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        // 켜짐/꺼짐이 색으로만 갈리면 색각 이상에서 구별되지 않는다 — 상태를 값으로도 말한다.
        .accessibilityAddTraits(isOff ? [.isSelected] : [])
    }
}
