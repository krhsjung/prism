package kr.hs.jung.prism.feature.dashboard

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.network.SessionSocket
import kr.hs.jung.prism.domain.model.SessionClientMessageType
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.util.AppLog
import kr.hs.jung.prism.domain.model.SessionListItem

/**
 * 활성 세션 카드의 상태.
 *
 * [sessions]가 `null`이면 아직 불러오는 중이다 — "비어 있음"과 구분해야 한다. 현재
 * 세션은 항상 하나 존재하므로 **진짜 빈 목록은 없고**, 1개짜리 목록이 "나 혼자"다
 * (plan/dashboard.md §3.2). 오류는 문구가 아니라 리소스 id로 들고 있어, 언어를 바꾸면
 * 화면에 떠 있는 오류도 함께 바뀐다(로그인 화면과 같은 규칙).
 */
data class DashboardUiState(
    val sessions: List<SessionListItem>? = null,
    @param:StringRes val loadErrorRes: Int? = null,
    @param:StringRes val actionErrorRes: Int? = null,
    /** 지금 해제 중인 세션 id — 그 행의 버튼만 잠근다. */
    val revokingId: String? = null,
    val signingOutAll: Boolean = false,
    /** 당겨서 새로고침이 도는 중 — 목록은 그대로 두고 인디케이터만 돈다. */
    val refreshing: Boolean = false,
    /**
     * 내 소켓이 붙어 있는가.
     *
     * 배지는 이 값이 true일 때만 [SessionListItem.isConnected]를 믿는다. 붙어 있지
     * 않으면 서버가 내려준 빈 presence가 "아무도 안 붙었다"인지 "소켓 서비스가 죽었다"인지
     * 구별할 수 없고, 후자를 전자로 읽으면 멀쩡한 기기들을 전부 "비활성"이라고 지어내게 된다.
     */
    val socketReady: Boolean = false,
) {
    /** 나 말고 다른 세션이 있을 때만 "모두 로그아웃"이 의미가 있다. */
    val hasOthers: Boolean get() = (sessions?.size ?: 0) > 1
}

/**
 * 대시보드 화면의 상태를 쥔다.
 *
 * 세션 목록은 **서버만 안다** — 앱은 자기 세션 id조차 모른다(토큰 안에만 있다). 그래서
 * 화면을 그릴 때마다 서버에 묻고, 폐기 결과도 로컬 추측이 아니라 응답으로 확정한다.
 *
 * [onSessionEnded]는 "이 앱의 세션이 방금 끝났다"를 알리는 콜백이다. 전체 로그아웃은
 * 현재 세션까지 지우므로, 화면이 스스로 로그인 화면으로 돌아가는 대신 세션의 주인
 * (`AuthManager`)에게 넘긴다 — 세션 상태의 진실이 두 곳에 생기지 않게.
 */
