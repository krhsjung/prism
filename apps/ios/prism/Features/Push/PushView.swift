//
//  PushView.swift
//  prism
//
//  Path: Features/Push/PushView.swift
//

import SwiftUI

/// 푸시 화면 — 내 기기 목록에서 대상을 골라 **알림을 보내 본다**(plan/push.md §3).
///
/// 목록은 대시보드·통화 로비와 같은 데이터·같은 부품이다(§4). 다른 것은 할 수 있는
/// 일뿐이다 — 여기서는 **현재 세션도 대상**이라, 기기가 하나뿐인 리뷰어도 알림이 실제로
/// 뜨는 것을 확인할 수 있다(통화의 루프백과 같은 자리).
struct PushView: View {
    @Environment(LocalizationStore.self) private var t

    let user: User
    let sessions: SessionsServicing
    let push: PushServicing
    let pushTokens: PushTokens
    let accessToken: () -> String?
    let onNavigate: (ShellPage) -> Void
    let onSignOut: () async -> Void

    @State private var items: [SessionListItem] = []
    /// 고른 대상들. **여럿 고를 수 있다**(plan/push.md §5-10).
    @State private var targetIds: [String] = []
    @State private var title = ""
    @State private var message = ""
    @State private var imageUrl = ""
    @State private var link = ""
    @State private var actions: PushActionSet = .none
    @State private var sending = false
    /// 대상별 결말. 화면이 **고른 줄 옆에** 그린다.
    @State private var results: [String: PushSendResult] = [:]
    @State private var failed = false
    @State private var permission: PushPermission = .unsupported

    private var registered: [SessionListItem] { items.filter(\.pushRegistered) }

    /// 토큰은 **로그인 시점에만** 세션에 실린다(§5-2). 그래서 권한을 나중에 줬거나 FCM이
    /// 토큰을 회전시키면, 권한은 켜져 있는데 세션은 알림을 못 받는 상태가 된다.
    /// 화면이 그 사실을 말하고 할 일을 알려 준다 — 새 경로를 만들지 않는다.
    private var staleRegistration: Bool {
        guard permission == .granted, let current = items.first(where: \.isCurrent) else {
            return false
        }
        return !current.pushRegistered
    }

    private func toggle(_ id: String) {
        if let index = targetIds.firstIndex(of: id) {
            targetIds.remove(at: index)
        } else if targetIds.count < MAX_PUSH_TARGETS {
            // 서버도 같은 상한으로 400을 낸다 — 여기서 먼저 막아 왕복을 아낀다.
            targetIds.append(id)
        }
    }

    private var canSend: Bool {
        !targetIds.isEmpty
            && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !sending
    }

