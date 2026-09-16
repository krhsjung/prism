package kr.hs.jung.prism.feature.push

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DrawerState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.LocaleStore
import kr.hs.jung.prism.core.push.PushApi
import kr.hs.jung.prism.core.push.PushPermission
import kr.hs.jung.prism.core.push.PushRegistration
import kr.hs.jung.prism.core.push.PushTokens
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.session.SessionStore
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.core.theme.ThemeStore
import kr.hs.jung.prism.core.util.findActivity
import kr.hs.jung.prism.domain.model.MAX_PUSH_MESSAGE_LENGTH
import kr.hs.jung.prism.domain.model.MAX_PUSH_TITLE_LENGTH
import kr.hs.jung.prism.domain.model.PushActionSet
import kr.hs.jung.prism.domain.model.PushSendResult
import kr.hs.jung.prism.domain.model.SessionListItem
import kr.hs.jung.prism.domain.model.User
import kr.hs.jung.prism.feature.dashboard.deviceLabel
import kr.hs.jung.prism.ui.AppShell
import kr.hs.jung.prism.ui.ShellPage
import kr.hs.jung.prism.ui.component.DeviceRow
import kr.hs.jung.prism.ui.component.PrismBadge
import kr.hs.jung.prism.ui.component.PrismBadgeVariant
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant
import kr.hs.jung.prism.ui.component.PrismCard
import kr.hs.jung.prism.ui.component.PrismCheckbox
import kr.hs.jung.prism.ui.component.PrismErrorAlert
import kr.hs.jung.prism.ui.component.PrismInfoAlert
import kr.hs.jung.prism.ui.component.PrismTextField

/**
 * 푸시 화면 — 내 기기들에서 대상을 골라 **알림을 보내 본다**(plan/push.md §3).
 *
 * 구조는 시안 `Push / Mobile / Send` 그대로다: 카드 하나에 머리(제목·설명) → 권한
 * 안내 → 본문(작성 → 기기 목록 → 보내기) → 바닥 한 줄. **기기 목록이 보내기 바로
 * 위에 온다** — 무엇을 보낼지 정한 다음 누구에게 보낼지를 고르는 순서이고, 웹도 좁은
 * 폭에서 같은 순서로 쌓인다.
 *
 * 목록은 대시보드·통화 로비와 같은 데이터·같은 부품이다(§4). 다른 것은 할 수 있는
 * 일뿐이다 — 여기서는 현재 세션도 대상이고 **여럿 고를 수 있다**(§5-10).
 */