class DashboardViewModel(
    private val api: SessionsApi,
    private val tokens: SessionTokens,
    private val onSessionEnded: suspend () -> Unit,
    /**
     * 세션 소켓. **이 ViewModel이 소유한다** — 수명이 `SessionScope`(세션 세대)에 묶여
     * 있어 재로그인하면 함께 버려진다. ServiceContainer에 두면 컨테이너가 앱과 함께 살아
     * 세션 N이 연 소켓이 세션 N+1까지 살아남는다.
     */
    private val socket: SessionSocket? = null,
) : ViewModel() {

    private val _state = MutableStateFlow(DashboardUiState())
    val state: StateFlow<DashboardUiState> = _state.asStateFlow()

    init {
        load()
        socket?.let { observe(it) }
    }

    /**
     * 소켓은 **신호만** 준다 — 목록은 아래 [refresh]가 기존 HTTP 경로로 다시 가져온다.
     * 그 경로에만 스탬핑·공유 회전·확정 거절 처리가 붙어 있기 때문이다.
     */
    private fun observe(socket: SessionSocket) {
        socket.start(viewModelScope)
        viewModelScope.launch {
            socket.isReady.collect { ready -> _state.update { it.copy(socketReady = ready) } }
        }
        viewModelScope.launch {
            // 0에서 시작하고 소켓의 첫 ready가 1로 올린다 — init의 load()와 겹치지 않게
            // 첫 값은 건너뛴다.
            socket.changed.drop(1).collect {
                // **비우지 않는다**(load가 아니라 refresh) — 다른 기기가 하나 붙었다고
                // 카드가 "불러오는 중"으로 접혔다 펴지면 목록 전체가 깜빡인다.
                //
                // 소켓이 시킨 재조회다 — 사용자가 한 일이 아니므로 유휴 창을 밀지 않는다.
                refresh(background = true)
            }
        }
    }

    /**
     * 목록을 **비우고** 다시 불러온다 — 처음 그릴 때와 재시도가 쓴다. 화면에 아직 아무것도
     * 없거나, 있던 것이 틀렸다고 판명된 자리다.
     */
    fun load() {
        _state.update { it.copy(sessions = null) }
        refresh()
    }

    /**
     * 화면에 있는 목록을 **지우지 않고** 갱신한다 — 해제 직후처럼 이미 목록이 떠 있는
     * 자리가 쓴다.
     *
     * 여기서 비우면 카드가 "불러오는 중"으로 접혔다가 다시 펴지며 화면이 통째로 흔들린다.
     * 사라질 행은 하나인데 목록 전체가 깜빡이는 셈이다.
     */
    fun refresh(background: Boolean = false) {
        viewModelScope.launch { fetch(background) }
    }

    /**
     * 당겨서 새로고침. 갱신 자체는 [refresh]와 같고, **인디케이터가 도는 동안을 알린다**는
     * 것만 다르다 — 사용자가 스스로 당긴 동작이라 "받았다"는 신호가 있어야 하고, 그 신호를
     * 목록을 비워서 내면 화면이 흔들린다.
     */
    fun pullRefresh() {
        if (_state.value.refreshing) return
        _state.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            try {
                fetch()
            } finally {
                // 실패해도 인디케이터는 반드시 멈춘다 — 돌기만 하면 사용자가 할 수 있는
                // 일이 없다(오류는 카드 안에 남는다).
                _state.update { it.copy(refreshing = false) }
            }
        }
    }

    /** 목록을 한 번 읽어 상태에 반영한다. 비우기·인디케이터는 부르는 쪽이 정한다. */
    /**
     * @param background **소켓이 시킨** 재조회인가. 그렇다면 이 요청 때문에 도는 회전이
     *   세션의 유휴 창을 밀지 않는다 — 사용자가 한 일이 아니기 때문이다(plan/auth.md §6).
     *   화면 진입·당겨 새로고침·해제 뒤의 갱신은 활동이므로 기본값이다.
     */
    private suspend fun fetch(background: Boolean = false) {
        _state.update { it.copy(loadErrorRes = null) }
        val token = tokens.access()
        if (token == null) {
            // 토큰이 없으면 목록을 물을 수 없다. 세션 복원이 곧 로그인 화면으로 보낸다.
            _state.update { it.copy(loadErrorRes = R.string.error_sessions_load_failed) }
            return
        }
        try {
            val list = api.list(token, background)
            _state.update { it.copy(sessions = list) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError) {
            AppLog.d("sessions load failed")
            _state.update { it.copy(loadErrorRes = R.string.error_sessions_load_failed) }
        }
    }

    /**
     * 세션 하나를 해제한다.
     *
     * 성공하면 목록을 **다시 불러온다** — 로컬에서 그 행만 지우면 서버가 아는 목록과
     * 어긋날 수 있다(그 사이 다른 기기에서 로그인·만료가 일어난다).
     */
    fun revoke(id: String) {
        if (_state.value.revokingId != null || _state.value.signingOutAll) return
        _state.update { it.copy(revokingId = id, actionErrorRes = null) }
        viewModelScope.launch {
            val token = tokens.access()
            try {
                if (token == null) throw ApiError.invalidResponse
                api.revoke(token, id)
                // **끊긴 기기가 서버의 스윕을 기다리지 않게 한다.** 폐기는 auth 서비스가
                // 처리하고 socket 서비스는 그 사실을 전달받는 통로가 없다 — 소켓은 이미
                // 붙어 있으니 우리가 깨워 준다(서버는 믿지 않고 세션 저장소를 다시 읽는다).
                socket?.send(SessionClientMessageType.SESSIONS_REVOKED)
                val current = _state.value.sessions?.firstOrNull { it.id == id }?.isCurrent == true
                if (current) {
                    // 내 세션을 내가 지웠다 — 토큰은 이미 무효다. 세션의 주인에게 넘긴다.
                    onSessionEnded()
                    return@launch
                }
                _state.update { it.copy(revokingId = null) }
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiError) {
                AppLog.d("session revoke failed")
                _state.update {
                    it.copy(revokingId = null, actionErrorRes = R.string.error_revoke_failed)
                }
            }
        }
    }

    /** 내 모든 세션을 폐기한다 — 현재 세션도 사라지므로 끝나면 로그인 화면으로 간다. */
    fun signOutAll() {
        if (_state.value.signingOutAll) return
        _state.update { it.copy(signingOutAll = true, actionErrorRes = null) }
        viewModelScope.launch {
            val token = tokens.access()
            try {
                if (token == null) throw ApiError.invalidResponse
                api.revokeAll(token)
                // 전체 폐기도 같다 — 다만 이 요청은 내 세션까지 끝내므로 곧 로그인
                // 화면으로 간다. 그 전에 다른 기기들이 즉시 쫓겨나게 해 둔다.
                socket?.send(SessionClientMessageType.SESSIONS_REVOKED)
                onSessionEnded()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiError) {
                AppLog.d("sign out all failed")
                _state.update {
                    it.copy(signingOutAll = false, actionErrorRes = R.string.error_revoke_failed)
                }
            }
        }
    }
}
