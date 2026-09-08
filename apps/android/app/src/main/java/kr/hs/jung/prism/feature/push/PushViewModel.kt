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
import kr.hs.jung.prism.domain.model.MAX_PUSH_TARGETS
import kr.hs.jung.prism.domain.model.PushActionSet
import kr.hs.jung.prism.domain.model.PushSendResult
import kr.hs.jung.prism.domain.model.SessionListItem
import kr.hs.jung.prism.feature.dashboard.SessionsApi

data class PushUiState(
    val sessions: List<SessionListItem> = emptyList(),
    /** 고른 대상들. **여럿 고를 수 있다**(plan/push.md §5-10). */
    val targetIds: List<String> = emptyList(),
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
) : ViewModel() {
    private val _state = MutableStateFlow(PushUiState())
    val state: StateFlow<PushUiState> = _state.asStateFlow()

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