@Composable
fun PushScreen(
    user: User,
    themeStore: ThemeStore,
    localeStore: LocaleStore,
    /** 목록 하나. 대시보드·통화 로비가 보는 것과 **같은 것**이다. */
    store: SessionStore,
    pushApi: PushApi,
    pushTokens: PushTokens,
    tokens: SessionTokens,
    /** 등록의 수명을 쥔 자리. 되살리기·해제·회전은 여기 일이고 화면은 켜기·끄기만 시킨다. */
    registration: PushRegistration,
    drawerState: DrawerState,
    onNavigate: (ShellPage) -> Unit,
    onSignOut: () -> Unit,
) {
    val viewModel: PushViewModel = viewModel(
        factory = viewModelFactory {
            initializer { PushViewModel(store, pushApi, tokens, pushTokens, registration) }
        },
    )
    val state by viewModel.state.collectAsStateWithLifecycle()
    // 목록은 **이 화면의 것이 아니다** — 조회도 소켓 신호도 store가 한 자리에서 한다.
    // 예전에는 이 화면만 신호를 듣지 않아 다른 기기의 변화가 여기에는 오지 않았다.
    val sessions by store.state.collectAsStateWithLifecycle()
    val list = sessions.sessions.orEmpty()
    val context = LocalContext.current
    val activity = context.findActivity()

    // "다시 물을 수 있는가"는 **Activity만 안다.** 값만 읽어 넘기고 판단은 PushTokens가
    // 한다 — 화면이 권한 규칙을 들고 있으면 다른 화면이 생길 때 규칙이 둘이 된다.
    fun canShowRationale(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            activity != null &&
            ActivityCompat.shouldShowRequestPermissionRationale(
                activity,
                Manifest.permission.POST_NOTIFICATIONS,
            )

    // 33+에서만 런타임 권한이다 — 그 아래는 설치와 함께 허용된 것으로 다룬다(minSdk 24).
    val askPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        // **물어봤다는 사실을 남긴다.** 이것이 없으면 "아직 안 물음"과 "영구 거부"가
        // 시스템 API에서 똑같이 보인다(PushTokens.rememberAsked).
        pushTokens.rememberAsked()
        viewModel.registerThisDevice(canShowRationale())
    }

    // **설정을 다녀오면 다시 읽는다.** 사람은 이 화면 밖에서 알림을 끌 수 있는데,
    // `LaunchedEffect(Unit)`는 진입에 한 번만 돌아 복귀로는 돌지 않는다 — 그러면 화면은
    // 계속 "받는다"고 말하고, 다른 기기의 로비는 이 기기를 `Will notify`로 그린다.
    // 없는 사실을 지어내지 않는다는 §5-17의 자리다.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        viewModel.refreshPermission(canShowRationale())
    }

    AppShell(
        page = ShellPage.PUSH,
        userName = user.displayName,
        themeStore = themeStore,
        localeStore = localeStore,
        drawerState = drawerState,
        onNavigate = onNavigate,
        onSignOut = onSignOut,
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(PrismDimensions.topBarHorizontalPadding),
        ) {
            // 카드 구조는 dashboard.md §4 규칙 그대로다 — 카드 `padding: 0`, 좌우 여백은
            // 각 구획이 갖고, **구분선은 각 구획의 위**에 둔다.
            PrismCard(contentPadding = 0.dp, spacing = 0.dp) {
                Head()
                PermissionNotice(
                    state = state,
                    sessions = list,
                    onOpenSettings = { openAppNotificationSettings(context) },
                    onAllow = {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                            state.permission != PushPermission.GRANTED
                        ) {
                            askPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            viewModel.registerThisDevice(canShowRationale())
                        }
                    },
                    onTurnOff = viewModel::turnOff,
                )
                CardBody(state = state, sessions = list, viewModel = viewModel)
                Foot()
            }
        }
    }
}

/**
 * 화면이 무엇을 하는 곳인지 말한다 — 시안 `Head`. 여기 서는 것은 **페이지 제목**이고,
 * 기기 목록의 제목은 목록 바로 위에 따로 선다(예전에는 이 자리를 목록이 차지했다).
 */
@Composable
private fun Head() {
    val colors = PrismTheme.colors
    Column(
        verticalArrangement = Arrangement.spacedBy(PrismDimensions.headSpacing),
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                horizontal = PrismDimensions.pushCardInset,
                vertical = PrismDimensions.pushHeadPadding,
            ),
    ) {
        Text(
            text = stringResource(R.string.push_title),
            color = colors.heading,
            fontSize = PrismDimensions.fontSectionTitle,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = stringResource(R.string.push_desc),
            color = colors.muted,
            fontSize = PrismDimensions.fontBody,
        )
    }
}

/**
 * 토큰이 어디에 사는지 말하는 한 줄(§5-3) — 목록 응답에 토큰이 실리지 않는 이유이기도
 * 하다. 시안 `Foot`이고, 웹 `.push__foot`과 같은 자리다.
 */
@Composable
private fun Foot() {
    val colors = PrismTheme.colors
    HorizontalDivider(thickness = 1.dp, color = colors.border)
    Text(
        text = stringResource(R.string.push_foot),
        color = colors.muted,
        fontSize = PrismDimensions.fontBody,
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                horizontal = PrismDimensions.pushCardInset,
                vertical = PrismDimensions.pushFootPadding,
            ),
    )
}

/**
 * 안내는 **한 번에 하나만** 뜬다 — 권한의 네 상태가 서로 배타적이고, 등록 안내는
 * 허용된 뒤에만 나온다. 그래서 카드에서도 구획 하나를 차지한다.
 */
