//
//  CallDiagnostics.swift
//  prism
//
//  Path: Features/Call/CallDiagnostics.swift
//

import SwiftUI

/// 통화 아래 접이식 진단 — 시안 `Organism/Diagnostics` `Breakpoint=Mobile`.
///
/// **덮지 않고 민다**(plan/webrtc.md §4). 진단하려는 대상이 영상인데 그 위를 덮으면
/// 지표와 화면을 같이 볼 수 없다. 시트는 드래그 핸들·백드롭·스냅이 딸린 플랫폼 모양의
/// 새 컴포넌트라 iOS·Android에 각각 빚이 생긴다 — 접이식은 이미 세 번 만들어 본 모양이다.
///
/// 절 순서는 **Quality · Connection · Settings · Signaling**: 지금 어떤가 → 왜 그런가 →
/// 바꿔 본다 → 무슨 일이 있었나. 375에서는 네 절을 1열로 쌓고 라벨 위·값 아래로 접는다.
struct CallDiagnostics: View {
    @Environment(LocalizationStore.self) private var t

    let stats: CallStats?
    let connectedAt: Date?
    let isLoopback: Bool
    let log: [SignalLogEntry]
    let icePolicy: IcePolicy
    let cameras: [MediaDeviceOption]
    let microphones: [MediaDeviceOption]
    let cameraID: String?
    let microphoneID: String?
    let onClearLog: () -> Void
    let onIcePolicy: (IcePolicy) -> Void
    let onSelectCamera: (String) -> Void
    let onSelectMicrophone: (String) -> Void

    @State private var isOpen = false

