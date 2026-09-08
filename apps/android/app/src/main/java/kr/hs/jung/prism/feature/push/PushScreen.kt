package kr.hs.jung.prism.feature.push

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DrawerState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.LocaleStore
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.core.theme.ThemeStore
import kr.hs.jung.prism.domain.model.MAX_PUSH_MESSAGE_LENGTH
import kr.hs.jung.prism.domain.model.PushActionSet
import kr.hs.jung.prism.domain.model.PushSendResult
import kr.hs.jung.prism.domain.model.User
import kr.hs.jung.prism.feature.dashboard.SessionsApi
import kr.hs.jung.prism.feature.dashboard.deviceLabel
import kr.hs.jung.prism.ui.AppShell
import kr.hs.jung.prism.ui.ShellPage
import kr.hs.jung.prism.ui.component.DeviceRow
import kr.hs.jung.prism.ui.component.PrismBadge
import kr.hs.jung.prism.ui.component.PrismBadgeVariant
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant
import kr.hs.jung.prism.ui.component.PrismCard

/**
 * 푸시 화면 — 내 기기들에서 대상을 골라 **알림을 보내 본다**(plan/push.md §3).
 *
 * 목록은 대시보드·통화 로비와 같은 데이터·같은 부품이다(§4). 다른 것은 할 수 있는
 * 일뿐이다 — 여기서는 현재 세션도 대상이고 **여럿 고를 수 있다**(§5-10).
 */
@Composable
fun PushScreen(
    user: User,
    themeStore: ThemeStore,
    localeStore: LocaleStore,
    sessionsApi: SessionsApi,
    pushApi: PushApi,
    tokens: SessionTokens,
    drawerState: DrawerState,
    onNavigate: (ShellPage) -> Unit,
    onSignOut: () -> Unit,
) {
    val viewModel: PushViewModel = viewModel(
        factory = viewModelFactory {
            initializer { PushViewModel(sessionsApi, pushApi, tokens) }
        },
    )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = PrismTheme.colors

    LaunchedEffect(Unit) { viewModel.load() }

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
            verticalArrangement = Arrangement.spacedBy(PrismDimensions.cardSpacing),
            modifier = Modifier.verticalScroll(rememberScrollState()),
        ) {
            PrismCard {
                // 목록 머리는 **고른 수를 말하고 한 번에 바꾼다** — 기기가 여럿일 때
                // 줄마다 누르는 것이 유일한 길이면 손이 많이 간다.
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = stringResource(R.string.push_devices),
                        color = colors.heading,
                        fontSize = PrismDimensions.fontRowTitle,
                        modifier = Modifier.weight(1f),
                    )
                    if (state.registered.size > 1) {
                        Text(
                            text = stringResource(R.string.push_selected_count)
                                .replace("{count}", state.targetIds.size.toString()),
                            color = colors.muted,
                            fontSize = PrismDimensions.fontCaption,
                        )
                        PrismButton(
                            text = stringResource(
                                if (state.targetIds.size == state.registered.size) {
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
                Text(
                    text = stringResource(R.string.push_devices_desc),
                    color = colors.muted,
                    fontSize = PrismDimensions.fontCaption,
                )

                Column(modifier = Modifier.fillMaxWidth()) {
                    state.sessions.forEachIndexed { index, session ->
                        if (index > 0) {
                            HorizontalDivider(thickness = 1.dp, color = colors.border)
                        }
                        val checked = state.targetIds.contains(session.id)
                        val result = state.results[session.id]
                        DeviceRow(
                            device = session.device,
                            title = stringResource(deviceLabel(session.device)),
                            // 결과는 **고른 줄 옆에** 그린다 — 목록 밖에서 다시 짝지어
                            // 읽게 하지 않는다(§5-10).
                            subtitle = result
                                ?.let { stringResource(resultLabel(it)) }
                                ?: ("#" + session.id.take(8)),
                            dimmed = !session.pushRegistered,
                        ) {
                            if (session.pushRegistered) {
                                // 여럿 고를 수 있다는 것을 컨트롤의 모양이 먼저 말한다.
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                                    modifier = Modifier.toggleable(
                                        value = checked,
                                        role = Role.Checkbox,
                                        onValueChange = { viewModel.toggle(session.id) },
                                    ),
                                ) {
                                    Checkbox(checked = checked, onCheckedChange = null)
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

                Field(R.string.push_message_label) {
                    OutlinedTextField(
                        value = state.message,
                        onValueChange = { next ->
                            if (next.length <= MAX_PUSH_MESSAGE_LENGTH) viewModel.edit(next)
                        },
                        placeholder = {
                            Text(stringResource(R.string.push_message_placeholder))
                        },
                        minLines = 3,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                // 이미지·링크·버튼은 **셋 다 선택이다** — 없으면 문구만 있는 알림이다.
                Field(R.string.push_image_label, R.string.push_image_hint) {
                    OutlinedTextField(
                        value = state.imageUrl,
                        onValueChange = viewModel::editImageUrl,
                        placeholder = {
                            Text(stringResource(R.string.push_image_placeholder))
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                Field(R.string.push_link_label, R.string.push_link_hint) {
                    OutlinedTextField(
                        value = state.link,
                        onValueChange = viewModel::editLink,
                        placeholder = {
                            Text(stringResource(R.string.push_link_placeholder))
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                // 조합은 **계약이 정한다** — iOS가 미리 등록한 것만 쓸 수 있어 임의
                // 목록을 보낼 방법이 없다(§5-13).
                Field(R.string.push_actions_label) {
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

                // 진행 중에도 **글자를 바꾸지 않는다**(plan/dashboard.md §4).
                PrismButton(
                    text = stringResource(R.string.push_send),
                    variant = PrismButtonVariant.PRIMARY,
                    onClick = viewModel::send,
                    enabled = state.canSend,
                )

                if (state.failed) {
                    Text(
                        text = stringResource(R.string.error_generic),
                        color = colors.error,
                        fontSize = PrismDimensions.fontCaption,
                    )
                }
            }
        }
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
    PushSendResult.DUPLICATE -> R.string.push_result_duplicate
    PushSendResult.UNKNOWN -> R.string.push_result_unknown
}

private fun actionsLabel(set: PushActionSet): Int = when (set) {
    PushActionSet.NONE -> R.string.push_actions_none
    PushActionSet.OPEN -> R.string.push_actions_open
    PushActionSet.OPEN_DISMISS -> R.string.push_actions_open_dismiss
}
