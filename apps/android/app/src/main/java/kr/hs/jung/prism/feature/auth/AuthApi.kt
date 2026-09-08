package kr.hs.jung.prism.feature.auth

import kr.hs.jung.prism.core.network.ApiClient
import kr.hs.jung.prism.core.network.decodeAuthSession
import kr.hs.jung.prism.core.network.decodeSessionUser
import kr.hs.jung.prism.domain.model.AuthSession
import kr.hs.jung.prism.domain.model.SessionUser
import org.json.JSONObject

/**
 * 네이티브(Bearer) 흐름 인증 API의 계약 — 쿠키가 아니라 Bearer 토큰으로 인증한다.
 *
 * `AuthManager`는 구체 타입이 아니라 이 인터페이스에 의존해, 테스트에서 네트워크 없이
 * 가짜 응답을 주입할 수 있다(동시성·세션 로직을 결정적으로 검증). 모든 네이티브 로그인
 * (소셜·데모)이 서버에서 토큰을 body로 받아 안전 저장소에 담는 하나의 경로를 쓴다 —
 * 쿠키 흐름은 웹 전용이라 앱에는 두지 않는다(iOS와 동일).
 */
interface NativeAuthApi {
    // ⚠️ 세 경로 모두 `pushToken`을 받는다. **등록 토큰은 로그인 시점에만 세션에 실린다**
    // (plan/push.md §5-2) — 살아 있는 세션 레코드를 고치는 경로를 두지 않기로 했기
    // 때문이다. null이면 그 세션은 재로그인 전까지 푸시 대상이 아니고, 목록에
    // `Notifications off`로 정직하게 보인다.

    /** Google 네이티브 로그인 — SDK가 준 id_token을 서버가 검증하고 세션을 발급한다. */
    suspend fun googleNative(idToken: String, pushToken: String? = null): AuthSession

    /** Kakao 네이티브 로그인 — SDK가 준 access token으로 서버가 세션을 발급한다. */
    suspend fun kakaoNative(accessToken: String, pushToken: String? = null): AuthSession

    /** 데모 로그인 — 서버가 시드 계정으로 바로 세션을 발급한다(SDK·입력 없음). */
    suspend fun demoNative(pushToken: String? = null): AuthSession

    /**
     * 웹 redirect(flow=native) 로그인의 일회용 코드를 세션으로 교환한다.
     * 브라우저 탭이 커스텀 스킴으로 돌려준 코드를 여기 보내면 서버가 토큰을 발급한다.
     * 코드는 1회용(서버 GETDEL)이라 두 번째 교환은 실패한다.
     */
    suspend fun exchangeNative(code: String): AuthSession

    /** Bearer 세션 확인 + 사용자 정보. */
    suspend fun meBearer(accessToken: String): SessionUser

    /**
     * Bearer 세션의 자격증명 회전(refresh token을 body로 보낸다 → 새 토큰).
     *
     * @param activity 이 회전을 **사용자가 시켰는가**(앱 복원). 참이면 서버가 회전 뒤
     *   유휴 창도 민다 — 복원은 이 요청으로 끝나 다시 보호된 요청을 보내지 않는다.
     */
    suspend fun refreshBearer(refreshToken: String, activity: Boolean = false): AuthSession

    /** Bearer 세션 로그아웃(최선 노력). 이후 토큰은 로컬에서 폐기한다. */
    suspend fun logoutBearer(accessToken: String)