    private var dash: String { t(.webrtcStatUnavailable) }
    /// 루프백은 소켓을 지나지 않으므로 경로가 후보 쌍이 아니라 **사실**로 정해진다.
    private var path: IcePath? { isLoopback ? .loopback : stats?.path }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(AppColor.border).frame(height: 1)
            header
            if isOpen {
                Rectangle().fill(AppColor.border).frame(height: 1)
                body(for: stats)
            }
        }
    }

    /// 접혀 있어도 **요약을 보여준다** — 아무 말도 안 하는 행은 열어 볼 이유를 화면이
    /// 주지 못한다. 아직 연결이 없으면 옛 수치가 아니라 `—`다. 375에서는 두 값만 둔다.
    private var header: some View {
        Button { isOpen.toggle() } label: {
            HStack(spacing: AppDimension.Spacing.sm) {
                // 셰브런은 **펴지는 방향**을 가리킨다(접혀 있으면 아래, 펴져 있으면 위).
                PrismGlyph.Chevron(up: isOpen)
                    .prismStroke(size: AppDimension.Dashboard.sessionIconGlyph)
                    .foregroundStyle(AppColor.heading)
                    .frame(
                        width: AppDimension.Dashboard.sessionIconGlyph,
                        height: AppDimension.Dashboard.sessionIconGlyph,
                    )
                Text(t(.webrtcDiagnostics))
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.heading)
                Spacer(minLength: AppDimension.Spacing.sm)
                Text(summary)
                    .font(.system(size: AppDimension.Call.fontCodeSmall, design: .monospaced))
                    .foregroundStyle(AppColor.muted)
            }
            .padding(.horizontal, AppDimension.Call.cardInset)
            .padding(.vertical, AppDimension.Call.diagHeadPadding)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(t(isOpen ? .webrtcDiagHide : .webrtcDiagShow))
    }

    private var summary: String {
        let rtt = stats?.rttMs.map { "\($0) ms" } ?? dash
        let route = path.map { t(Self.pathKey($0)) } ?? dash
        return "\(rtt) · \(route)"
    }

    private func body(for stats: CallStats?) -> some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.diagSectionSpacing) {
            quality(stats)
            connection(stats)
            divider
            settings
            divider
            signaling
        }
        .padding(.horizontal, AppDimension.Call.diagBodyInset)
        .padding(.vertical, AppDimension.Call.diagBodyPadding)
    }

    private var divider: some View {
        Rectangle().fill(AppColor.border).frame(height: 1)
    }

    // MARK: - Quality

    /// 여섯 지표. **없는 값은 0이 아니라 `—`다** — 없는 숫자를 0으로 그리면 화면이
    /// "패킷 손실 0%"라고 거짓말을 한다(§4).
    private func quality(_ stats: CallStats?) -> some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.diagRowSpacing) {
            sectionTitle(t(.webrtcDiagQuality))
            // 375에서 두 칸씩 — 한 줄에 셋을 두면 값이 잘린다.
            let columns = [
                GridItem(.flexible(), spacing: AppDimension.Call.diagRowSpacing),
                GridItem(.flexible(), spacing: AppDimension.Call.diagRowSpacing),
            ]
            LazyVGrid(columns: columns, spacing: AppDimension.Call.diagRowSpacing) {
                stat(t(.webrtcStatRtt), stats?.rttMs.map { "\($0) ms" })
                stat(t(.webrtcStatJitter), stats?.jitterMs.map { "\($0) ms" })
                stat(t(.webrtcStatPacketLoss), stats?.packetLossPct.map {
                    "\(Self.trim($0)) %"
                })
                stat(t(.webrtcStatSending), stats?.sendingKbps.map(Self.bitrate))
                stat(t(.webrtcStatReceiving), stats?.receivingKbps.map(Self.bitrate))
                stat(t(.webrtcStatVideo), stats?.video.map {
                    let fps = $0.fps.map { " · \($0)" } ?? ""
                    return "\($0.width)×\($0.height)\(fps)"
                })
            }
        }
    }

    /// 지표 한 칸 — 시안 `Molecule/Stat`. 라벨은 Manrope, **값은 모노**다(1자리↔3자리
    /// ms가 매초 바뀌므로 자리가 흔들리면 안 된다).
    private func stat(_ label: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.statLabelSpacing) {
            Text(label.uppercased())
                .font(.system(size: AppDimension.Call.fontCodeSmall))
                .foregroundStyle(AppColor.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(value ?? dash)
                .font(.system(size: AppDimension.FontSize.body, design: .monospaced))
                .foregroundStyle(AppColor.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, AppDimension.Call.statPaddingH)
        .padding(.vertical, AppDimension.Call.statPaddingV)
        .background(
            AppColor.secondaryBackground,
            in: .rect(cornerRadius: AppDimension.Radius.md),
        )
        // 라벨과 값이 따로 읽히면 "ROUND-TRIP TIME"과 "24 ms"가 남남이 된다.
        .accessibilityElement(children: .combine)
    }

    // MARK: - Connection

    private func connection(_ stats: CallStats?) -> some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.diagRowSpacing) {
            sectionTitle(t(.webrtcDiagConnection))

            VStack(alignment: .leading, spacing: AppDimension.Call.diagLabelSpacing) {
                rowLabel(t(.webrtcIcePath))
                if let path {
                    PrismBadge(title: t(Self.pathKey(path)), variant: Self.pathVariant(path))
                } else {
                    monoValue(dash)
                }
            }
            // 후보는 **타입·전송까지만**. 주소는 마스킹한다(§7).
            row(t(.webrtcIceLocal), Self.candidate(stats?.local, hidden: t(.webrtcIceAddressHidden)))
            row(t(.webrtcIceRemote), Self.candidate(stats?.remote, hidden: t(.webrtcIceAddressHidden)))
            row(t(.webrtcIceState), stats?.iceState)
            // DTLS 한 줄이 **미디어가 암호화됐다는 증거**다.
            row(t(.webrtcDtlsState), stats?.dtlsState)
            VStack(alignment: .leading, spacing: AppDimension.Call.diagLabelSpacing) {
                rowLabel(t(.webrtcConnectedFor))
                if let connectedAt {
                    ElapsedLabel(since: connectedAt)
                } else {
                    // 아직 붙지 않았으면 옛 수치가 아니라 `—`다.
                    monoValue(dash)
                }
            }
        }
    }

    private func row(_ label: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.diagLabelSpacing) {
            rowLabel(label)
            monoValue(value ?? dash)
        }
        .accessibilityElement(children: .combine)
    }

    private func rowLabel(_ label: String) -> some View {
        Text(label)
            .font(.system(size: AppDimension.FontSize.body))
            .foregroundStyle(AppColor.muted)
    }

    private func monoValue(_ value: String) -> some View {
        Text(value)
            .font(.system(size: AppDimension.Call.fontCodeSmall, design: .monospaced))
            .foregroundStyle(AppColor.text)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: AppDimension.FontSize.body))
            .foregroundStyle(AppColor.heading)
    }

    // MARK: - Connection settings

    /// **바꿀 수 있는 것은 두 가지뿐이다** — ICE 정책과 장치(§4). 나머지 KVS 설정은
    /// 전부 읽기 전용 값으로 바뀌었다.
    private var settings: some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.diagRowSpacing) {
            sectionTitle(t(.webrtcDiagSettings))

            VStack(alignment: .leading, spacing: AppDimension.Spacing.sm) {
                rowLabel(t(.webrtcIcePolicy))
                // `TURN only`는 TURN을 v1부터 넣기로 한 결정이 값을 하는지 **화면에서
                // 증명하는 유일한 스위치**다 — 누르면 `Path`가 즉시 Relayed로 바뀐다.
                radio(t(.webrtcIcePolicyAll), isOn: icePolicy == .all) { onIcePolicy(.all) }
                radio(t(.webrtcIcePolicyRelay), isOn: icePolicy == .relay) { onIcePolicy(.relay) }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(t(.webrtcIcePolicy))

            // 진단에서는 셀렉트 둘 위에 **합친 라벨 하나**를 얹는다 — 컨트롤이 제 라벨을
            // 그리던 시절에는 `카메라 · 마이크` 밑에 다시 `카메라`가 나왔다(시안 `Devices`).
            // 간격은 8: 라벨과 누를 수 있는 것 사이다(웹 `.diag__setting`).
            VStack(alignment: .leading, spacing: AppDimension.Spacing.sm) {
                rowLabel("\(t(.webrtcCamera)) · \(t(.webrtcMicrophone))")
                if !cameras.isEmpty {
                    CallDeviceSelect(
                        label: t(.webrtcCamera),
                        options: cameras,
                        selectedID: cameraID,
                        onSelect: onSelectCamera,
                    )
                }
                if !microphones.isEmpty {
                    CallDeviceSelect(
                        label: t(.webrtcMicrophone),
                        options: microphones,
                        selectedID: microphoneID,
                        onSelect: onSelectMicrophone,
                    )
                }
            }

            Text(t(.webrtcIcePolicyNote))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// 시안 `Atom/Radio` — 18 원. 줄 전체가 표적이다.
    private func radio(_ label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: AppDimension.Spacing.sm) {
                ZStack {
                    Circle()
                        .strokeBorder(isOn ? AppColor.primary : AppColor.border, lineWidth: 1)
                        .background(Circle().fill(AppColor.card))
                    if isOn {
                        Circle()
                            .fill(AppColor.primary)
                            .padding(AppDimension.Spacing.xs + 1)
                    }
                }
                .frame(width: AppDimension.Call.radioSize, height: AppDimension.Call.radioSize)
                Text(label)
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.text)
                Spacer(minLength: 0)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }

    // MARK: - Signaling

    /// 로그는 유일하게 계속 자라는 영역이라 맨 아래에 두고 **내부 스크롤**을 갖는다
    /// (모바일 160). 레벨이 아니라 **방향**(→ 보냄 / ← 받음)으로 가른다.
    private var signaling: some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.diagRowSpacing) {
            HStack(spacing: AppDimension.Spacing.xs) {
                sectionTitle(t(.webrtcDiagSignaling))
                Spacer(minLength: AppDimension.Spacing.sm)
                PrismButton(
                    title: t(.webrtcLogCopy),
                    variant: .ghost,
                    isEnabled: !log.isEmpty,
                    fillsWidth: false,
                ) {
                    // 사용자가 누를 때만 동작하고 **자동 전송은 없다**(§7).
                    UIPasteboard.general.string = SignalLog.format(log)
                }
                PrismButton(
                    title: t(.webrtcLogClear),
                    variant: .ghost,
                    isEnabled: !log.isEmpty,
                    fillsWidth: false,
                    action: onClearLog,
                )
            }

            Group {
                if log.isEmpty {
                    // 루프백은 시그널링을 타지 않으므로 **비어 있는 것이 정상이다**(§4).
                    Text(t(isLoopback ? .webrtcLogLoopback : .webrtcLogEmpty))
                        .font(.system(size: AppDimension.Call.fontCodeSmall))
                        .foregroundStyle(AppColor.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: AppDimension.Call.logLineSpacing) {
                            ForEach(log) { entry in
                                logLine(entry)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(AppDimension.Call.logPadding)
            .frame(height: AppDimension.Call.logHeight, alignment: .topLeading)
            .background(
                AppColor.secondaryBackground,
                in: .rect(cornerRadius: AppDimension.Radius.md),
            )
            .overlay {
                RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                    .stroke(AppColor.border, lineWidth: 1)
            }
        }
    }

    /// 시안 `Atom/LogLine` `Compact=Yes` — 375에서는 밀리초를 뺀다(초 단위로도 순서와
    /// 간격은 읽힌다). 열 너비를 고정하는 것이 요점이다: 값이 세로로 읽혀야 한다.
    private func logLine(_ entry: SignalLogEntry) -> some View {
        HStack(spacing: AppDimension.Call.logColumnSpacing) {
            Text(SignalLog.stamp(entry.atMs, compact: true))
                .foregroundStyle(AppColor.muted)
                .frame(width: AppDimension.Call.logStampWidth, alignment: .leading)
            Text(entry.direction == .sent ? "→" : "←")
                // 보낸 줄만 강조색이다 — 받은 줄까지 물들이면 방향이 색으로 읽히지 않는다.
                .foregroundStyle(entry.direction == .sent ? AppColor.accent : AppColor.muted)
                .frame(width: AppDimension.Call.logArrowWidth, alignment: .leading)
                .accessibilityLabel(t(entry.direction == .sent ? .webrtcLogSent : .webrtcLogReceived))
            Text(entry.type)
                // 색은 **오류 줄에만** 쓴다(§4).
                .foregroundStyle(entry.isError ? AppColor.error : AppColor.text)
                .frame(width: AppDimension.Call.logTypeWidth, alignment: .leading)
            Text(entry.detail ?? "")
                .foregroundStyle(AppColor.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(size: AppDimension.Call.fontCodeSmall, design: .monospaced))
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }

    // MARK: - 표

    static func pathKey(_ path: IcePath) -> MessageKey {
        switch path {
        case .direct: .webrtcIcePathDirect
        case .reflexive: .webrtcIcePathReflexive
        case .relay: .webrtcIcePathRelay
        case .loopback: .webrtcIcePathLoopback
        }
    }

    /// 릴레이는 **실패가 아니라 비싼 성공**이다 — 그래서 Error가 아니라 Warning이다(§4).
    static func pathVariant(_ path: IcePath) -> PrismBadge.Variant {
        switch path {
        case .direct: .success
        case .reflexive: .info
        case .relay: .warning
        case .loopback: .neutral
        }
    }

    // ── 값을 문자열로 바꾸는 것들 ──
    //
    // `nonisolated`인 이유: `View`를 따르는 타입이라 멤버가 기본으로 메인 액터에 묶이는데,
    // 이 셋은 인자만 보고 답하는 순수 함수라 묶여 있을 이유가 없다. 그리고 묶여 있으면
    // `map(Self.bitrate)`처럼 **함수 참조로 넘길 때** 경고가 난다 — 클로저 리터럴은 문맥에서
    // 격리를 물려받지만 함수 참조는 격리 없는 함수 타입으로 변환되기 때문이다.

    nonisolated private static func bitrate(_ kbps: Int) -> String {
        kbps >= 1_000
            ? String(format: "%.1f Mbps", Double(kbps) / 1_000)
            : "\(kbps) kbps"
    }

    /// 소수 첫째 자리까지만 — `0.1 %`처럼 시안의 자리수를 지킨다.
    nonisolated private static func trim(_ value: Double) -> String {
        value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value)
    }

    nonisolated private static func candidate(_ info: CandidateInfo?, hidden: String) -> String? {
        guard let info else { return nil }
        return [info.type, info.protocolName, hidden]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

/// 통화가 이어진 시간. **초 단위로만 센다** — 밀리초는 읽기 전에 바뀐다.
private struct ElapsedLabel: View {
    let since: Date

    var body: some View {
        // 1초마다 스스로 다시 그린다 — 타이머를 컨트롤러에 두면 통화 상태가 초마다
        // 바뀌는 셈이 되어 화면 전체가 다시 그려진다.
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let seconds = max(0, Int(context.date.timeIntervalSince(since)))
            Text(String(format: "%02d:%02d", seconds / 60, seconds % 60))
                .font(.system(size: AppDimension.Call.fontCodeSmall, design: .monospaced))
                .foregroundStyle(AppColor.text)
        }
    }
}
