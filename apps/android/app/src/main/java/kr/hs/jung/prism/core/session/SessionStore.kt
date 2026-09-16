package kr.hs.jung.prism.core.session

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
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.util.AppLog
import kr.hs.jung.prism.domain.model.SessionClientMessageType
import kr.hs.jung.prism.domain.model.SessionListItem

/**
 * 내 활성 세션 목록 — **화면 셋이 나눠 쓰는 하나**.
 *
 * [sessions]가 `null`이면 아직 불러오는 중이다 — "비어 있음"과 구분해야 한다. 현재
 * 세션은 항상 하나 존재하므로 **진짜 빈 목록은 없고**, 1개짜리 목록이 "나 혼자"다
 * (plan/dashboard.md §3.2). 오류는 문구가 아니라 리소스 id로 들고 있어, 언어를 바꾸면
 * 화면에 떠 있는 오류도 함께 바뀐다(로그인 화면과 같은 규칙).
 */
data class SessionsUiState(
    val sessions: List<SessionListItem>? = null,
    @param:StringRes val loadErrorRes: Int? = null,
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
 * 세션 목록을 쥐고, 소켓이 "바뀌었다"고 할 때마다 다시 가져온다 — **이 자리 하나뿐이다.**
 *
 * 이 목록은 대시보드의 것이 아니다: 대시보드가 관리하고, 통화가 상대를 고르고, 푸시가
 * 대상을 고른다. 세 화면이 각자 조회하고 각자 신호를 듣던 때는 **화면마다 신선도가
 * 달랐다** — 대시보드와 통화 로비는 신호를 들었지만 푸시 화면은 듣지 않아, 다른 기기가
 * 로그인하거나 사라져도 그 화면만 낡은 채로 남았다. 화면을 하나 더 만들 때마다 같은
 * 규칙을 옮겨 적어야 하는 구조 자체가 그 버그의 원인이다.
 *
 * **수명은 세션이다.** `ui/SessionScope.kt`의 저장소에 살아 화면 전환에는 살아남고,
 * 로그아웃하면 소켓·통화와 함께 버려진다 — 다음 로그인이 앞 세션의 목록을 물려받지 않게.
 *
 * ⚠️ **소켓이 목록을 나르지는 않는다.** 신호를 받으면 여기서 기존 `GET /auth/sessions`를
 * 다시 부른다 — 스탬핑·공유 회전·확정 거절 처리가 전부 그 HTTP 경로에 있고, 소켓이
 * 목록을 직접 주입하면 그것을 통째로 우회한다(plan/auth.md §6.3).
 */
class SessionStore(
    private val api: SessionsApi,
    private val tokens: SessionTokens,
    /**
     * 세션 소켓 — 신호를 **듣고** 또 [notifyChanged]로 **보낸다**.
     *
     * **여기서 열지 않는다** — 수명은 세션의 것이고 그 자리는 `ui/RootScreen.kt`다.
     * 화면에 매달면 다른 화면을 보는 동안 내 기기가 스스로를 "비활성"으로 보고하게 된다.
     */
    private val socket: SessionSocket? = null,
) : ViewModel() {

    private val _state = MutableStateFlow(SessionsUiState())
    val state: StateFlow<SessionsUiState> = _state.asStateFlow()

    /**
     * 마지막으로 **출발한** 조회의 번호. 조회는 겹칠 수 있고(세션 시작의 첫 조회와 등록 뒤의
     * 재조회) 응답은 출발 순서대로 오지 않는다 — 옛 응답이 늦게 와서 새 응답을 덮으면 방금
     * 켠 등록이 화면에서 꺼진 것으로 보인다. 가장 늦게 출발한 조회만 쓴다.
     */
    private var latestRequest = 0

    init {
        load()
        socket?.let { observe(it) }
    }

    private fun observe(socket: SessionSocket) {
        viewModelScope.launch {
            socket.isReady.collect { ready -> _state.update { it.copy(socketReady = ready) } }
        }
        viewModelScope.launch {
            // 0에서 시작하고 소켓의 첫 ready가 1로 올린다 — init의 load()와 겹치지 않게
            // 첫 값은 건너뛴다.
            socket.changed.drop(1).collect {
                // **비우지 않는다**(load가 아니라 refresh) — 다른 기기가 하나 붙었다고
                // 목록이 "불러오는 중"으로 접혔다 펴지면 통째로 깜빡인다.
                //
                // 소켓이 시킨 재조회다 — 사용자가 한 일이 아니므로 유휴 창을 밀지 않는다.
                // 재연결의 첫 ready도 이 신호를 올리므로, 백그라운드를 다녀오는 동안
                // 놓친 변화가 복귀와 함께 따라온다(SessionSocket).
                refresh(background = true)
            }
        }
    }

    /**
     * **다른 기기에도 알린다** — 방금 HTTP로 내 세션 레코드를 고쳤다(해제 · 전체 해제 ·
     * 알림 등록/해제). 서버는 이 말을 믿지 않고 세션 저장소를 다시 읽은 뒤, 남은 기기에
     * `sessionsChanged`를 보낸다.
     *
     * **목록을 쥔 쪽이 이 일도 맡는다.** 바꾸는 화면마다 소켓을 따로 들고 있으면 어느
     * 화면은 알리고 어느 화면은 잊는다 — 알림 끄기가 실제로 그랬다(푸시 화면에는 소켓이
     * 없어, 끈 사실이 다른 기기의 목록에 **영영 닿지 않았다**).
     *
     * 소켓이 붙어 있지 않으면 나가지 않는다(큐에 쌓지도 않는다) — 다시 붙을 때 서버가
     * 업그레이드에서 세션을 검증한다.
     *
     * ⚠️ **그동안은 스윕도 못 메운다.** 서버의 스윕은 세션 **id 목록**을 지난 틱과
     * 대조하므로(`noticeExpiries`) 폐기처럼 구성원이 바뀌는 변화만 잡는다 — 알림
     * 등록/해제는 구성원이 그대로라 브로드캐스트가 나가지 않는다. 남은 기기는 자기가
     * 재연결할 때(첫 ready가 신호를 올린다) 비로소 맞는다.
     */
    fun notifyChanged() {
        socket?.send(SessionClientMessageType.SESSIONS_STALE)
    }

    /**
     * 목록을 **비우고** 다시 불러온다 — 세션이 시작될 때와 재시도가 쓴다. 화면에 아직
     * 아무것도 없거나, 있던 것이 틀렸다고 판명된 자리다.
     */
    fun load() {
        _state.update { it.copy(sessions = null) }
        refresh()
    }

    /**
     * 화면에 있는 목록을 **지우지 않고** 갱신한다 — 해제 직후·소켓 신호·당겨 새로고침이
     * 쓴다.
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

    /**
     * 목록을 한 번 읽어 상태에 반영한다. 비우기·인디케이터는 부르는 쪽이 정한다.
     *
     * @param background **내가 시킨 일이 아닌** 재조회인가(소켓 신호). 그렇다면 이 요청
     *   때문에 도는 회전이 세션의 유휴 창을 밀지 않는다 — 사용자가 한 일이 아니기
     *   때문이다(plan/auth.md §6). 화면 진입·당겨 새로고침·해제 뒤의 갱신은 활동이므로
     *   기본값이다.
     */
    private suspend fun fetch(background: Boolean = false) {
        _state.update { it.copy(loadErrorRes = null) }
        val token = tokens.access()
        if (token == null) {
            // 토큰이 없으면 목록을 물을 수 없다. 세션 복원이 곧 로그인 화면으로 보낸다.
            _state.update { it.copy(loadErrorRes = R.string.error_sessions_load_failed) }
            return
        }
        val request = ++latestRequest
        try {
            val list = api.list(token, background)
            // 그사이 더 새로운 조회가 출발했다면 이 응답은 낡았다 — 버린다.
            if (request != latestRequest) return
            _state.update { it.copy(sessions = list) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError) {
            if (request != latestRequest) return
            AppLog.d("sessions load failed")
            _state.update { it.copy(loadErrorRes = R.string.error_sessions_load_failed) }
        }
    }
}
