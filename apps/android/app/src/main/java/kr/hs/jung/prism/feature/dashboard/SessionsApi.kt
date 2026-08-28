package kr.hs.jung.prism.feature.dashboard

import kr.hs.jung.prism.core.network.ApiClient
import kr.hs.jung.prism.core.network.decodeSessionList
import kr.hs.jung.prism.domain.model.SessionListItem

/**
 * 활성 세션 API의 계약 — 전부 Bearer로 인증한다(plan/dashboard.md §5).
 *
 * `AuthManager`와 같은 이유로 인터페이스를 둔다: 화면 로직을 네트워크 없이 테스트할 수
 * 있어야 하고, 세션 목록·폐기는 결과가 파괴적이라 가짜 구현으로 검증하는 편이 안전하다.
 */
interface SessionsApi {
    /** 내 활성 세션 목록. 현재 세션은 서버가 `isCurrent`로 표시해 준다. */
    /**
     * @param background **소켓이 시킨** 재조회인가 — 그 경우 이 요청 때문에 도는 회전이
     *   세션의 유휴 창을 밀지 않는다(plan/auth.md §6).
     */
    suspend fun list(accessToken: String, background: Boolean = false): List<SessionListItem>

    /** 세션 하나를 원격 폐기한다. 현재 세션을 지우면 이 앱의 토큰도 곧 무효가 된다. */
    suspend fun revoke(accessToken: String, id: String)

    /** 내 모든 세션을 폐기한다 — 현재 세션까지 포함한다. */
    suspend fun revokeAll(accessToken: String)
}

/** 서버 계약을 그대로 옮긴 얇은 층. 상태는 갖지 않는다. */
class HttpSessionsApi(private val client: ApiClient) : SessionsApi {

    override suspend fun list(accessToken: String, background: Boolean): List<SessionListItem> =
        decodeSessionList(
            client.request(
                "GET",
                "/auth/sessions",
                accessToken = accessToken,
                background = background,
            ),
        )

    override suspend fun revoke(accessToken: String, id: String) {
        // 세션 id는 경로에 들어간다 — 서버가 준 값만 되돌려 보내므로 그대로 쓴다.
        client.requestIgnoringBody(
            "POST",
            "/auth/sessions/$id/revoke",
            accessToken = accessToken,
        )
    }

    override suspend fun revokeAll(accessToken: String) {
        client.requestIgnoringBody("POST", "/auth/sessions/revoke-all", accessToken = accessToken)
    }
}
