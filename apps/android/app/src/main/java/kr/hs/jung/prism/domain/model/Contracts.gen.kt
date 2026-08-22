package kr.hs.jung.prism.domain.model

// GENERATED FILE — DO NOT EDIT.
// 원본: apps/server/libs/common/src/types/contracts.ts
// 재생성: apps/server에서 `pnpm gen:contracts`

/** 서버가 오류 응답 body(`{ "error": "..." }`)로 주는 코드. */
object AuthErrorCode {
    const val SIGNIN_FAILED = "SIGNIN_FAILED"
    const val DEMO_DISABLED = "DEMO_DISABLED"
    const val UNAUTHORIZED = "UNAUTHORIZED"
    const val INVALID_TOKEN = "INVALID_TOKEN"
    const val SESSION_EXPIRED = "SESSION_EXPIRED"
    const val FORBIDDEN_ORIGIN = "FORBIDDEN_ORIGIN"
}

/** 클라이언트(웹·모바일)가 로컬에서 만드는, 서버 계약에 등재된 코드. */
/** 앱 전용 코드(예: PROVIDER_UNAVAILABLE)는 여기 없다 — `AppErrorCode`(손으로 유지). */
object ClientErrorCode {
    const val NETWORK_ERROR = "NETWORK_ERROR"
    const val REQUEST_FAILED = "REQUEST_FAILED"
    const val INVALID_RESPONSE = "INVALID_RESPONSE"
}

/** 서버 `User.provider`가 취하는 값. 디코딩 경계에서 이 집합으로 검증한다. */
val AUTH_PROVIDERS: Set<String> = setOf("google", "apple", "kakao", "demo")

/** 세션을 만든 기기의 종류(`SessionInfo.device`). */
enum class DeviceKind(val wire: String) {
    IPHONE("iphone"),
    IPAD("ipad"),
    GALAXY("galaxy"),
    PIXEL("pixel"),
    ANDROID("android"),
    MAC("mac"),
    WINDOWS("windows"),
    DESKTOP("desktop"),
    UNKNOWN("unknown"),
    ;

    companion object {
        /**
         * 모르는 값은 거부하지 않고 [UNKNOWN]으로 접는다 — 기기 종류는 화면의 라벨일
         * 뿐이라, 갈래가 늘었다고 예전 앱에서 목록 전체가 실패하면 손해가 더 크다.
         */
        fun from(wire: String?): DeviceKind =
            entries.firstOrNull { it.wire == wire } ?: UNKNOWN
    }
}
