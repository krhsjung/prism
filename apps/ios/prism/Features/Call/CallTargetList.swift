//
//  CallTargetList.swift
//  prism
//
//  Path: Features/Call/CallTargetList.swift
//

import SwiftUI

/// 로비의 **내 기기 목록** — 시안 `Molecule/CallTarget` × `List`.
///
/// 코드 입력란이 있던 자리다(plan/webrtc.md §4). 방 코드를 사람이 짓거나 받아 적는 대신
/// **이미 인증된 내 세션**을 고른다. 대시보드가 그리는 목록과 같은 데이터·같은 행
/// 구성이고, 기기명·브라우저·위치를 담지 않는 이유도 그대로 물려받는다.
///
/// 목록은 **테두리 하나에 구분선으로 나뉜 한 판**이다 — 행마다 카드를 주면 기기 수만큼
/// 상자가 생겨 목록이 아니라 카드 더미로 읽힌다(시안 `List`).
struct CallTargetList: View {
    @Environment(LocalizationStore.self) private var t

    let sessions: [SessionListItem]
    /// 내 소켓이 붙어 있는가. 아니면 **아무도 부를 수 없다** — 시그널링이 이 소켓뿐이다.
    let socketReady: Bool
    /// 통화 중이면 목록 전체를 잠근다 — 서버도 세션당 한 통화만 허락한다.
    let busy: Bool
    let onCall: (SessionListItem) -> Void
    let onLoopback: () -> Void

    private var current: SessionListItem? { sessions.first(where: \.isCurrent) }
    private var others: [SessionListItem] { sessions.filter { !$0.isCurrent } }

    var body: some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
            Text(t(.webrtcDevices))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.text)
            Text(t(.webrtcDevicesDesc))
                .font(.system(size: AppDimension.Call.fontCaption))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 0) {
                if let current {
                    // 현재 세션 줄만 할 수 있는 일이 있다 — 대시보드에서는 `Revoke`를 갖지
                    // 않는 그 줄이 여기서는 **루프백 시험**이다(§4).
                    DeviceRowView(
                        device: current.device,
                        title: t(.webrtcThisTab),
                        subtitle: t(.webrtcLoopback),
                        isMuted: false,
                    ) {
                        PrismButton(
                            title: t(.webrtcTest),
                            variant: .outline,
                            isEnabled: !busy,
                            fillsWidth: false,
                            action: onLoopback,
                        )
                        .accessibilityLabel("\(t(.webrtcTest)): \(t(.webrtcLoopback))")
                    }
                }

                ForEach(others) { session in
                    // 소켓이 없으면 서버가 `unreachable`로 거절한다. 푸시로 깨우는 경로는
                    // push 슬라이스와 함께 붙고(§8-11), 그때까지 이 줄은 알림이 꺼진 줄이다.
                    // **소켓의 유무는 "걸 수 있는가"가 아니라 "어떻게 닿는가"를
                    // 가른다**(§4). 세션이 살아 있으면 전부 통화 대상이다 — 붙어 있으면
                    // 즉시 울리고, 아니면 서버가 알림으로 깨운다. 백그라운드로 내린 앱을
                    // 죽은 줄로 그리면 이 앱에서 가장 흔한 경우가 막힌다.
                    //
                    // **닿지 않는 줄만 버튼을 잃는다**: 소켓도 없고 토큰도 없을 때다.
                    let reachable =
                        socketReady && (session.isConnected || session.pushRegistered)
                    // 부제가 갈린다 — 기다리는 시간이 왜 다른지를 목록에서부터 말한다(§4).
                    let willNotify = reachable && !session.isConnected
                    divider
                    DeviceRowView(
                        device: session.device,
                        title: t(DashboardView.deviceLabel(session.device)),
                        subtitle: willNotify
                            ? t(.webrtcWillNotify)
                            : "#\(session.id.prefix(8))",
                        isMuted: !reachable,
                    ) {
                        if reachable {
                            PrismButton(
                                title: t(.webrtcCall),
                                // 손가락에는 hover가 없다 — 목록 안의 인라인 액션은
                                // Ghost가 아니라 Secondary다(시안 `Atom/Button` 설명).
                                variant: .secondary,
                                isEnabled: !busy,
                                fillsWidth: false,
                            ) {
                                onCall(session)
                            }
                            // 목록에 `Call`이 여럿이라 버튼 글자만으로는 무엇에 거는지 알 수 없다.
                            .accessibilityLabel(
                                "\(t(.webrtcCall)): \(t(DashboardView.deviceLabel(session.device)))"
                                    + " · #\(session.id.prefix(8))",
                            )
                        } else {
                            // **닿지 않는 줄만 버튼을 잃는다.** 회색 버튼을 남기면 눌러 볼 수
                            // 있는 것처럼 보이고, 벨이 끝날 때까지 기다린 뒤에야 이유를 안다.
                            PrismBadge(title: t(.webrtcNotificationsOff), variant: .neutral)
                        }
                    }
                }
            }
            // 판 **안쪽**의 위아래 여백이다 — 테두리 바깥에 주면 첫 행과 마지막 행이
            // 선에 붙는다(웹 `.targets { padding: 6px 0 }`).
            .padding(.vertical, AppDimension.Call.listVerticalPadding)
            .background(AppColor.card)
            .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                    .stroke(AppColor.border, lineWidth: 1)
            }

            // 목록이 비면 빈 상태 대신 **다음에 할 일**을 적는다(§4).
            if others.isEmpty {
                Text(t(.webrtcNoOtherDevices))
                    .font(.system(size: AppDimension.Call.fontCaption))
                    .foregroundStyle(AppColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    // 목록에서 한 칸 더 떨어진다(웹 `.setup__hint--after`).
                    .padding(.top, AppDimension.Dashboard.headSpacing)
            }
        }
    }

    private var divider: some View {
        Rectangle().fill(AppColor.border).frame(height: 1)
    }

}

