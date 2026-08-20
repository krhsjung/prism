package kr.hs.jung.prism.core.security

/**
 * 네이티브(Bearer) 세션의 토큰 저장소.
 *
 * 모든 로그인(소셜·데모)이 서버에서 토큰을 body(AuthSession)로 받아 Bearer로 유지한다
 * (쿠키를 쓰지 않는다, plan/auth.md §6). `AuthManager`가 구체 저장소가 아니라 이
 * 인터페이스에 의존해, 테스트에서 인메모리 가짜로 갈아 끼운다.
 */
interface SessionTokens {
    /** 저장된 Bearer 세션이 있는가 — 복원을 쿠키가 아니라 Bearer로 시도할지 가른다. */
    fun hasAny(): Boolean
    fun access(): String?
    fun refresh(): String?
    fun save(access: String, refresh: String)
    fun clear()

    /** 저장된 세션이 없는 기본(예: 로그인 로직만 검증하는 테스트) — 항상 비어 있다. */
    object None : SessionTokens {
        override fun hasAny(): Boolean = false
        override fun access(): String? = null
        override fun refresh(): String? = null
        override fun save(access: String, refresh: String) {}
        override fun clear() {}
    }
}

/**
 * Bearer 토큰을 [SecureStore](Keystore 기반 EncryptedSharedPreferences)에 담는 구현.
 * 쿠키와 같은 저장 위치 보안 요건을 지킨다 — 평문 SharedPreferences 금지(plan/auth.md §6).
 */
class SecureSessionTokens(private val store: SecureStore) : SessionTokens {
    override fun hasAny(): Boolean = store.getString(ACCESS) != null
    override fun access(): String? = store.getString(ACCESS)
    override fun refresh(): String? = store.getString(REFRESH)

    override fun save(access: String, refresh: String) {
        store.putString(ACCESS, access)
        store.putString(REFRESH, refresh)
    }

    override fun clear() {
        store.remove(ACCESS)
        store.remove(REFRESH)
    }

    private companion object {
        const val ACCESS = "session.access"
        const val REFRESH = "session.refresh"
    }
}