    var body: some View {
        AppShellView(page: .push, user: user, onNavigate: onNavigate, onSignOut: onSignOut) {
            ScrollView {
                VStack(alignment: .leading, spacing: AppDimension.Card.spacing) {
                    header
                    permissionNotice
                    deviceList
                    // 제목은 선택이다 — 비우면 서버가 받는 기기의 언어로 그린다(§5-14).
                    titleField
                    messageField
                    // 이미지·링크·버튼은 **셋 다 선택이다** — 없으면 문구만 있는
                    // 알림이다(plan/push.md §5-11 ~ §5-13).
                    urlField(
                        label: .pushImageLabel,
                        hint: .pushImageHint,
                        placeholder: .pushImagePlaceholder,
                        text: $imageUrl
                    )
                    urlField(
                        label: .pushLinkLabel,
                        hint: .pushLinkHint,
                        placeholder: .pushLinkPlaceholder,
                        text: $link
                    )
                    actionsField
                    PrismButton(
                        title: t(.pushSend),
                        variant: .primary,
                        isEnabled: canSend,
                        action: { Task { await send() } },
                    )
                    resultNotice
                }
                .padding(AppDimension.Card.padding)
            }
        }
        .task {
            permission = await pushTokens.permission()
            await load()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: AppDimension.Dashboard.headSpacing) {
            // 목록 머리는 **고른 수를 말하고 한 번에 바꾼다** — 기기가 여럿일 때
            // 줄마다 누르는 것이 유일한 길이면 손이 많이 간다.
            HStack {
                Text(t(.pushDevices))
                    .font(.system(size: AppDimension.Call.fontRowTitle))
                    .foregroundStyle(AppColor.heading)
                Spacer(minLength: AppDimension.Spacing.sm)
                if registered.count > 1 {
                    Text(t(.pushSelectedCount, ["count": String(targetIds.count)]))
                        .font(.system(size: AppDimension.Call.fontCaption))
                        .foregroundStyle(AppColor.muted)
                    PrismButton(
                        title: t(
                            targetIds.count == registered.count
                                ? .pushClearAll
                                : .pushSelectAll
                        ),
                        variant: .ghost,
                        fillsWidth: false,
                        action: {
                            targetIds = targetIds.count == registered.count
                                ? []
                                : registered.prefix(MAX_PUSH_TARGETS).map(\.id)
                        }
                    )
                }
            }
            Text(t(.pushDevicesDesc))
                .font(.system(size: AppDimension.Call.fontCaption))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// 권한을 묻고 등록까지 하는 줄. 두 갈래(안 물음·물었지만 등록 전)가 같은 것을 쓴다 —
    /// 사용자가 할 일은 어느 쪽이든 "켜기" 하나뿐이라 컨트롤을 둘로 두지 않는다.
    private var allowRow: some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
            Text(t(.pushAllowDesc))
                .font(.system(size: AppDimension.Call.fontCaption))
                .foregroundStyle(AppColor.muted)
            PrismButton(
                title: t(.pushAllow),
                variant: .outline,
                fillsWidth: false,
                action: { Task { await allowNotifications() } },
            )
        }
    }

    @ViewBuilder
    private var permissionNotice: some View {
        switch permission {
        case .askable:
            // 진입만으로 묻지 않는다 — 명시적 제스처 뒤에만 연다(plan/webrtc.md §7).
            allowRow
        case .denied:
            note(t(.pushAllowDenied))
        case .unsupported:
            EmptyView()
        // 권한은 켜졌는데 이 세션이 등록 전이면 **여기서 바로 붙일 수 있다**
        // (§5-2를 뒤집었다) — 안내가 아니라 같은 켜기 버튼을 다시 내놓는다.
        case .granted:
            if staleRegistration {
                allowRow
            } else if items.first(where: \.isCurrent)?.pushRegistered == true {
                // 켜져 있으면 **끄는 길**을 같은 자리에 둔다. 끄는 것은 등록이지 권한이
                // 아니므로 설명이 그렇게 말한다 — 못 지킬 약속을 하지 않게(§5-15).
                VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
                    Text(t(.pushAllowOffDesc))
                        .font(.system(size: AppDimension.Call.fontCaption))
                        .foregroundStyle(AppColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    PrismButton(
                        title: t(.pushAllowOff),
                        variant: .outline,
                        fillsWidth: false,
                        action: { Task { await turnOffNotifications() } },
                    )
                }
            }
        }
    }