@Composable
private fun PermissionNotice(
    state: PushUiState,
    /** 화면 셋이 나눠 쓰는 목록 — 이 세션의 줄이 등록됐는지를 여기서 읽는다. */
    sessions: List<SessionListItem>,
    onAllow: () -> Unit,
    onOpenSettings: () -> Unit,
    onTurnOff: () -> Unit,
) {
    // 권한은 켜졌는데 이 세션이 등록 전이면 **여기서 바로 붙일 수 있다**(§5-2를 뒤집었다) —
    // 안내가 아니라 같은 켜기 버튼을 다시 내놓는다.
    val stale = sessions.any { it.isCurrent && !it.pushRegistered }
    val registered = sessions.any { it.isCurrent && it.pushRegistered }

    // 권한 안내는 **한 번에 하나만** 뜬다 — 권한의 갈래가 서로 배타적이기 때문이다.
    //
    // ⚠️ **끄기는 그 갈래에 속하지 않는다.** 끄는 것은 등록이지 권한이 아니므로(§5-15)
    // 등록돼 있으면 권한이 어떻든 끌 수 있어야 한다. 예전에는 `DENIED`가 끄기를 가려서,
    // 설정에서 권한을 끈 사람은 **남아 있는 등록을 지울 길이 화면에 없었다** — 서버는
    // 계속 이 기기를 푸시 대상으로 들고 있는데도. 그래서 아래에서 따로 그린다.
    val permissionContent: (@Composable () -> Unit)? = when {
        // 아직 안 봤다 — 볼 때까지는 자리를 비운다. **`null`을 아래 갈래로 흘려보내면
        // 안 된다**: `!= GRANTED`가 참이라 켜기 버튼이 먼저 깜빡인다.
        state.permission == null -> return
        // 설정 파일 없이 빌드한 앱이다. **말은 해 준다** — 아무것도 안 그리면 목록의
        // `알림 꺼짐`이 왜 전부인지 알 길이 없다.
        state.permission == PushPermission.UNSUPPORTED -> {
            { PrismInfoAlert(stringResource(R.string.push_allow_unsupported)) }
        }
        // **막다른 길을 두지 않는다.** 시스템이 더는 묻지 않으므로 `켜기`를 세우면 눌러도
        // 아무 일이 없다 — 대신 **할 수 있는 곳으로 데려간다**. 돌아오면 `ON_RESUME`이
        // 권한을 다시 읽어 그 자리에서 `켜기`로 바뀐다(§5-19).
        state.permission == PushPermission.DENIED -> {
            {
                AllowBox(
                    description = stringResource(R.string.push_allow_denied),
                    label = stringResource(R.string.push_allow_open_settings),
                    onClick = onOpenSettings,
                )
            }
        }
        state.permission != PushPermission.GRANTED || stale -> {
            {
                AllowBox(
                    description = stringResource(R.string.push_allow_desc),
                    label = stringResource(R.string.push_allow),
                    onClick = onAllow,
                )
            }
        }
        else -> null
    }

    if (permissionContent == null && !registered) return

    // 안내가 앉는 자리 — 머리 아래, 본문 구분선 위(웹 `.push__notice`).
    Column(
        verticalArrangement = Arrangement.spacedBy(PrismDimensions.pushBodySpacing),
        modifier = Modifier.padding(
            start = PrismDimensions.pushCardInset,
            end = PrismDimensions.pushCardInset,
            bottom = PrismDimensions.pushBodySpacing,
        ),
    ) {
        permissionContent?.invoke()
        // 끄는 길은 **등록돼 있으면 언제나** 선다. 설명이 "권한은 그대로"라고 말하므로
        // 못 지킬 약속도 아니다(§5-15).
        if (registered) {
            AllowBox(
                description = stringResource(R.string.push_allow_off_desc),
                label = stringResource(R.string.push_allow_off),
                onClick = onTurnOff,
            )
        }
    }
}

/**
 * 이 앱의 알림 설정을 연다.
 *
 * 26+에는 **앱의 알림 설정**을 바로 여는 인텐트가 있다. 그 아래(minSdk 24)에는 없어서
 * 앱 정보 화면으로 보낸다 — 한 단계 더 들어가야 하지만 막다른 길은 아니다.
 *
 * **`UNSUPPORTED`에는 두지 않는다.** 그쪽은 권한이 아니라 `google-services.json` 없이
 * 빌드한 앱이라 설정으로 고칠 수 있는 것이 없다 — 버튼을 세우면 그것이 곧 가짜
 * 컨트롤이다(§5-19).
 */
