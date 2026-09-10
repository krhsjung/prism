//
//  PushView.swift
//  prism
//
//  Path: Features/Push/PushView.swift
//

import SwiftUI

/// 푸시 화면 — 내 기기 목록에서 대상을 골라 **알림을 보내 본다**(plan/push.md §3).
///
/// 구조는 시안 `Push / Mobile / Send` 그대로다: 카드 하나에 머리(제목·설명) → 권한
/// 안내 → 본문(작성 → 기기 목록 → 보내기) → 바닥 한 줄. **기기 목록이 보내기 바로
/// 위에 온다** — 무엇을 보낼지 정한 다음 누구에게 보낼지를 고르는 순서이고, 웹도 좁은
/// 폭에서 같은 순서로 쌓인다(`.push__columns { flex-direction: column }`).
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
    private var current: SessionListItem? { items.first(where: \.isCurrent) }

    /// 토큰은 로그인 시점에만 세션에 실렸었다(§5-2). 그래서 권한을 나중에 줬거나 FCM이
    /// 토큰을 회전시키면, 권한은 켜져 있는데 세션은 알림을 못 받는 상태가 된다.
    /// 그 자리에서 바로 붙일 수 있게 **같은 켜기 버튼**을 다시 내놓는다.
    private var staleRegistration: Bool {
        guard permission == .granted, let current else { return false }
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
                pushCard
                    .padding(.horizontal, AppDimension.Dashboard.horizontalPadding)
                    .padding(.vertical, AppDimension.Dashboard.horizontalPadding)
            }
        }
        .task {
            permission = await pushTokens.permission()
            await load()
        }
    }

    // MARK: - 카드

    /// 카드 구조는 dashboard.md §4 규칙 그대로다 — 카드 `padding: 0`, 좌우 여백은 각
    /// 구획이 갖고, **구분선은 각 구획의 위**에 둔다.
    private var pushCard: some View {
        PrismCard(padding: 0, spacing: 0) {
            head
            permissionNotice
            cardBody
            foot
        }
    }

    /// 카드 폭을 가로지르는 1px 구분선.
    private var cardDivider: some View {
        Rectangle().fill(AppColor.border).frame(height: 1)
    }

    /// 화면이 무엇을 하는 곳인지 말한다 — 시안 `Head`. 여기 서는 것은 **페이지 제목**이고,
    /// 기기 목록의 제목은 목록 바로 위에 따로 선다(예전에는 이 자리를 목록이 차지했다).
    private var head: some View {
        VStack(alignment: .leading, spacing: AppDimension.Dashboard.headSpacing) {
            Text(t(.pushTitle))
                .font(.system(size: AppDimension.FontSize.sectionTitle, weight: .semibold))
                .foregroundStyle(AppColor.heading)
            Text(t(.pushDesc))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, AppDimension.Push.cardInset)
        .padding(.vertical, AppDimension.Push.headPadding)
    }

    /// 토큰이 어디에 사는지 말하는 한 줄(§5-3) — 목록 응답에 토큰이 실리지 않는 이유이기도
    /// 하다. 시안 `Foot`이고, 웹 `.push__foot`과 같은 자리다.
    private var foot: some View {
        VStack(spacing: 0) {
            cardDivider
            Text(t(.pushFoot))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, AppDimension.Push.cardInset)
                .padding(.vertical, AppDimension.Push.footPadding)
        }
    }

    // MARK: - 권한

    /// 안내는 **한 번에 하나만** 뜬다 — 권한의 세 상태가 서로 배타적이고, 등록 안내는
    /// `granted`일 때만 나온다. 그래서 카드에서도 구획 하나를 차지한다.
    @ViewBuilder
    private var permissionNotice: some View {
        switch permission {
        // 진입만으로 묻지 않는다 — 명시적 제스처 뒤에만 연다(plan/webrtc.md §7).
        case .askable:
            noticeSlot { allowBox(t(.pushAllowDesc), t(.pushAllow), action: allowNotifications) }
        // **막다른 길을 두지 않는다.** OS가 한 번 거부를 받으면 앱은 다시 물을 수 없다 —
        // 버튼을 세워 두면 눌러도 아무 일이 없어, 화면이 고장 난 것으로 읽힌다.
        // 할 수 있는 곳(설정)을 가리키는 것이 여기서 할 수 있는 전부다(§5-15).
        case .denied:
            noticeSlot { PrismInfoAlert(message: t(.pushAllowDenied)) }
        // 설정 파일 없이 빌드한 앱이다. **말은 해 준다** — 아무것도 안 그리면 목록의
        // `알림 꺼짐`이 왜 전부인지 알 길이 없다.
        case .unsupported:
            noticeSlot { PrismInfoAlert(message: t(.pushAllowUnsupported)) }
        case .granted:
            if staleRegistration {
                noticeSlot {
                    allowBox(t(.pushAllowDesc), t(.pushAllow), action: allowNotifications)
                }
            } else if current?.pushRegistered == true {
                // 켜져 있으면 **끄는 길**을 같은 자리에 둔다. 끄는 것은 등록이지 권한이
                // 아니므로 설명이 그렇게 말한다 — 못 지킬 약속을 하지 않게(§5-15).
                noticeSlot {
                    allowBox(
                        t(.pushAllowOffDesc),
                        t(.pushAllowOff),
                        action: turnOffNotifications,
                    )
                }
            }
        }
    }

    /// 안내가 앉는 자리 — 머리 아래, 본문 구분선 위(웹 `.push__notice`).
    private func noticeSlot(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .padding(.horizontal, AppDimension.Push.cardInset)
            .padding(.bottom, AppDimension.Push.bodySpacing)
    }

    /// 설명 한 줄과 버튼 하나가 든 테두리 상자(시안). 켜기와 끄기가 **같은 모양**을
    /// 쓴다 — 사용자가 할 일은 어느 쪽이든 버튼 하나라 컨트롤을 둘로 두지 않는다.
    private func allowBox(
        _ description: String,
        _ label: String,
        action: @escaping () async -> Void,
    ) -> some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
            Text(description)
                .font(.system(size: AppDimension.Call.fontCaption))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            PrismButton(
                title: label,
                variant: .outline,
                fillsWidth: false,
                action: { Task { await action() } },
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, AppDimension.Push.noticeHorizontalPadding)
        .padding(.vertical, AppDimension.Push.noticeVerticalPadding)
        .overlay {
            RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                .stroke(AppColor.border, lineWidth: 1)
        }
    }

    // MARK: - 본문

    /// 작성 → 기기 목록 → 보내기. **순서가 시안이다**(§4) — 무엇을 보낼지 정한 뒤에
    /// 누구에게 보낼지를 고른다.
    private var cardBody: some View {
        VStack(spacing: 0) {
            cardDivider
            VStack(alignment: .leading, spacing: AppDimension.Push.bodySpacing) {
                // 제목은 선택이다 — 비우면 서버가 받는 기기의 언어로 그린다(§5-14).
                // 알림에서 읽히는 순서가 제목 → 문구라 화면도 그 순서다.
                titleField
                messageField
                // 이미지·링크·버튼은 **셋 다 선택이다** — 없으면 문구만 있는
                // 알림이다(plan/push.md §5-11 ~ §5-13).
                imageField
                urlField(
                    label: .pushLinkLabel,
                    hint: .pushLinkHint,
                    placeholder: .pushLinkPlaceholder,
                    text: $link,
                )
                actionsField
                devicesField
                PrismButton(
                    title: t(.pushSend),
                    variant: .primary,
                    isEnabled: canSend,
                    action: { Task { await send() } },
                )
                resultNotice
            }
            .padding(AppDimension.Push.bodyPadding)
        }
    }

    /// 라벨 + (설명) + 내용. 본문의 모든 구획이 같은 뼈대를 쓴다.
    private func field(
        _ label: MessageKey,
        hint: MessageKey? = nil,
        @ViewBuilder content: () -> some View,
    ) -> some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
            Text(t(label))
                .font(.system(size: AppDimension.FontSize.body))
                .foregroundStyle(AppColor.text)
            if let hint {
                Text(t(hint))
                    .font(.system(size: AppDimension.Call.fontCaption))
                    .foregroundStyle(AppColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content()
        }
    }

    /// 입력 칸의 테두리 — 시안 `Atom/Input`.
    private func inputBox(_ content: some View) -> some View {
        content
            .textFieldStyle(.plain)
            .font(.system(size: AppDimension.FontSize.body))
            .padding(AppDimension.Call.rowHorizontalPadding)
            .background(AppColor.card)
            .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                    .stroke(AppColor.border, lineWidth: 1)
            }
    }

    private var titleField: some View {
        field(.pushTitleLabel) {
            inputBox(TextField(t(.pushTitlePlaceholder), text: $title))
                .onChange(of: title) { _, next in
                    // 상한은 계약이 정한다 — 서버도 같은 값으로 거부한다.
                    if next.count > MAX_PUSH_TITLE_LENGTH {
                        title = String(next.prefix(MAX_PUSH_TITLE_LENGTH))
                    }
                }
        }
    }

    private var messageField: some View {
        field(.pushMessageLabel) {
            inputBox(
                TextField(t(.pushMessagePlaceholder), text: $message, axis: .vertical)
                    .lineLimit(3...5),
            )
            .onChange(of: message) { _, next in
                // 서버도 같은 값으로 400을 낸다 — 입력에서 먼저 막아 왕복을 아낀다.
                if next.count > MAX_PUSH_MESSAGE_LENGTH {
                    message = String(next.prefix(MAX_PUSH_MESSAGE_LENGTH))
                }
            }
        }
    }

    /// 이미지는 주소 한 줄에 **샘플 칩**이 붙는다 — 리뷰어가 공개 이미지 주소를 따로
    /// 구해 오지 않아도 시연할 수 있어야 한다(§5-11).
    private var imageField: some View {
        field(.pushImageLabel, hint: .pushImageHint) {
            // **그리는 것은 결국 OS다.** 주소도 페이로드도 맞는데 데스크톱 브라우저로
            // 보내면 그림이 빠진다(§5-11). 보내는 쪽이 iPhone이어도 받는 쪽이 그럴 수
            // 있으므로 여기서도 말한다 — 화면이 먼저 말하지 않으면 배관이 깨진 것으로
            // 읽힌다(실제로 그렇게 읽혔다).
            Text(t(.pushImageDesktopNote))
                .font(.system(size: AppDimension.Call.fontCaption))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            samples
            inputBox(
                TextField(t(.pushImagePlaceholder), text: $imageUrl)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL),
            )
        }
    }

    private var samples: some View {
        HStack(spacing: AppDimension.Spacing.sm) {
            sampleChip(isOn: imageUrl.isEmpty) { imageUrl = "" } label: {
                Text(t(.pushImageNone))
                    .font(.system(size: AppDimension.Call.fontCaption))
                    .foregroundStyle(imageUrl.isEmpty ? AppColor.text : AppColor.muted)
                    .padding(.horizontal, AppDimension.Spacing.sm)
                    .frame(height: AppDimension.Push.sampleHeight)
            }
            ForEach(PushSampleImages.all) { sample in
                let url = PushSampleImages.url(sample)
                sampleChip(isOn: imageUrl == url) { imageUrl = url } label: {
                    LinearGradient(
                        colors: [sample.from, sample.to],
                        startPoint: .top,
                        endPoint: .bottom,
                    )
                    .frame(
                        width: AppDimension.Push.sampleWidth,
                        height: AppDimension.Push.sampleHeight,
                    )
                }
                .accessibilityLabel(sample.path)
            }
        }
    }

    /// 고른 칩만 테두리가 진해진다(웹 `.push__sample--on`).
    private func sampleChip(
        isOn: Bool,
        action: @escaping () -> Void,
        @ViewBuilder label: () -> some View,
    ) -> some View {
        Button(action: action) { label() }
            .buttonStyle(.plain)
            .clipShape(.rect(cornerRadius: AppDimension.Radius.sm))
            .overlay {
                RoundedRectangle(cornerRadius: AppDimension.Radius.sm)
                    .stroke(
                        isOn ? AppColor.primary : AppColor.border,
                        lineWidth: isOn
                            ? AppDimension.Push.sampleSelectedBorder
                            : 1,
                    )
            }
            .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }

    /// 주소 한 줄. 링크가 쓴다 — 이미지는 샘플 칩이 붙어 제 모양이 따로 있다.
    private func urlField(
        label: MessageKey,
        hint: MessageKey,
        placeholder: MessageKey,
        text: Binding<String>,
    ) -> some View {
        field(label, hint: hint) {
            inputBox(
                TextField(t(placeholder), text: text)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL),
            )
        }
    }

    /// 버튼 조합. **계약이 정한 셋뿐이다** — iOS가 미리 등록한 카테고리만 쓸 수 있어
    /// 임의 목록을 보낼 방법이 없다(plan/push.md §5-13).
    private var actionsField: some View {
        field(.pushActionsLabel) {
            HStack(spacing: AppDimension.Spacing.sm) {
                ForEach(PushActionSet.allCases, id: \.self) { set in
                    PrismButton(
                        title: t(actionsKey(set)),
                        variant: actions == set ? .secondary : .outline,
                        fillsWidth: false,
                        action: { actions = set },
                    )
                    .accessibilityAddTraits(actions == set ? [.isSelected] : [])
                }
            }
        }
    }

    // MARK: - 기기 목록

    /// 목록 머리는 **고른 수를 말하고 한 번에 바꾼다** — 기기가 여럿일 때 줄마다
    /// 누르는 것이 유일한 길이면 손이 많이 간다.
    private var devicesField: some View {
        VStack(alignment: .leading, spacing: AppDimension.Call.fieldSpacing) {
            HStack {
                Text(t(.pushDevices))
                    .font(.system(size: AppDimension.FontSize.body))
                    .foregroundStyle(AppColor.text)
                Spacer(minLength: AppDimension.Spacing.sm)
                if registered.count > 1 {
                    Text(t(.pushSelectedCount, ["count": String(targetIds.count)]))
                        .font(.system(size: AppDimension.Call.fontCaption))
                        .foregroundStyle(AppColor.muted)
                    PrismButton(
                        title: t(
                            targetIds.count == registered.count
                                ? .pushClearAll
                                : .pushSelectAll,
                        ),
                        variant: .ghost,
                        fillsWidth: false,
                        action: {
                            targetIds = targetIds.count == registered.count
                                ? []
                                : registered.prefix(MAX_PUSH_TARGETS).map(\.id)
                        },
                    )
                }
            }
            // 어느 줄이 왜 흐린지는 **목록 옆에서** 말한다 — 카드 머리에 두면 목록까지
            // 눈이 한 번 더 왕복한다(시안 Devices).
            Text(t(.pushDevicesDesc))
                .font(.system(size: AppDimension.Call.fontCaption))
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            deviceList
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

    @ViewBuilder
    private var resultNotice: some View {
        if failed {
            PrismErrorAlert(message: t(.errorGeneric))
        }
    }

    // MARK: - 동작

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
                    actions: actions,
                ),
                to: targetIds,
                accessToken: token,
            )
            results = Dictionary(
                uniqueKeysWithValues: outcomes.map { ($0.sessionId, $0.result) },
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