    private var deviceList: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, session in
                if index > 0 {
                    Rectangle().fill(AppColor.border).frame(height: 1)
                }
                let checked = targetIds.contains(session.id)
                let result = results[session.id]
                DeviceRowView(
                    device: session.device,
                    title: t(DashboardView.deviceLabel(session.device)),
                    // 결과는 **고른 줄 옆에** 그린다 — 목록 밖에서 다시 짝지어 읽게
                    // 하지 않는다(plan/push.md §5-10).
                    subtitle: result.map { t(resultKey($0)) } ?? "#\(session.id.prefix(8))",
                    isMuted: !session.pushRegistered,
                ) {
                    if session.pushRegistered {
                        // 여럿 고를 수 있다는 것을 컨트롤의 모양이 먼저 말한다 —
                        // 버튼이었다면 하나만 고르는 것으로 읽힌다.
                        Toggle(isOn: Binding(
                            get: { checked },
                            set: { _ in toggle(session.id) },
                        )) {
                            Text(t(checked ? .pushSelected : .pushSelect))
                                .font(.system(size: AppDimension.Call.fontCaption))
                                .foregroundStyle(AppColor.text)
                        }
                        .toggleStyle(.automatic)
                        .fixedSize()
                    } else {
                        // 누를 수 없는 컨트롤을 두지 않는다 — 배지가 이유를 말한다(§4).
                        PrismBadge(title: t(.webrtcNotificationsOff), variant: .neutral)
                    }
                }
            }
        }
        .padding(.vertical, AppDimension.Call.listVerticalPadding)
        .background(AppColor.card)
        .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                .stroke(AppColor.border, lineWidth: 1)
        }
    }

    private var titleField: some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
            Text(t(.pushTitleLabel))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.text)
            TextField(t(.pushTitlePlaceholder), text: $title)
                .textFieldStyle(.plain)
                .font(.system(size: AppDimension.FontSize.body))
                .padding(AppDimension.Call.rowHorizontalPadding)
                .background(AppColor.card)
                .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
                .overlay {
                    RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                        .stroke(AppColor.border, lineWidth: 1)
                }
                .onChange(of: title) { _, next in
                    // 상한은 계약이 정한다 — 서버도 같은 값으로 거부한다.
                    if next.count > MAX_PUSH_TITLE_LENGTH {
                        title = String(next.prefix(MAX_PUSH_TITLE_LENGTH))
                    }
                }
        }
    }

    private var messageField: some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
            Text(t(.pushMessageLabel))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.text)
            TextField(t(.pushMessagePlaceholder), text: $message, axis: .vertical)
                .lineLimit(3...5)
                .textFieldStyle(.plain)
                .font(.system(size: AppDimension.FontSize.body))
                .padding(AppDimension.Call.rowHorizontalPadding)
                .background(AppColor.card)
                .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
                .overlay {
                    RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                        .stroke(AppColor.border, lineWidth: 1)
                }
                .onChange(of: message) { _, next in
                    // 서버도 같은 값으로 400을 낸다 — 입력에서 먼저 막아 왕복을 아낀다.
                    if next.count > MAX_PUSH_MESSAGE_LENGTH {
                        message = String(next.prefix(MAX_PUSH_MESSAGE_LENGTH))
                    }
                }
        }
    }

    /// 주소 한 줄. 이미지와 링크가 **같은 모양**을 쓴다 — 하는 일이 같기 때문이다.
    private func urlField(
        label: MessageKey,
        hint: MessageKey,
        placeholder: MessageKey,
        text: Binding<String>
    ) -> some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
            Text(t(label))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.text)
            Text(t(hint))
                .font(.system(size: AppDimension.Call.fontCaption))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            TextField(t(placeholder), text: text)
                .textFieldStyle(.plain)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .font(.system(size: AppDimension.FontSize.body))
                .padding(AppDimension.Call.rowHorizontalPadding)
                .background(AppColor.card)
                .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
                .overlay {
                    RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                        .stroke(AppColor.border, lineWidth: 1)
                }
        }
    }

    /// 버튼 조합. **계약이 정한 셋뿐이다** — iOS가 미리 등록한 카테고리만 쓸 수 있어
    /// 임의 목록을 보낼 방법이 없다(plan/push.md §5-13).
    private var actionsField: some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
            Text(t(.pushActionsLabel))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.text)
            HStack(spacing: AppDimension.Spacing.sm) {
                ForEach(PushActionSet.allCases, id: \.self) { set in
                    PrismButton(
                        title: t(actionsKey(set)),
                        variant: actions == set ? .secondary : .outline,
                        fillsWidth: false,
                        action: { actions = set }
                    )
                    .accessibilityAddTraits(actions == set ? [.isSelected] : [])
                }
            }
        }
    }

    @ViewBuilder
    private var resultNotice: some View {
        if failed {
            Text(t(.errorGeneric))
                .font(.system(size: AppDimension.Call.fontCaption))
                .foregroundStyle(AppColor.error)
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.system(size: AppDimension.Call.fontCaption))
            .foregroundStyle(AppColor.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// **권한과 등록을 함께 끝낸다.** 예전에는 토큰이 로그인 요청에만 실려서, 여기서
    /// 권한을 켜도 그 세션은 재로그인 전까지 대상이 아니었다(§5-2를 뒤집었다).
    private func allowNotifications() async {
        var token = await pushTokens.requestPermissionAndToken()
        // 이미 허용돼 있으면 위가 nil일 수 있다 — 그때는 지금 토큰을 그대로 쓴다.
        if token == nil { token = await pushTokens.current() }
        permission = await pushTokens.permission()
        guard let token, let access = accessToken() else { return }
        // 실패해도 화면은 사실을 말한다 — 그 줄이 `Notifications off`로 남는다.
        _ = try? await push.register(token: token, accessToken: access)
        // 선택을 기기에 남긴다 — 다음 로그인에서 이 값을 보고 조용히 다시 붙는다(§5-16).
        pushTokens.rememberWanted(true)
        await load(background: true)
    }

    /// **끄는 것은 등록이지 권한이 아니다** — 브라우저·OS는 앱이 권한을 되돌리는 길을
    /// 주지 않는다. 기기의 토큰은 그대로 두므로 다시 켤 때 권한 창이 뜨지 않는다(§5-15).
    private func turnOffNotifications() async {
        guard let access = accessToken() else { return }
        try? await push.unregister(accessToken: access)
        pushTokens.rememberWanted(false)
        await load(background: true)
    }

    private func load(background: Bool = false) async {
        guard let token = accessToken() else { return }
        guard let list = try? await sessions.sessions(accessToken: token, background: background)
        else { return }
        items = list
        // 대상이 사라졌으면(폐기·만료) 고른 것을 놓는다 — 없는 세션에 보내면 404다.
        // 사라진 대상은 골라 둔 목록에서도 놓는다.
        targetIds = targetIds.filter { id in list.contains { $0.id == id } }
    }

    private func send() async {
        guard let token = accessToken(), canSend else { return }
        sending = true
        results = [:]
        failed = false
        do {
            let outcomes = try await push.send(
                PushContent(
                    message: message.trimmingCharacters(in: .whitespacesAndNewlines),
                    title: title,
                    imageUrl: imageUrl,
                    link: link,
                    actions: actions
                ),
                to: targetIds,
                accessToken: token
            )
            results = Dictionary(
                uniqueKeysWithValues: outcomes.map { ($0.sessionId, $0.result) }
            )
            // 목록의 `pushRegistered`가 낡았을 수 있다(그 기기가 방금 로그아웃했다).
            if outcomes.contains(where: { $0.result != .accepted }) {
                await load(background: true)
            }
        } catch {
            // 400(형식)·502(FCM이 안 됨) 모두 사용자가 할 일은 같다.
            failed = true
        }
        sending = false
    }

    // FCM이 알려 주는 것은 "받아들였다"까지다 — 화면이 그 이상을 말하지 않는다(§7).
    private func resultKey(_ result: PushSendResult) -> MessageKey {
        switch result {
        case .accepted: .pushResultAccepted
        case .noToken: .pushResultNoToken
        case .rejected: .pushResultRejected
        case .duplicate: .pushResultDuplicate
        case .unknown: .pushResultUnknown
        }
    }

    private func actionsKey(_ set: PushActionSet) -> MessageKey {
        switch set {
        case .none: .pushActionsNone
        case .open: .pushActionsOpen
        case .openDismiss: .pushActionsOpenDismiss
        }
    }
}
