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
    @Environment(\.scenePhase) private var scenePhase

    let user: User
    /// 목록 하나. 대시보드·통화 로비가 보는 것과 **같은 것**이다 — 조회와 소켓 신호는
    /// `RootView`가 세션 전체를 대신해 한 자리에서 챙긴다.
    let store: SessionStore
    let push: PushServicing
    let pushTokens: PushTokens
    /// 등록의 수명을 쥔 자리. 되살리기·권한이 사라졌을 때의 해제·토큰 회전은 그쪽 일이고,
    /// 이 화면은 켜기·끄기를 시키고 권한 갈래를 그릴 뿐이다(`PushRegistration`).
    let registration: PushRegistration
    let accessToken: () -> String?
    let onNavigate: (ShellPage) -> Void
    let onSignOut: () async -> Void

    /// 고른 대상들. **여럿 고를 수 있다**(plan/push.md §5-10).
    ///
    /// 사라진 대상은 **지우지 않고 걸러서 읽는다**(`targetIds`) — 목록은 이제 이 화면
    /// 밖에서도 바뀌고(소켓 신호·다른 화면의 해제), 그때마다 골라 둔 것을 고쳐 쓰면
    /// 목록이 잠깐 비는 순간에 선택이 통째로 날아간다.
    @State private var selectedIds: [String] = []
    @State private var title = ""
    @State private var message = ""
    @State private var imageUrl = ""
    @State private var link = ""
    @State private var actions: PushActionSet = .none
    @State private var sending = false
    /// 대상별 결말. 화면이 **고른 줄 옆에** 그린다.
    @State private var results: [String: PushSendResult] = [:]
    @State private var failed = false
    /// 이 기기의 알림 상태. **`nil`은 "아직 안 봤다"**이고 어떤 갈래도 아니다.
    ///
    /// 처음 값을 `.unsupported`로 두었더니, 화면이 확인하기 **전에** "여기서는 알림을
    /// 받을 수 없습니다"를 그렸다 — 그 갈래가 아무것도 안 그리던 동안에는 안 보이던
    /// 버그였고, 안내를 세우자 바로 드러났다. 모르는 것과 아는 것을 같은 값으로 두면
    /// 화면이 모르는 채로 단정한다.
    @State private var permission: PushPermission?

    /// 목록. 아직 못 받아 봤으면 빈 목록으로 그린다 — 이 화면에는 "불러오는 중" 갈래가
    /// 따로 없다(대시보드가 그 상태를 말하는 화면이다).
    private var items: [SessionListItem] { store.sessions ?? [] }
    /// 고른 것 중 **지금 보낼 수 있는 것**. 사라진 세션도, 방금 알림을 끈 세션도 빠진다.
    ///
    /// 후자를 빼지 않으면 그 줄의 체크박스는 사라지는데 전송 목록에는 남아 **보이는
    /// 선택과 보내는 선택이 어긋난다** — 고른 것이 그것 하나뿐이면 끌 길도 없다.
    private var targetIds: [String] {
        selectedIds.filter { id in items.contains { $0.id == id && $0.pushRegistered } }
    }
    private var registered: [SessionListItem] { items.filter(\.pushRegistered) }
    /// 모두 선택은 **상한까지**다 — 등록 기기가 상한보다 많으면 "모두"는 처음 상한만큼이고, 그만큼
    /// 골랐으면 해제로 바뀐다. 전체 수와 견주면 21대부터 버튼이 영영 "모두 선택"으로 남는다.
    private var allSelected: Bool {
        targetIds.count >= min(registered.count, MAX_PUSH_TARGETS)
    }
    private var current: SessionListItem? { items.first(where: \.isCurrent) }

    /// 권한은 켜져 있는데 이 세션이 아직 등록 전이다(끈 뒤 · 서버가 죽은 토큰을 뗀 뒤 ·
    /// 되살리기가 아직 안 끝난 사이). 그 자리에서 바로 붙일 수 있게 **같은 켜기 버튼**을
    /// 다시 내놓는다(§5-2를 뒤집었다).
    private var staleRegistration: Bool {
        guard permission == .granted, let current else { return false }
        return !current.pushRegistered
    }

    private func toggle(_ id: String) {
        // 사람이 고치는 순간에는 사라진 줄을 걷어낸다 — 걸러서 읽기만 하면(`targetIds`)
        // 숨은 옛 선택이 뒤에 돌아와 상한을 넘긴다(20개 고름 → 하나 빠짐 → 하나 더 고름 →
        // 빠진 것이 돌아옴 = 21개). 걷어내면 돌아와도 고른 것이 아니다.
        let live = targetIds
        if live.contains(id) {
            selectedIds = live.filter { $0 != id }
        } else if live.count < MAX_PUSH_TARGETS {
            // 서버도 같은 상한으로 400을 낸다 — 여기서 먼저 막아 왕복을 아낀다.
            selectedIds = live + [id]
        } else {
            selectedIds = live
        }
    }

    /// 사람이 적은 것의 UTF-8 바이트 합이 상한을 넘는가 — 필드마다는 상한 안이어도 합이 FCM의
    /// 4 KB를 넘길 수 있고, 그 요청은 서버가 400으로 접는다. 화면이 먼저 막고 이유를 말한다.
    private var tooLong: Bool {
        [message, title, imageUrl, link]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).utf8.count }
            .reduce(0, +) > MAX_PUSH_CONTENT_BYTES
    }

    private var canSend: Bool {
        !targetIds.isEmpty
            // 걷어내기 전의 옛 선택이 돌아와 상한을 넘겼을 수 있다 — 보내면 400이다.
            && targetIds.count <= MAX_PUSH_TARGETS
            && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !sending
            && !tooLong
    }

    var body: some View {
        AppShellView(page: .push, user: user, onNavigate: onNavigate, onSignOut: onSignOut) {
            ScrollView {
                pushCard
                    .padding(.horizontal, AppDimension.Dashboard.horizontalPadding)
                    .padding(.vertical, AppDimension.Dashboard.horizontalPadding)
            }
        }
        // 목록은 받아 오지 않는다 — 세션이 시작될 때 `RootView`가 한 번 받고, 그 뒤로는
        // 소켓 신호가 올 때마다 같은 자리에서 새로 받는다. 이 화면이 따로 듣지 않아
        // **다른 기기의 변화가 여기만 늦게 도착하던 것**이 그 규칙을 옮겨 적지 않은 탓이다.
        .task { await readPermission() }
        // **설정을 다녀오면 다시 읽는다.** 사람은 이 화면 밖에서 권한을 끌 수 있는데,
        // `.task`는 화면이 다시 나타날 때만 돌아 포그라운드 복귀로는 돌지 않는다 —
        // 그러면 화면은 계속 "받는다"고 말하고, 다른 기기의 로비는 이 기기를
        // `Will notify`로 그린다. 없는 사실을 지어내지 않는다는 §5-17의 자리다.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await readPermission() }
        }
    }

    // MARK: - 카드

    /// 카드 구조는 dashboard.md §4 규칙 그대로다 — 카드 `padding: 0`, 좌우 여백은 각
    /// 구획이 갖고, **구분선은 각 구획의 위**에 둔다.
    private var pushCard: some View {
        PrismCard(padding: 0, spacing: 0) {
            head
            permissionNotice
            turnOffBox
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

    /// 안내는 **권한에 대해** 한 번에 하나만 뜬다 — 권한의 세 상태가 서로 배타적이다.
    ///
    /// ⚠️ **끄기는 그 갈래에 속하지 않는다.** 끄는 것은 등록이지 권한이 아니므로(§5-15)
    /// 등록돼 있으면 권한이 어떻든 끌 수 있어야 한다. 예전에는 `denied`가 끄기를 가려서,
    /// 설정에서 권한을 끈 사람은 **남아 있는 등록을 지울 길이 화면에 없었다** — 서버는
    /// 계속 이 기기를 푸시 대상으로 들고 있는데도. 그래서 아래 `turnOffBox`로 갈라 뒀다.
    @ViewBuilder
    private var permissionNotice: some View {
        switch permission {
        // 아직 안 봤다 — 볼 때까지는 자리를 비운다.
        case nil:
            EmptyView()
        // 진입만으로 묻지 않는다 — 명시적 제스처 뒤에만 연다(plan/webrtc.md §7).
        case .askable:
            noticeSlot { allowBox(t(.pushAllowDesc), t(.pushAllow), action: allowNotifications) }
        // **막다른 길을 두지 않는다.** OS가 한 번 거부를 받으면 앱은 다시 물을 수 없으니
        // `켜기`를 세우면 눌러도 아무 일이 없다 — 대신 **할 수 있는 곳으로 데려간다**.
        // 돌아오면 `scenePhase`가 권한을 다시 읽어 그 자리에서 `켜기`로 바뀐다(§5-19).
        case .denied:
            noticeSlot {
                allowBox(
                    t(.pushAllowDenied),
                    t(.pushAllowOpenSettings),
                    action: openSettings,
                )
            }
        // 설정 파일 없이 빌드한 앱이다. **말은 해 준다** — 아무것도 안 그리면 목록의
        // `알림 꺼짐`이 왜 전부인지 알 길이 없다.
        case .unsupported:
            noticeSlot { PrismInfoAlert(message: t(.pushAllowUnsupported)) }
        case .granted:
            if staleRegistration {
                noticeSlot {
                    allowBox(t(.pushAllowDesc), t(.pushAllow), action: allowNotifications)
                }
            }
        }
    }

    /// 끄는 길은 **등록돼 있으면 언제나** 같은 자리에 선다. 설명이 "권한은 그대로"라고
    /// 말하므로 못 지킬 약속도 아니다(§5-15).
    @ViewBuilder
    private var turnOffBox: some View {
        if current?.pushRegistered == true {
            noticeSlot {
                allowBox(
                    t(.pushAllowOffDesc),
                    t(.pushAllowOff),
                    action: turnOffNotifications,
                )
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
                if tooLong {
                    Text(t(.pushContentTooLong))
                        .font(.system(size: AppDimension.FontSize.body))
                        .foregroundStyle(AppColor.muted)
                }
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

    private var titleField: some View {
        field(.pushTitleLabel) {
            PrismTextField(placeholder: t(.pushTitlePlaceholder), text: $title)
                .onChange(of: title) { _, next in
                    // 상한은 계약이 정한다 — 서버도 같은 값으로 거부한다.
                    // 상한은 **UTF-16 단위**다(계약) — 서버·웹·Android가 그 단위로 세므로
                    // 글자 수(`count`)로 재면 이모지가 섞인 제목이 여기서는 통과하고 서버에서 400이다.
                    if next.utf16.count > MAX_PUSH_TITLE_LENGTH {
                        title = next.clippedToUTF16(MAX_PUSH_TITLE_LENGTH)
                    }
                }
        }
    }

    private var messageField: some View {
        field(.pushMessageLabel) {
            PrismTextField(placeholder: t(.pushMessagePlaceholder), text: $message, axis: .vertical)
                .lineLimit(3...5)
            .onChange(of: message) { _, next in
                // 서버도 같은 값으로 400을 낸다 — 입력에서 먼저 막아 왕복을 아낀다.
                if next.utf16.count > MAX_PUSH_MESSAGE_LENGTH {
                    message = next.clippedToUTF16(MAX_PUSH_MESSAGE_LENGTH)
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
            PrismTextField(placeholder: t(.pushImagePlaceholder), text: $imageUrl)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
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
            PrismTextField(placeholder: t(placeholder), text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
        }
    }

    /// 버튼 조합. **계약이 정한 셋뿐이다** — iOS가 미리 등록한 카테고리만 쓸 수 있어
    /// 임의 목록을 보낼 방법이 없다(plan/push.md §5-13).
    private var actionsField: some View {
        // 어디에 보이는지는 **받는 기기**가 정한다 — 접힌 알림에는 안 뜨는 기기가 있어,
        // 안내가 없으면 기능이 고장 난 것으로 읽힌다(§5-13). 이미지의
        // `image_desktop_note`와 같은 자리·같은 규칙이다.
        field(.pushActionsLabel, hint: .pushActionsHint) {
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
                            allSelected
                                ? .pushClearAll
                                : .pushSelectAll,
                        ),
                        variant: .ghost,
                        fillsWidth: false,
                        action: {
                            selectedIds = allSelected
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
                        .toggleStyle(.prismCheckbox)
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

    /// 이 앱의 알림 설정을 연다.
    ///
    /// **`unsupported`에는 두지 않는다.** 그쪽은 권한이 아니라 설정 파일이 없는 빌드라
    /// 설정으로 고칠 수 있는 것이 없다 — 버튼을 세우면 그것이 곧 가짜 컨트롤이다(§5-19).
    private func openSettings() async {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        await UIApplication.shared.open(url)
    }

    /// 권한을 읽는다 — 화면이 그릴 갈래다. 서버에 반영하는 일(받을 수 없게 됐으면 떼기)은
    /// 이 화면이 아니라 `PushRegistration`이 앱이 앞으로 올 때마다 한다.
    private func readPermission() async {
        permission = await pushTokens.permission()
    }

    /// **권한과 등록을 함께 끝낸다.** 예전에는 토큰이 로그인 요청에만 실려서, 여기서
    /// 권한을 켜도 그 세션은 재로그인 전까지 대상이 아니었다(§5-2를 뒤집었다).
    ///
    /// 권한 창은 **여기서** 연다 — 명시적 제스처 뒤에만 뜨는 것이라 화면의 일이다. 붙이고
    /// 선택을 기억하는 일은 코디네이터가 한다(되살리기와 한 줄에 선다).
    private func allowNotifications() async {
        // 권한만 묻는다 — 토큰은 코디네이터의 줄 안에서 받아 붙인다(주인이 둘이면 안 된다).
        _ = await pushTokens.requestPermission()
        permission = await pushTokens.permission()
        _ = await registration.enable()
    }

    /// **끄는 것은 등록이지 권한이 아니다** — 브라우저·OS는 앱이 권한을 되돌리는 길을
    /// 주지 않는다. 기기의 토큰은 그대로 두므로 다시 켤 때 권한 창이 뜨지 않는다(§5-15).
    private func turnOffNotifications() async {
        _ = await registration.disable()
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
                await store.refresh(background: true)
            }
            // 거부된 토큰은 **서버가 그 세션에서 뗐다** — 그 줄은 이제 `Notifications off`이고,
            // 다른 기기의 목록·로비도 그것을 알아야 한다(스윕은 이 변화를 못 잡는다).
            if outcomes.contains(where: { $0.result == .rejected }) {
                store.notifyChanged()
            }
        } catch {
            // 400(형식)·502(이 배포에 전송기가 없다) 모두 사용자가 할 일은 같다.
            // FCM의 일시적 실패는 여기로 오지 않는다 — 그 줄의 `failed`다.
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
        case .failed: .pushResultFailed
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

private extension String {
    /// UTF-16 단위 상한으로 자르되 **글자를 쪼개지 않는다** — 쪼개면 이모지 반쪽이 남는다.
    func clippedToUTF16(_ limit: Int) -> String {
        var end = startIndex
        for index in indices {
            let next = self.index(after: index)
            if utf16.distance(from: startIndex, to: next) > limit { break }
            end = next
        }
        return String(self[startIndex ..< end])
    }
}