/// 라벨과 그 아래 컨트롤 한 벌(웹 `.setup__field`).
///
/// **라벨은 컨트롤이 아니라 부르는 쪽이 그린다.** 로비는 셀렉트마다 제 이름을 얹지만
/// (`카메라`·`마이크`), 진단 패널은 둘 위에 `카메라 · 마이크` 하나를 얹는다 —
/// 컨트롤이 제 라벨을 그리면 진단에서 이름이 두 번 나온다(시안 `Devices` 프레임).
struct CallField<Content: View>: View {
    let label: String
    /// 로비는 6, 진단 설정은 8(웹 `.setup__field` · `.diag__setting`).
    var spacing: CGFloat = AppDimension.Call.fieldSpacing
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            Text(label)
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.text)
            content
        }
    }
}

/// 카메라·마이크 선택(시안 `Molecule/Select`, `Leading icon` 꺼짐).
///
/// 트리거는 44 — 375에서 손가락이 누르는 표적이라 시안의 39에서 키운다(대시보드의
/// 셀렉트가 같은 이유로 같은 값을 쓴다). 보이는 라벨은 `CallField`가 갖고, 여기서는
/// 접근성 이름으로만 남는다.
struct CallDeviceSelect: View {
    /// 접근성 이름 전용 — 화면에는 그리지 않는다(웹 `SelectMenu`의 `aria-label`).
    let label: String
    let options: [MediaDeviceOption]
    let selectedID: String?
    let onSelect: (String) -> Void

    @State private var isOpen = false

    private var current: MediaDeviceOption? {
        options.first { $0.id == selectedID } ?? options.first
    }

    var body: some View {
        Button { isOpen.toggle() } label: {
            HStack(spacing: AppDimension.Spacing.sm) {
                Text(current?.label ?? "—")
                    .font(.system(size: AppDimension.FontSize.body, weight: .semibold))
                    .foregroundStyle(AppColor.muted)
                    .lineLimit(1)
                Spacer(minLength: AppDimension.Spacing.sm)
                // 셰브런은 **펴지는 방향**을 가리킨다 — 아래로 펼치는 메뉴는 아래.
                PrismGlyph.Chevron(up: isOpen)
                    .prismStroke(size: AppDimension.Dashboard.sessionIconGlyph)
                    .foregroundStyle(AppColor.muted)
                    .frame(
                        width: AppDimension.Dashboard.sessionIconGlyph,
                        height: AppDimension.Dashboard.sessionIconGlyph,
                    )
            }
            .padding(.horizontal, AppDimension.Select.triggerPadding)
            .frame(height: AppDimension.Select.triggerHeight)
            .frame(maxWidth: .infinity)
            .background(
                isOpen ? AppColor.secondaryBackground : .clear,
                in: .rect(cornerRadius: AppDimension.Radius.md),
            )
            .overlay {
                RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                    .stroke(
                        isOpen ? AppColor.border : .clear,
                        lineWidth: AppDimension.Select.borderWidth,
                    )
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(current?.label ?? "")
        .popover(isPresented: $isOpen, attachmentAnchor: .rect(.bounds)) {
            VStack(spacing: AppDimension.Select.optionSpacing) {
                ForEach(options) { option in
                    Button {
                        onSelect(option.id)
                        isOpen = false
                    } label: {
                        HStack(spacing: AppDimension.Spacing.sm) {
                            Text(option.label)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if option.id == current?.id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(AppColor.accent)
                            }
                        }
                        .font(.system(
                            size: AppDimension.FontSize.body,
                            weight: option.id == current?.id ? .semibold : .regular,
                        ))
                        .foregroundStyle(
                            option.id == current?.id ? AppColor.text : AppColor.muted,
                        )
                        .padding(.horizontal, AppDimension.Select.optionPadding)
                        .frame(height: AppDimension.Select.optionHeight)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(option.id == current?.id ? [.isSelected] : [])
                }
            }
            .padding(AppDimension.Select.menuPadding)
            .frame(width: AppDimension.Select.menuWidth)
            .presentationCompactAdaptation(.popover)
            .presentationBackground(AppColor.card)
        }
    }
}