private fun openAppNotificationSettings(context: Context) {
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
    } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
    }
    // 화면이 아니라 앱 밖으로 나가는 이동이라 **새 태스크**로 연다.
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    // 기기에 그 설정 화면이 없을 수 있다 — 없으면 아무 일도 하지 않는다(앱은 죽지 않는다).
    runCatching { context.startActivity(intent) }
}

/**
 * 설명 한 줄과 버튼 하나가 든 테두리 상자(시안). 켜기와 끄기가 **같은 모양**을 쓴다 —
 * 사용자가 할 일은 어느 쪽이든 버튼 하나라 컨트롤을 둘로 두지 않는다.
 */
@Composable
private fun AllowBox(description: String, label: String, onClick: () -> Unit) {
    val colors = PrismTheme.colors
    Column(
        verticalArrangement = Arrangement.spacedBy(PrismDimensions.callFieldSpacing),
        modifier = Modifier
            .fillMaxWidth()
            .border(
                1.dp,
                colors.border,
                RoundedCornerShape(PrismDimensions.radiusMd),
            )
            .padding(
                horizontal = PrismDimensions.pushNoticeHorizontalPadding,
                vertical = PrismDimensions.pushNoticeVerticalPadding,
            ),
    ) {
        Text(text = description, color = colors.muted, fontSize = PrismDimensions.fontCaption)
        PrismButton(
            text = label,
            variant = PrismButtonVariant.OUTLINE,
            onClick = onClick,
            fillWidth = false,
        )
    }
}

/**
 * 작성 → 기기 목록 → 보내기. **순서가 시안이다**(§4) — 무엇을 보낼지 정한 뒤에
 * 누구에게 보낼지를 고른다.
 */
