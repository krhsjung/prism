package kr.hs.jung.prism.domain.model

import kr.hs.jung.prism.R

// 서버와 공유하는 API 계약의 Android 사본.
//
// `AuthErrorCode`·`ClientErrorCode`·`AUTH_PROVIDERS`는 서버 계약에서 **생성**된다
// (Contracts.gen.kt, `pnpm gen:contracts`). 오류 코드 문자열이 서버에서 바뀌면 그쪽만
// 고치면 되고, 어긋나면 `--check` 드리프트 가드가 잡는다. 아래는 플랫폼별로 형태가
// 안정적인 모델·UI 열거형·앱 전용 코드라 손으로 유지한다.

/** 로그인 수단. `demo`는 OAuth가 아니라 시드된 데모 계정이다(plan/auth.md §2.1-b). */
enum class AuthProvider(val labelRes: Int) {
    GOOGLE(R.string.auth_continue_with_google),
    APPLE(R.string.auth_continue_with_apple),
    KAKAO(R.string.auth_continue_with_kakao),
    DEMO(R.string.auth_try_the_demo),
}

/**
 * 클라이언트에 반환되는 사용자 모델.
 * 개인정보 미저장 정책에 따라 email이 없고, `displayName`은 DB가 아니라 세션에서 온다.
 */
data class User(
    val id: String,
    val provider: String,
    val displayName: String,
    val createdAt: String,
)

/** 쿠키 흐름(웹·Android 데모)의 로그인·세션 확인 응답. 토큰을 담지 않는다. */
data class SessionUser(
    val user: User,
    val accessTokenTtlMs: Long,
)

/**
 * 네이티브(Bearer) 흐름의 로그인·갱신 응답 — `POST /auth/{google|kakao}/native`,
 * 그리고 자격증명을 body로 보낸 `POST /auth/refresh`.
 *
 * 쿠키 흐름과 달리 토큰을 body로 받는다: 네이티브는 쿠키 저장소가 부자연스러워 Bearer를
 * 유지하고 안전한 저장소(Keystore 기반 SecureStore)에 담는다(plan/auth.md §6·§5).
 */
data class AuthSession(
    val accessToken: String,
    val refreshToken: String,
    val user: User,
    /**
     * 액세스 토큰이 만료되기까지 남은 시간(ms).
     *
     * **선제 갱신을 언제 걸지** 정하는 데 쓴다. 앱은 토큰을 열어 보지 않으므로 만료
     * 시각을 알 방법이 이것뿐이다. 토큰이 아니라 수명값이라 body에 실려 온다.
     */
    val accessTokenTtlMs: Long,
)

/**
 * 내 세션 하나의 요약(`GET /auth/sessions`).
 *
 * **기기·위치를 알 수 있는 값이 없다.** 목록을 보기 좋게 만들자고 User-Agent나 IP를
 * 저장하면 개인정보 미저장 원칙이 깨진다(plan/dashboard.md §5) — 그래서 시안의
 * "MacBook Pro · Chrome · Seoul, KR" 자리에 화면은 짧은 세션 id를 그린다.
 *
 * [isCurrent]는 **서버가** 표시해 준다. 앱은 자기 세션 id를 알 방법이 없다 —
 * 세션 id는 액세스 토큰 안에만 있고 앱은 그 토큰을 열어 보지 않는다.
 */
data class SessionListItem(
    val id: String,
    val startedAt: String,
    val expiresAt: String,
    val isCurrent: Boolean,
    /** 이 세션을 만든 기기의 종류. 기기명·브라우저·위치는 계약에 없다(plan/dashboard.md §5). */
    val device: DeviceKind,
)

/** 서버 계약에 없는 **앱 전용** 코드 — 서버는 발신하지 않고 앱이 스스로 만든다. */
object AppErrorCode {
    /** 서버에 그 흐름의 네이티브 엔드포인트가 아직 없다(웹 전용 경로). */
    const val PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
}
