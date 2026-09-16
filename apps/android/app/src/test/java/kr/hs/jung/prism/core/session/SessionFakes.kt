package kr.hs.jung.prism.core.session

import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.domain.model.DeviceKind
import kr.hs.jung.prism.domain.model.SessionListItem

/**
 * 세션 목록을 쓰는 테스트들이 나눠 쓰는 가짜들.
 *
 * 목록이 한 자리로 모인 뒤로는 store와 화면 둘 다 같은 것을 필요로 한다 — 파일마다
 * 다시 쓰면 그 순간부터 조금씩 달라진다(그것이 이 리팩터링이 지우려던 문제다).
 */
internal fun sessionItem(
    id: String,
    current: Boolean = false,
    device: DeviceKind = DeviceKind.MAC,
    pushRegistered: Boolean = false,
) = SessionListItem(
    id = id,
    startedAt = "2026-01-01T00:00:00.000Z",
    expiresAt = "2026-01-01T12:00:00.000Z",
    isCurrent = current,
    device = device,
    pushRegistered = pushRegistered,
)

/** 인메모리 토큰. 세션 목록은 저장하지 않고 읽기만 한다. */
internal class FakeTokens(private val token: String? = "tok") : SessionTokens {
    override fun hasAny(): Boolean = token != null
    override fun access(): String? = token
    override fun refresh(): String? = null
    override fun save(access: String, refresh: String) {}
    override fun clear() {}
}

internal class FakeSessionsApi(
    var items: List<SessionListItem> = emptyList(),
    var failList: Boolean = false,
    var failAction: Boolean = false,
) : SessionsApi {
    val revoked = mutableListOf<String>()
    var revokeAllCount = 0

    /** 목록 조회가 **배경**으로 불렸는지(소켓이 시킨 재조회인지) — 유휴 창이 여기서 갈린다. */
    val listBackgrounds = mutableListOf<Boolean>()

    override suspend fun list(accessToken: String, background: Boolean): List<SessionListItem> {
        listBackgrounds += background
        if (failList) throw ApiError.network
        return items
    }

    override suspend fun revoke(accessToken: String, id: String) {
        if (failAction) throw ApiError.network
        revoked += id
        items = items.filterNot { it.id == id }
    }

    override suspend fun revokeAll(accessToken: String) {
        if (failAction) throw ApiError.network
        revokeAllCount++
    }
}