@Composable
private fun CardBody(
    state: PushUiState,
    sessions: List<SessionListItem>,
    viewModel: PushViewModel,
) {
    val colors = PrismTheme.colors
    HorizontalDivider(thickness = 1.dp, color = colors.border)
    Column(
        verticalArrangement = Arrangement.spacedBy(PrismDimensions.pushBodySpacing),
        modifier = Modifier.padding(PrismDimensions.pushBodyPadding),
    ) {
        // 제목은 선택이다 — 비우면 서버가 받는 기기의 언어로 그린다(§5-14).
        // 알림에서 읽히는 순서가 제목 → 문구라 화면도 그 순서다.
        Field(R.string.push_title_label) {
            PrismTextField(
                value = state.title,
                onValueChange = { next ->
                    if (next.length <= MAX_PUSH_TITLE_LENGTH) viewModel.editTitle(next)
                },
                placeholder = stringResource(R.string.push_title_placeholder),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Field(R.string.push_message_label) {
            PrismTextField(
                value = state.message,
                onValueChange = { next ->
                    if (next.length <= MAX_PUSH_MESSAGE_LENGTH) viewModel.edit(next)
                },
                placeholder = stringResource(R.string.push_message_placeholder),
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        // 이미지·링크·버튼은 **셋 다 선택이다** — 없으면 문구만 있는 알림이다.
        Field(R.string.push_image_label, R.string.push_image_hint) {
            // **그리는 것은 결국 OS다.** 주소도 페이로드도 맞는데 데스크톱 브라우저로
            // 보내면 그림이 빠진다(§5-11). 보내는 쪽이 폰이어도 받는 쪽이 그럴 수 있으므로
            // 여기서도 말한다 — 화면이 먼저 말하지 않으면 배관이 깨진 것으로 읽힌다.
            Text(
                text = stringResource(R.string.push_image_desktop_note),
                color = colors.muted,
                fontSize = PrismDimensions.fontCaption,
            )
            Samples(selected = state.imageUrl, onSelect = viewModel::editImageUrl)
            PrismTextField(
                value = state.imageUrl,
                onValueChange = viewModel::editImageUrl,
                placeholder = stringResource(R.string.push_image_placeholder),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Field(R.string.push_link_label, R.string.push_link_hint) {
            PrismTextField(
                value = state.link,
                onValueChange = viewModel::editLink,
                placeholder = stringResource(R.string.push_link_placeholder),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        // 조합은 **계약이 정한다** — iOS가 미리 등록한 것만 쓸 수 있어 임의 목록을
        // 보낼 방법이 없다(§5-13).
        //
        // 어디에 보이는지는 **받는 기기**가 정한다 — 접힌 알림에는 안 뜨는 기기가 있어,
        // 안내가 없으면 기능이 고장 난 것으로 읽힌다. 이미지의 `image_desktop_note`와
        // 같은 자리·같은 규칙이다.
        Field(R.string.push_actions_label, hint = R.string.push_actions_hint) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PushActionSet.entries.forEach { set ->
                    PrismButton(
                        text = stringResource(actionsLabel(set)),
                        variant = if (state.actions == set) {
                            PrismButtonVariant.SECONDARY
                        } else {
                            PrismButtonVariant.OUTLINE
                        },
                        onClick = { viewModel.selectActions(set) },
                        fillWidth = false,
                    )
                }
            }
        }

        Devices(state = state, sessions = sessions, viewModel = viewModel)

        // 필드마다는 상한 안이어도 합이 FCM의 4 KB를 넘길 수 있다 — 서버가 400으로 접기 전에
        // 화면이 먼저 막고 이유를 말한다.
        if (state.tooLong) {
            Text(
                text = stringResource(R.string.push_content_too_long),
                color = PrismTheme.colors.muted,
                fontSize = PrismDimensions.fontBody,
            )
        }

        // 진행 중에도 **글자를 바꾸지 않는다**(plan/dashboard.md §4).
        PrismButton(
            text = stringResource(R.string.push_send),
            variant = PrismButtonVariant.PRIMARY,
            onClick = viewModel::send,
            enabled = state.canSend(sessions),
        )

        if (state.failed) {
            PrismErrorAlert(stringResource(R.string.error_generic))
        }
    }
}

/**
 * 목록 머리는 **고른 수를 말하고 한 번에 바꾼다** — 기기가 여럿일 때 줄마다 누르는
 * 것이 유일한 길이면 손이 많이 간다.
 */
@Composable
private fun Devices(
    state: PushUiState,
    sessions: List<SessionListItem>,
    viewModel: PushViewModel,
) {
    val colors = PrismTheme.colors
    val registered = sessions.pushTargets()
    val targets = state.targets(sessions)
    Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callFieldSpacing)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = stringResource(R.string.push_devices),
                color = colors.text,
                fontSize = PrismDimensions.fontBody,
                modifier = Modifier.weight(1f),
            )
            if (registered.size > 1) {
                Text(
                    text = stringResource(R.string.push_selected_count)
                        .replace("{count}", targets.size.toString()),
                    color = colors.muted,
                    fontSize = PrismDimensions.fontCaption,
                )
                PrismButton(
                    text = stringResource(
                        if (state.allSelected(sessions)) {
                            R.string.push_clear_all
                        } else {
                            R.string.push_select_all
                        },
                    ),
                    variant = PrismButtonVariant.GHOST,
                    onClick = viewModel::toggleAll,
                    fillWidth = false,
                )
            }
        }
        // 어느 줄이 왜 흐린지는 **목록 옆에서** 말한다 — 카드 머리에 두면 목록까지
        // 눈이 한 번 더 왕복한다(시안 Devices).
        Text(
            text = stringResource(R.string.push_devices_desc),
            color = colors.muted,
            fontSize = PrismDimensions.fontCaption,
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PrismDimensions.radiusMd))
                .border(
                    1.dp,
                    colors.border,
                    RoundedCornerShape(PrismDimensions.radiusMd),
                ),
        ) {
            sessions.forEachIndexed { index, session ->
                if (index > 0) {
                    HorizontalDivider(thickness = 1.dp, color = colors.border)
                }
                val checked = targets.contains(session.id)
                val result = state.results[session.id]
                DeviceRow(
                    device = session.device,
                    title = stringResource(deviceLabel(session.device)),
                    // 결과는 **고른 줄 옆에** 그린다 — 목록 밖에서 다시 짝지어 읽게
                    // 하지 않는다(§5-10).
                    subtitle = result
                        ?.let { stringResource(resultLabel(it)) }
                        ?: ("#" + session.id.take(8)),
                    dimmed = !session.pushRegistered,
                ) {
                    if (session.pushRegistered) {
                        // 여럿 고를 수 있다는 것을 컨트롤의 모양이 먼저 말한다.
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm),
                            modifier = Modifier
                                .toggleable(
                                    value = checked,
                                    role = Role.Checkbox,
                                    onValueChange = { viewModel.toggle(session.id) },
                                )
                                // 그리는 칸은 18이지만 누르는 표적은 48 — Material 체크박스가
                                // 대신 잡아 주던 크기를 줄이 직접 잡는다.
                                .minimumInteractiveComponentSize(),
                        ) {
                            PrismCheckbox(checked = checked)
                            Text(
                                text = stringResource(
                                    if (checked) R.string.push_selected
                                    else R.string.push_select,
                                ),
                                color = colors.text,
                                fontSize = PrismDimensions.fontCaption,
                            )
                        }
                    } else {
                        // 누를 수 없는 컨트롤을 두지 않는다 — 배지가 이유를 말한다.
                        PrismBadge(
                            text = stringResource(R.string.webrtc_notifications_off),
                            variant = PrismBadgeVariant.NEUTRAL,
                        )
                    }
                }
            }
        }
    }
}

