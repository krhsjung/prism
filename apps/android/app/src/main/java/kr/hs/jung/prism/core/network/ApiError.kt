package kr.hs.jung.prism.core.network

import kr.hs.jung.prism.R
import kr.hs.jung.prism.domain.model.AppErrorCode
import kr.hs.jung.prism.domain.model.AuthErrorCode
import kr.hs.jung.prism.domain.model.ClientErrorCode

/**
 * API 호출 실패. 코드는 계약의 오류 코드 문자열이며, 화면은 이 코드를 문구로 옮긴다.
 *
 * 웹의 `ApiError`(apps/web/src/lib/api.ts)와 같은 모양이다 — 오류를 문구가 아니라
 * **코드**로 들고 다니는 이유도 같다: 화면 언어가 바뀌면 이미 떠 있는 오류도 함께
 * 바뀌어야 하는데, 문구를 담아 두면 그 오류만 이전 언어로 남는다.
 */
class ApiError(
    /** HTTP 상태 코드. 요청이 나가지도 못했으면 0. */
    val status: Int,
    /** `AuthErrorCode` 또는 `ClientErrorCode`의 값. */
    val code: String,
) : Exception(code) {

    /** 갱신하면 살아나는 401인가 — 이 판단은 서버만 내릴 수 있어 코드로 받아 본다. */
    val isSessionExpired: Boolean
        get() = status == 401 && code == AuthErrorCode.SESSION_EXPIRED

    /**
     * 서버가 "이 세션은 못 쓴다"고 **확정한** 실패인가.
     *
     * 세션 복원·갱신 실패에서 쿠키를 지울지 가르는 기준이다. 여기 해당할 때만 지운다 —
     * 폐기됐거나(UNAUTHORIZED, 재사용 탐지 포함) 변조된(INVALID_TOKEN) 401이다.
     * 오프라인·타임아웃·5xx·형식 오류 같은 일시적 실패는 여기 들지 않으므로 쿠키를
     * 보존하고 다음 시도에서 복구한다(웹 api.ts·iOS AuthManager와 같은 규칙).
     */
    val isDefinitiveAuthFailure: Boolean
        get() = status == 401 &&
            (code == AuthErrorCode.INVALID_TOKEN || code == AuthErrorCode.UNAUTHORIZED)

    /**
     * 오류를 화면에 그릴 문자열 리소스로 옮긴다.
     * 모르는 코드는 일반 메시지로 떨어뜨린다 — 서버가 새 코드를 내보내도 화면은 깨지지
     * 않고, 문구가 필요해지면 그때 여기에 한 줄을 더한다(웹 LoginPage의 ERROR_KEYS와 동형).
     */
    val messageRes: Int
        get() = when (code) {
            AuthErrorCode.SIGNIN_FAILED -> R.string.error_signin_failed
            AuthErrorCode.DEMO_DISABLED -> R.string.error_demo_disabled
            ClientErrorCode.NETWORK_ERROR -> R.string.error_network_error
            AppErrorCode.PROVIDER_UNAVAILABLE -> R.string.error_provider_unavailable
            else -> R.string.error_generic
        }

    companion object {
        val network = ApiError(0, ClientErrorCode.NETWORK_ERROR)
        val invalidResponse = ApiError(0, ClientErrorCode.INVALID_RESPONSE)
        val providerUnavailable = ApiError(0, AppErrorCode.PROVIDER_UNAVAILABLE)
    }
}
