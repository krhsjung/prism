package kr.hs.jung.prism.feature.dashboard

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.session.SessionStore
import kr.hs.jung.prism.core.session.SessionsApi
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.util.AppLog

/**
 * 활성 세션 카드에서 **할 수 있는 일**의 상태 — 해제와 전체 로그아웃.
 *
 * 목록은 여기 없다. 그것은 통화·푸시 화면과 같은 것이고 `SessionStore`가 세션에 하나만
 * 들고 있다 — 화면마다 따로 들고 있으면 화면마다 신선도가 갈린다
 * (core/session/SessionStore.kt). 오류는 문구가 아니라 리소스 id로 들고 있어, 언어를
 * 바꾸면 화면에 떠 있는 오류도 함께 바뀐다(로그인 화면과 같은 규칙).
 */
data class DashboardUiState(
    @param:StringRes val actionErrorRes: Int? = null,
    /** 지금 해제 중인 세션 id — 그 행의 버튼만 잠근다. */
    val revokingId: String? = null,
    val signingOutAll: Boolean = false,
)

/**
 * 대시보드에서 세션 목록을 **바꾸는 쪽**을 쥔다.
 *
 * 세션 목록은 **서버만 안다** — 앱은 자기 세션 id조차 모른다(토큰 안에만 있다). 그래서
 * 폐기 결과도 로컬 추측이 아니라 응답으로 확정한다: 바꾼 뒤에는 [store]에 다시 묻는다.
 *
 * [onSessionEnded]는 "이 앱의 세션이 방금 끝났다"를 알리는 콜백이다. 전체 로그아웃은
 * 현재 세션까지 지우므로, 화면이 스스로 로그인 화면으로 돌아가는 대신 세션의 주인
 * (`AuthManager`)에게 넘긴다 — 세션 상태의 진실이 두 곳에 생기지 않게.
 */
class DashboardViewModel(
    private val api: SessionsApi,
    private val tokens: SessionTokens,
    /** 바꾼 뒤 다시 물어볼 곳 — 목록의 주인이다. */
    private val store: SessionStore,
    private val onSessionEnded: suspend () -> Unit,
) : ViewModel() {

    private val _state = MutableStateFlow(DashboardUiState())
    val state: StateFlow<DashboardUiState> = _state.asStateFlow()

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
                store.notifyChanged()
                val current =
                    store.state.value.sessions?.firstOrNull { it.id == id }?.isCurrent == true
                if (current) {
                    // 내 세션을 내가 지웠다 — 토큰은 이미 무효다. 세션의 주인에게 넘긴다.
                    onSessionEnded()
                    return@launch
                }
                _state.update { it.copy(revokingId = null) }
                store.refresh()
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
                store.notifyChanged()
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
