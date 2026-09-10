package kr.hs.jung.prism.feature.push

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.push.PushPermission
import kr.hs.jung.prism.core.push.PushTokens
import kr.hs.jung.prism.domain.model.MAX_PUSH_TARGETS
import kr.hs.jung.prism.domain.model.PushActionSet
import kr.hs.jung.prism.domain.model.PushSendResult
import kr.hs.jung.prism.domain.model.SessionListItem
import kr.hs.jung.prism.feature.dashboard.SessionsApi

data class PushUiState(
    val sessions: List<SessionListItem> = emptyList(),
    /** 고른 대상들. **여럿 고를 수 있다**(plan/push.md §5-10). */
    val targetIds: List<String> = emptyList(),
    /** 이 기기의 알림 권한. 어떤 안내를 그릴지 가른다(네 갈래). */
    val permission: PushPermission = PushPermission.UNSUPPORTED,
    val title: String = "",
    val message: String = "",
    val imageUrl: String = "",
    val link: String = "",
    val actions: PushActionSet = PushActionSet.NONE,
    val sending: Boolean = false,
    /** 대상별 결말. 화면이 **고른 줄 옆에** 그린다. */
    val results: Map<String, PushSendResult> = emptyMap(),
    val failed: Boolean = false,
) {
    val registered: List<SessionListItem> get() = sessions.filter { it.pushRegistered }
    val canSend: Boolean get() = targetIds.isNotEmpty() && message.isNotBlank() && !sending
}

/**
 * 푸시 화면의 상태.
 *
 * 목록은 대시보드·통화 로비와 **같은 원천**(`GET /auth/sessions`)이다. 다른 것은 할 수
 * 있는 일뿐이다 — 여기서는 현재 세션도 대상이고, **여럿 고를 수 있다**. 같은 설치가
 * 여러 세션에 걸리면 서버가 토큰 기준으로 합쳐 한 번만 보낸다(§5-10).
 */
class PushViewModel(
    private val sessionsApi: SessionsApi,
    private val pushApi: PushApi,
    private val tokens: SessionTokens,
    private val pushTokens: PushTokens,
) : ViewModel() {
    private val _state = MutableStateFlow(PushUiState())
    val state: StateFlow<PushUiState> = _state.asStateFlow()

    /**
     * 화면에 들어올 때·권한 창이 닫힌 뒤 다시 읽는다.
     *
     * @param canShowRationale Activity에서만 읽을 수 있어 화면이 넘겨 준다.
     */
    fun refreshPermission(canShowRationale: Boolean) = _state.update {
        it.copy(permission = pushTokens.permission(canShowRationale))
    }

    /**
     * **권한과 등록을 함께 끝낸다.** 예전에는 토큰이 로그인 요청에만 실려서, 여기서
     * 권한을 켜도 그 세션은 재로그인 전까지 대상이 아니었다(§5-2를 뒤집었다).
     */
    fun registerThisDevice(canShowRationale: Boolean) {
        viewModelScope.launch {
            refreshPermission(canShowRationale)
            val access = tokens.access() ?: return@launch
            val fcm = pushTokens.current() ?: return@launch
            // 실패해도 화면은 사실을 말한다 — 그 줄이 `Notifications off`로 남는다.
            runCatching { pushApi.register(access, fcm) }
            // 선택을 기기에 남긴다 — 다음 로그인에서 이 값을 보고 조용히 다시 붙는다(§5-16).
            pushTokens.rememberWanted(true)
            load(background = true)
        }
    }

    /**
     * **끄는 것은 등록이지 권한이 아니다** — OS는 앱이 권한을 되돌리는 길을 주지 않는다.
     * 기기의 토큰은 그대로 두므로 다시 켤 때 권한 창이 뜨지 않는다(§5-15).
     */
    fun turnOff() {
        viewModelScope.launch {
            val access = tokens.access() ?: return@launch
            runCatching { pushApi.unregister(access) }
            pushTokens.rememberWanted(false)
            load(background = true)
        }
    }

    fun load(background: Boolean = false) {
        viewModelScope.launch {
            val token = tokens.access() ?: return@launch
            val list = runCatching { sessionsApi.list(token, background) }.getOrNull()
                ?: return@launch
            _state.update { current ->
                current.copy(
                    sessions = list,
                    // 사라진 대상은 골라 둔 목록에서도 놓는다.
                    targetIds = current.targetIds.filter { id -> list.any { it.id == id } },
                )
            }
        }
    }

    fun toggle(id: String) = _state.update { current ->
        val next = when {
            current.targetIds.contains(id) -> current.targetIds - id
            // 서버도 같은 상한으로 400을 낸다 — 여기서 먼저 막아 왕복을 아낀다.
            current.targetIds.size >= MAX_PUSH_TARGETS -> current.targetIds
            else -> current.targetIds + id
        }
        current.copy(targetIds = next)
    }

    fun toggleAll() = _state.update { current ->
        val all = current.registered.take(MAX_PUSH_TARGETS).map { it.id }
        current.copy(targetIds = if (current.targetIds.size == all.size) emptyList() else all)
    }

    fun edit(message: String) = _state.update { it.copy(message = message) }
    fun editTitle(title: String) = _state.update { it.copy(title = title) }
    fun editImageUrl(url: String) = _state.update { it.copy(imageUrl = url) }
    fun editLink(link: String) = _state.update { it.copy(link = link) }
    fun selectActions(actions: PushActionSet) = _state.update { it.copy(actions = actions) }

    fun send() {
        val snapshot = _state.value
        if (!snapshot.canSend) return

        viewModelScope.launch {
            _state.update { it.copy(sending = true, results = emptyMap(), failed = false) }
            val token = tokens.access()
            if (token == null) {
                _state.update { it.copy(sending = false, failed = true) }
                return@launch
            }
            try {
                val outcomes = pushApi.send(
                    token,
                    snapshot.targetIds,
                    PushContent(
                        message = snapshot.message.trim(),
                        title = snapshot.title.trim().ifBlank { null },
                        imageUrl = snapshot.imageUrl.trim().ifBlank { null },
                        link = snapshot.link.trim().ifBlank { null },
                        actions = snapshot.actions,
                    ),
                )
                _state.update { current ->
                    current.copy(
                        sending = false,
                        results = outcomes.associate { it.sessionId to it.result },
                    )
                }
                // 목록의 `pushRegistered`가 낡았을 수 있다(그 기기가 방금 로그아웃했다).
                if (outcomes.any { it.result != PushSendResult.ACCEPTED }) {
                    load(background = true)
                }
            } catch (e: ApiError) {
                // 400(형식)·502(FCM이 안 됨) 모두 사용자가 할 일은 같다.
                _state.update { it.copy(sending = false, failed = true) }
            }
        }
    }
}
