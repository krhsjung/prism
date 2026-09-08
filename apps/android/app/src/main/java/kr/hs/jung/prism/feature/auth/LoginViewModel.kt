package kr.hs.jung.prism.feature.auth

import android.app.Activity
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.util.AppLog

/**
 * 로그인 화면 상태.
 *
 * 화면이 아는 것은 둘뿐이다: 지금 어느 버튼이 진행 중인가(`pending`), 그리고 오류를
 * 무엇으로 그릴 것인가(`errorRes`). 같은 provider가 native/redirect 두 버튼으로 나오므로,
 * `pending`은 provider가 아니라 [AuthOption](provider+method)이어야 눌린 버튼만 표시된다.
 * 오류는 문구가 아니라 **리소스 id**로 들고 있어, 언어를 바꾸면 화면에 떠 있는 오류도
 * 함께 바뀐다(문구를 담아두면 그 오류만 이전 언어로 남는다).
 */
data class LoginUiState(
    val pending: AuthOption? = null,
    @param:StringRes val errorRes: Int? = null,
    /**
     * 알림 권한의 상태. **로그인 전에 묻는 이유는 등록 토큰이 로그인 요청에 실려야
     * 세션 안으로 들어가기 때문이다**(plan/push.md §5-2).
     */
) {
    val isBusy: Boolean get() = pending != null
}

/** 로그인 화면이 알림에 대해 말할 수 있는 갈래. */
enum class PushPermission {
    /** 설정이 없는 빌드(google-services.json 없음) — 물어도 소용이 없다. */
    UNSUPPORTED,

    /** 아직 안 물었다 — 누를 수 있는 줄을 보여 준다. */
    ASKABLE,

    GRANTED,

    /** 사용자가 막았다. **다시 물을 수 없다** — 설정으로 안내한다. */
    DENIED,
}

class LoginViewModel(
    private val authManager: AuthManager,
) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    private var job: Job? = null



    // SDK UI(native)·브라우저 탭(redirect)은 Activity가 있어야 뜬다(데모 native만 null 허용).
    fun signIn(option: AuthOption, activity: Activity? = null) {
        if (_state.value.pending != null) return
        _state.update { it.copy(pending = option, errorRes = null) }

        job = viewModelScope.launch {
            try {
                authManager.signIn(option.provider, option.method, activity)
                // 성공하면 화면 전환은 AuthManager.state를 보는 쪽이 한다 —
                // 여기서 화면을 밀면 세션의 진실이 두 곳에 생긴다.
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiError) {
                _state.update { it.copy(errorRes = e.messageRes) }
            } catch (e: Exception) {
                // 예외 객체(SDK Throwable일 수 있음)는 남기지 않는다 — 카테고리만.
                AppLog.e("unexpected sign-in failure")
                _state.update { it.copy(errorRes = R.string.error_generic) }
            } finally {
                _state.update { it.copy(pending = null) }
            }
        }
    }
}
