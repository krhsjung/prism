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

/** 세션 소켓이 내려보내는 메시지의 종류. */
enum class SocketServerMessageType(val wire: String) {
    READY("ready"),
    SESSIONS_CHANGED("sessionsChanged"),
    HEARTBEAT("heartbeat"),
    ERROR("error"),
    ;

    companion object {
        /**
         * [DeviceKind]와 달리 **모르는 값은 접지 않고 null을 준다** — 이것은 화면
         * 라벨이 아니라 동작이라, 아무 갈래로 접으면 하지 말아야 할 일을 한다.
         */
        fun from(wire: String?): SocketServerMessageType? =
            entries.firstOrNull { it.wire == wire }
    }
}

/**
 * 세션 소켓으로 **올려보내는** 메시지의 종류.
 *
 * presence를 주장하지 않는다 — 서버는 이 말을 믿는 대신 세션 저장소를 다시 읽는다.
 * 그래서 이 메시지에는 아무 권한도 실려 있지 않다(무엇을 폐기했는지도 말하지 않는다).
 */
enum class SessionClientMessageType(val wire: String) {
    SESSIONS_REVOKED("sessionsRevoked"),
    ;
}

/** 푸시 알림 페이로드의 `data` 키. 세 클라이언트가 같은 문자열을 손으로 베끼지 않게 한다. */
object PushDataKey {
    const val KIND = "kind"
    const val CALL_ID = "callId"
    const val DEVICE = "device"
    const val LINK = "link"
    const val ACTIONS = "actions"
    const val IMAGE = "image"
}

/** 알림의 갈래(`data.kind`). `call`은 소켓 없는 기기를 깨우는 통화 알림이다. */
val PUSH_KINDS: Set<String> = setOf("call", "demo")

/** 알림에 붙는 버튼 조합. **iOS가 미리 등록한 것만 쓸 수 있어** 조합 자체를 계약이 정한다. */
enum class PushActionSet(val wire: String) {
    NONE("none"),
    OPEN("open"),
    OPEN_DISMISS("open-dismiss"),
    ;

    companion object {
        fun from(wire: String?): PushActionSet? =
            entries.firstOrNull { it.wire == wire }
    }
}

/** 푸시 전송 결과. **FCM이 알려 주는 것은 "받아들였다"까지다** — 배달도 열람도 아니다. */
enum class PushSendResult(val wire: String) {
    ACCEPTED("accepted"),
    NO_TOKEN("no-token"),
    REJECTED("rejected"),
    DUPLICATE("duplicate"),
    UNKNOWN("unknown"),
    ;

    companion object {
        fun from(wire: String?): PushSendResult? =
            entries.firstOrNull { it.wire == wire }
    }
}