/**
 * 샘플 이미지 칩. 리뷰어가 공개 이미지 주소를 따로 구해 오지 않아도 시연할 수 있어야
 * 한다(§5-11) — 고른 칩만 테두리가 진해진다(웹 `.push__sample--on`).
 */
@Composable
private fun Samples(selected: String, onSelect: (String) -> Unit) {
    val colors = PrismTheme.colors
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SampleChip(isOn = selected.isEmpty(), onClick = { onSelect("") }) {
            Text(
                text = stringResource(R.string.push_image_none),
                color = if (selected.isEmpty()) colors.text else colors.muted,
                fontSize = PrismDimensions.fontCaption,
                modifier = Modifier.padding(horizontal = 8.dp),
            )
        }
        PUSH_SAMPLE_IMAGES.forEach { sample ->
            val url = sample.url()
            SampleChip(
                isOn = selected == url,
                onClick = { onSelect(url) },
                modifier = Modifier.semantics { contentDescription = sample.path },
            ) {
                Box(
                    modifier = Modifier
                        .size(
                            width = PrismDimensions.pushSampleWidth,
                            height = PrismDimensions.pushSampleHeight,
                        )
                        .background(
                            Brush.verticalGradient(
                                listOf(sample.from(colors), sample.to(colors)),
                            ),
                        ),
                )
            }
        }
    }
}

@Composable
private fun SampleChip(
    isOn: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val colors = PrismTheme.colors
    val shape = RoundedCornerShape(PrismDimensions.radiusSm)
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .height(PrismDimensions.pushSampleHeight)
            .clip(shape)
            .border(
                if (isOn) PrismDimensions.pushSampleSelectedBorder else 1.dp,
                if (isOn) colors.primary else colors.border,
                shape,
            )
            .clickable(role = Role.RadioButton, onClick = onClick),
    ) {
        content()
    }
}

/** 라벨(+안내)과 그 아래 컨트롤 한 벌(웹 `.setup__field`). */
@Composable
private fun Field(
    label: Int,
    hint: Int? = null,
    content: @Composable () -> Unit,
) {
    val colors = PrismTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.callFieldSpacing)) {
        Text(
            text = stringResource(label),
            color = colors.text,
            fontSize = PrismDimensions.fontBody,
        )
        if (hint != null) {
            Text(
                text = stringResource(hint),
                color = colors.muted,
                fontSize = PrismDimensions.fontCaption,
            )
        }
        content()
    }
}

// FCM이 알려 주는 것은 "받아들였다"까지다 — 화면이 그 이상을 말하지 않는다(§7).
private fun resultLabel(result: PushSendResult): Int = when (result) {
    PushSendResult.ACCEPTED -> R.string.push_result_accepted
    PushSendResult.NO_TOKEN -> R.string.push_result_no_token
    PushSendResult.REJECTED -> R.string.push_result_rejected
    PushSendResult.FAILED -> R.string.push_result_failed
    PushSendResult.DUPLICATE -> R.string.push_result_duplicate
    PushSendResult.UNKNOWN -> R.string.push_result_unknown
}

private fun actionsLabel(set: PushActionSet): Int = when (set) {
    PushActionSet.NONE -> R.string.push_actions_none
    PushActionSet.OPEN -> R.string.push_actions_open
    PushActionSet.OPEN_DISMISS -> R.string.push_actions_open_dismiss
}
