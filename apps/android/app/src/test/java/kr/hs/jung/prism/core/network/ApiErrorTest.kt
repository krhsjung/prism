package kr.hs.jung.prism.core.network

import kr.hs.jung.prism.domain.model.AuthErrorCode
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 갱신할 값어치가 있는 401만 세션 만료로 본다 — 이 판단은 서버만 내릴 수 있어 코드로
 * 받아 본다. (messageRes 매핑은 R.string 해석이 필요해 계측 테스트/화면에서 확인한다.)
 */
class ApiErrorTest {
    @Test
    fun `only session-expired 401 is refreshable`() {
        assertTrue(ApiError(401, AuthErrorCode.SESSION_EXPIRED).isSessionExpired)
    }

    @Test
    fun `other 401 reasons are not refreshable`() {
        // 자격증명이 없거나 폐기된 세션은 갱신해도 같은 이유로 실패한다.
        assertFalse(ApiError(401, AuthErrorCode.UNAUTHORIZED).isSessionExpired)
    }

    @Test
    fun `session-expired code on non-401 is not refreshable`() {
        assertFalse(ApiError(500, AuthErrorCode.SESSION_EXPIRED).isSessionExpired)
    }

    // 쿠키를 지울지(확정 실패) vs 보존할지(일시적 실패)를 가르는 기준.
    @Test
    fun `only server-confirmed 401 clears the session`() {
        assertTrue(ApiError(401, AuthErrorCode.INVALID_TOKEN).isDefinitiveAuthFailure)
        assertTrue(ApiError(401, AuthErrorCode.UNAUTHORIZED).isDefinitiveAuthFailure)
        // 갱신하면 살아나는 401은 확정 실패가 아니다.
        assertFalse(ApiError(401, AuthErrorCode.SESSION_EXPIRED).isDefinitiveAuthFailure)
        // 일시적 실패 — 오프라인·타임아웃·5xx는 쿠키를 보존해야 한다.
        assertFalse(ApiError.network.isDefinitiveAuthFailure)
        assertFalse(ApiError(503, "SERVER").isDefinitiveAuthFailure)
    }
}
