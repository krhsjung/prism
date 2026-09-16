package kr.hs.jung.prism.feature.push

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.push.PushApi
import kr.hs.jung.prism.core.push.PushContent
import kr.hs.jung.prism.core.push.PushPermission
import kr.hs.jung.prism.core.push.PushRegistration
import kr.hs.jung.prism.core.push.PushTokens
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.session.SessionStore
import kr.hs.jung.prism.domain.model.MAX_PUSH_CONTENT_BYTES
import kr.hs.jung.prism.domain.model.MAX_PUSH_TARGETS
import kr.hs.jung.prism.domain.model.PushActionSet
import kr.hs.jung.prism.domain.model.PushSendResult
import kr.hs.jung.prism.domain.model.SessionListItem

data class PushUiState(
    /**
     * 고른 대상들. **여럿 고를 수 있다**(plan/push.md §5-10).
     *
     * 사라진 대상은 **지우지 않고 걸러서 읽는다**([targets]) — 목록은 이제 이 화면 밖에서도
     * 바뀌고(소켓 신호·다른 화면의 해제), 그때마다 골라 둔 것을 고쳐 쓰면 목록이 잠깐 비는
     * 순간(재조회 실패)에 선택이 통째로 날아간다.
     */
    val selectedIds: List<String> = emptyList(),
    /**
     * 이 기기의 알림 권한. 어떤 안내를 그릴지 가른다(네 갈래).
     *
     * **`null`은 "아직 안 봤다"**이고 어떤 갈래도 아니다. 처음 값을 `UNSUPPORTED`로
     * 두었더니 화면이 확인하기 **전에** "여기서는 알림을 받을 수 없습니다"를 그렸다 —
     * 모르는 것과 아는 것을 같은 값으로 두면 화면이 모르는 채로 단정한다.
     */
    val permission: PushPermission? = null,
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
    /**
     * 고른 것 중 **지금 보낼 수 있는 것**. 사라진 세션도, 방금 알림을 끈 세션도 빠진다.
     *
     * 후자를 빼지 않으면 그 줄의 체크박스는 사라지는데 전송 목록에는 남아 **보이는
     * 선택과 보내는 선택이 어긋난다** — 고른 것이 그것 하나뿐이면 끌 길도 없다.
     */
    fun targets(sessions: List<SessionListItem>): List<String> =
        selectedIds.filter { id -> sessions.any { it.id == id && it.pushRegistered } }

    /**
     * 사람이 적은 것의 UTF-8 바이트 합이 상한을 넘는가 — 필드마다는 상한 안이어도 합이 FCM의
     * 4 KB를 넘길 수 있고, 그 요청은 서버가 400으로 접는다. 화면이 먼저 막고 이유를 말한다.
     */
    val tooLong: Boolean
        get() = listOf(message, title, imageUrl, link)
            .sumOf { it.trim().toByteArray(Charsets.UTF_8).size } > MAX_PUSH_CONTENT_BYTES

    fun canSend(sessions: List<SessionListItem>): Boolean {
        val targets = targets(sessions)
        // 걷어내기 전의 옛 선택이 돌아와 상한을 넘겼을 수 있다 — 보내면 400이다.
        return targets.isNotEmpty() && targets.size <= MAX_PUSH_TARGETS &&
            message.isNotBlank() && !sending && !tooLong
    }

    /**
     * 모두 선택은 **상한까지**다 — 등록 기기가 상한보다 많으면 "모두"는 처음 상한만큼이고, 그만큼
     * 골랐으면 해제로 바뀐다. 전체 수와 견주면 21대부터 버튼이 영영 "모두 선택"으로 남는다.
     */
    fun allSelected(sessions: List<SessionListItem>): Boolean =
        targets(sessions).size >= minOf(sessions.pushTargets().size, MAX_PUSH_TARGETS)

    /**
     * 한 줄을 고르거나 푼다. 사람이 고치는 순간에는 사라진 줄을 **걷어낸다** — 걸러서 읽기만
     * 하면(`targets`) 숨은 옛 선택이 뒤에 돌아와 상한을 넘긴다(20개 고름 → 하나 빠짐 → 하나
     * 더 고름 → 빠진 것이 돌아옴 = 21개). 걷어내면 돌아와도 고른 것이 아니다.
     */
    fun toggled(id: String, sessions: List<SessionListItem>): PushUiState {
        val live = targets(sessions)
        val next = when {
            live.contains(id) -> live - id
            // 서버도 같은 상한으로 400을 낸다 — 여기서 먼저 막아 왕복을 아낀다.
            live.size >= MAX_PUSH_TARGETS -> live
            else -> live + id
        }
        return copy(selectedIds = next)
    }
}