    /** 미설정(SDK/서버 경로 없음)일 때의 기본 — 네이티브 경로를 막는다. */
    object Unavailable : NativeAuthApi {
        override suspend fun googleNative(idToken: String, pushToken: String?) =
            throw kr.hs.jung.prism.core.network.ApiError.providerUnavailable
        override suspend fun kakaoNative(accessToken: String, pushToken: String?) =
            throw kr.hs.jung.prism.core.network.ApiError.providerUnavailable
        override suspend fun demoNative(pushToken: String?) =
            throw kr.hs.jung.prism.core.network.ApiError.providerUnavailable
        override suspend fun exchangeNative(code: String) =
            throw kr.hs.jung.prism.core.network.ApiError.providerUnavailable
        override suspend fun meBearer(accessToken: String) =
            throw kr.hs.jung.prism.core.network.ApiError.providerUnavailable
        override suspend fun refreshBearer(refreshToken: String, activity: Boolean) =
            throw kr.hs.jung.prism.core.network.ApiError.providerUnavailable
        override suspend fun logoutBearer(accessToken: String) =
            throw kr.hs.jung.prism.core.network.ApiError.providerUnavailable
    }
}

/**
 * 인증 API 호출. 서버 계약을 그대로 옮긴 얇은 층이고, 상태는 갖지 않는다
 * (상태는 AuthManager가, 화면 사정은 ViewModel이 안다).
 *
 * 모든 경로가 **네이티브(Bearer)** 흐름이다 — 세션을 토큰으로 주고받고 쿠키를 쓰지 않는다.
 * 서버가 세션을 body(AuthSession)로 주면 AuthManager가 안전 저장소(Keystore)에 담는다.
 */
class HttpAuthApi(private val client: ApiClient) : NativeAuthApi {

    override suspend fun googleNative(idToken: String, pushToken: String?): AuthSession =
        decodeAuthSession(
            client.request(
                "POST",
                "/auth/google/native",
                body("idToken" to idToken, pushToken = pushToken),
            ),
        )

    override suspend fun kakaoNative(accessToken: String, pushToken: String?): AuthSession =
        decodeAuthSession(
            client.request(
                "POST",
                "/auth/kakao/native",
                body("accessToken" to accessToken, pushToken = pushToken),
            ),
        )

    /** 원클릭 데모 로그인. 웹 `/auth/demo`(쿠키)와 세션은 같고, 전달만 다르다 — 토큰을 body로. */
    override suspend fun demoNative(pushToken: String?): AuthSession =
        decodeAuthSession(
            client.request("POST", "/auth/demo/native", body(pushToken = pushToken)),
        )

    override suspend fun exchangeNative(code: String): AuthSession =
        decodeAuthSession(
            client.request("POST", "/auth/native/exchange", body(("code" to code))),
        )

    // 401의 뒷일은 AuthManager가 정한다 — 이 두 호출은 그쪽이 **락을 쥔 채로** 하므로,
    // 여기서 전송 계층이 갱신·종료를 부르면 그 락에서 교착한다.
    override suspend fun meBearer(accessToken: String): SessionUser =
        decodeSessionUser(
            client.request(
                "GET",
                "/auth/me",
                accessToken = accessToken,
                recoverSession = false,
            ),
        )

    /** body의 refresh token으로 회전하면 서버는 새 토큰을 담은 AuthSession을 돌려준다. */
    override suspend fun refreshBearer(refreshToken: String, activity: Boolean): AuthSession =
        decodeAuthSession(
            client.request(
                "POST",
                "/auth/refresh",
                body(("refreshToken" to refreshToken)),
                // 표시는 `background`의 반대다 — 활동이면 붙는다.
                background = !activity,
            ),
        )

    override suspend fun logoutBearer(accessToken: String) {
        client.requestIgnoringBody(
            "POST",
            "/auth/logout",
            accessToken = accessToken,
            recoverSession = false,
        )
    }

    /** 단일 필드 JSON body. org.json으로 안전하게 이스케이프한다(수동 문자열 조합 금지). */
    /**
     * 요청 body 한 줄. 등록 토큰은 **있을 때만** 싣는다 — 없는 필드와 빈 문자열은
     * 서버에서 같은 뜻이지만(둘 다 등록 없음), 없는 쪽이 의도가 분명하다.
     */
    private fun body(field: Pair<String, String>? = null, pushToken: String? = null): String =
        JSONObject()
            .apply { field?.let { put(it.first, it.second) } }
            .apply { pushToken?.let { put("pushToken", it) } }
            .toString()
}