/** 알림을 받을 수 있는 기기들 — 나머지 줄은 흐리게 그리고 고를 수 없다. */
fun List<SessionListItem>.pushTargets(): List<SessionListItem> =
    filter { it.pushRegistered }

/**
 * 푸시 화면에서 **작성하고 고르는 것**을 쥔다.
 *
 * 목록은 여기 없다 — 대시보드·통화 로비가 보는 것과 같은 것이고 [store]가 세션에 하나만
 * 들고 있다(core/session/SessionStore.kt). 이 화면이 목록을 따로 들고 따로 조회하던
 * 때에는 **소켓 신호를 듣지 않아 다른 기기의 변화가 여기만 도착하지 않았다.**
 *
 * 다른 화면과 다른 것은 할 수 있는 일뿐이다 — 여기서는 현재 세션도 대상이고, **여럿
 * 고를 수 있다**. 같은 설치가 여러 세션에 걸리면 서버가 토큰 기준으로 합쳐 한 번만
 * 보낸다(§5-10).
 *
 * **등록의 수명도 여기 없다.** 되살리기·권한이 사라졌을 때의 해제·토큰 회전은 세션에
 * 하나 있는 [registration]이 맞춘다 — 이 화면은 켜기·끄기를 시키고 권한 갈래를 그릴 뿐이다.
 * 화면에 두면 화면이 떠 있을 때만 맞춰지고, 되살리기와 겹쳐 돌아 늦게 끝난 쪽이 먼저
 * 끝난 쪽을 덮는다.
 */
class PushViewModel(
    private val store: SessionStore,
    private val pushApi: PushApi,
    private val tokens: SessionTokens,
    private val pushTokens: PushTokens,
    private val registration: PushRegistration,
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
     * **권한과 등록을 함께 끝낸다.** 권한 창은 화면이 열고(Activity가 필요하다), 닫힌 뒤
     * 여기로 온다 — 토큰을 받아 붙이고 선택을 기억하는 일은 [registration]이 한다.
     */
    fun registerThisDevice(canShowRationale: Boolean) {
        viewModelScope.launch {
            refreshPermission(canShowRationale)
            registration.enable()
        }
    }

    /**
     * **끄는 것은 등록이지 권한이 아니다** — OS는 앱이 권한을 되돌리는 길을 주지 않는다.
     * 기기의 토큰은 그대로 두므로 다시 켤 때 권한 창이 뜨지 않는다(§5-15).
     */
    fun turnOff() {
        viewModelScope.launch { registration.disable() }
    }

    /** 지금 목록. 아직 못 받아 봤으면 빈 목록으로 다룬다. */
    private fun sessions(): List<SessionListItem> = store.state.value.sessions.orEmpty()

    fun toggle(id: String) = _state.update { current -> current.toggled(id, sessions()) }

    fun toggleAll() = _state.update { current ->
        val all = sessions().pushTargets().take(MAX_PUSH_TARGETS).map { it.id }
        current.copy(selectedIds = if (current.allSelected(sessions())) emptyList() else all)
    }

    fun edit(message: String) = _state.update { it.copy(message = message) }
    fun editTitle(title: String) = _state.update { it.copy(title = title) }
    fun editImageUrl(url: String) = _state.update { it.copy(imageUrl = url) }
    fun editLink(link: String) = _state.update { it.copy(link = link) }
    fun selectActions(actions: PushActionSet) = _state.update { it.copy(actions = actions) }

    fun send() {
        val snapshot = _state.value
        val targets = snapshot.targets(sessions())
        if (!snapshot.canSend(sessions())) return

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
                    targets,
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
                    store.refresh(background = true)
                }
                // 거부된 토큰은 **서버가 그 세션에서 뗐다** — 그 줄은 이제 `알림 꺼짐`이고,
                // 다른 기기의 목록·로비도 그것을 알아야 한다(스윕은 이 변화를 못 잡는다).
                if (outcomes.any { it.result == PushSendResult.REJECTED }) {
                    store.notifyChanged()
                }
            } catch (e: ApiError) {
                // 400(형식)·502(이 배포에 전송기가 없다) 모두 사용자가 할 일은 같다.
                // FCM의 일시적 실패는 여기로 오지 않는다 — 그 줄의 `FAILED`다.
                _state.update { it.copy(sending = false, failed = true) }
            }
        }
    }
}
