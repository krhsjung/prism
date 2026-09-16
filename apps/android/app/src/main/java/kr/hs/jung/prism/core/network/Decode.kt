package kr.hs.jung.prism.core.network

import kr.hs.jung.prism.domain.model.AUTH_PROVIDERS
import kr.hs.jung.prism.domain.model.AuthSession
import kr.hs.jung.prism.domain.model.DeviceKind
import kr.hs.jung.prism.domain.model.SessionListItem
import kr.hs.jung.prism.domain.model.SessionUser
import kr.hs.jung.prism.domain.model.SocketServerMessage
import kr.hs.jung.prism.domain.model.SocketServerMessageType
import kr.hs.jung.prism.domain.model.User
import org.json.JSONArray
import org.json.JSONObject

/** JS `Number.MAX_SAFE_INTEGER`(2^53-1). 서버 계약과 같은 정수 상한. */
private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

// 경계 디코딩(parse, don't validate). 네트워크에서 온 JSON을 계약 타입으로 "구성"한다.
// 형식이 어긋나면 던진다 — 서버의 디코더 철학과 같다. 여기서 걸러야 화면 코드가
// null·형식 오류를 걱정하지 않는다. 검증 강도도 서버 계약(contracts.ts)과 맞춘다:
// 빈 문자열·공백만·모르는 provider·비양수 수명값은 거부한다.

private fun JSONObject.requireString(key: String): String {
    // 실제 String 타입만 받는다. optString은 숫자·boolean도 문자열로 강제 변환하므로
    // (`{"id":123}` → "123"), opt로 원시 값을 꺼내 타입을 직접 확인한다 — 서버 계약의
    // decodeString과 같은 취지. 빈 값·공백만도 거부한다(원문은 그대로 돌려준다).
    val value = opt(key)
    if (value !is String || value.isBlank()) throw ApiError.invalidResponse
    return value
}

/**
 * 양의 정수 수명값. 서버 `decodePositiveInt`와 같은 규칙이다.
 *
 * `optLong`의 문자열·소수 강제 변환에 기대지 않고 실제 숫자 타입인지·정수인지·양수인지
 * 직접 본다. 범위는 JS 안전 정수(2^53-1)까지 — 그 밖은 플랫폼마다 해석이 갈린다.
 */
private fun JSONObject.optPositiveLong(key: String): Long =
    if (opt(key) == null) 0 else requirePositiveLong(key)

private fun JSONObject.requirePositiveLong(key: String): Long {
    val value = opt(key)
    if (value !is Number) throw ApiError.invalidResponse
    val number = value.toLong()
    if (number <= 0 || value.toDouble() != number.toDouble() || number > MAX_SAFE_INTEGER) {
        throw ApiError.invalidResponse
    }
    return number
}

fun decodeUser(json: JSONObject): User {
    val provider = json.requireString("provider")
    // 서버 계약은 provider를 google|apple|demo로 제한한다 — 임의 문자열을 통과시키지 않는다.
    if (provider !in AUTH_PROVIDERS) throw ApiError.invalidResponse
    return User(
        id = json.requireString("id"),
        provider = provider,
        displayName = json.requireString("displayName"),
        createdAt = json.requireString("createdAt"),
    )
}

/** `{ user, accessTokenTtlMs }` — 쿠키 흐름의 로그인·세션 확인 응답. */
fun decodeSessionUser(body: String): SessionUser {
    val json = try {
        JSONObject(body)
    } catch (e: Exception) {
        throw ApiError.invalidResponse
    }
    val userJson = json.optJSONObject("user") ?: throw ApiError.invalidResponse
    // ttl은 토큰이 아니라 수명값이라 body에 실려 온다(클라이언트가 exp를 읽지 않는다).
    return SessionUser(
        user = decodeUser(userJson),
        accessTokenTtlMs = json.requirePositiveLong("accessTokenTtlMs"),
    )
}

/** `{ accessToken, refreshToken, user }` — 네이티브(Bearer) 흐름의 로그인·갱신 응답. */
fun decodeAuthSession(body: String): AuthSession {
    val json = try {
        JSONObject(body)
    } catch (e: Exception) {
        throw ApiError.invalidResponse
    }
    val userJson = json.optJSONObject("user") ?: throw ApiError.invalidResponse
    return AuthSession(
        accessToken = json.requireString("accessToken"),
        refreshToken = json.requireString("refreshToken"),
        user = decodeUser(userJson),
        // **없어도 받는다.** 나중에 더한 필드라, 아직 배포되지 않은 서버는 보내지 않는다 —
        // 여기서 거부하면 앱이 옛 서버에 로그인조차 못 한다(실제로 그렇게 깨졌다).
        // 없으면 0이고, 0이면 선제 갱신을 걸지 않는다. 만료 대응은 401 재시도가 맡는다.
        accessTokenTtlMs = json.optPositiveLong("accessTokenTtlMs"),
    )
}

/**
 * `[{ id, startedAt, expiresAt, isCurrent }, …]` — `GET /auth/sessions`.
 *
 * 배열이 통째로 응답 본문이다. 한 항목이라도 형식이 어긋나면 목록 전체를 거부한다 —
 * 일부만 살려 그리면 "해제했는데 목록에 남아 있는" 것과 구분되지 않는다.
 */
fun decodeSessionList(body: String): List<SessionListItem> {
    val array = try {
        JSONArray(body)
    } catch (e: Exception) {
        throw ApiError.invalidResponse
    }
    return (0 until array.length()).map { i ->
        val item = array.opt(i)
        if (item !is JSONObject) throw ApiError.invalidResponse
        // isCurrent는 optBoolean처럼 문자열·숫자를 강제 변환하지 않는다 — 실제 Boolean만.
        val current = item.opt("isCurrent")
        if (current !is Boolean) throw ApiError.invalidResponse
        SessionListItem(
            id = item.requireString("id"),
            startedAt = item.requireString("startedAt"),
            expiresAt = item.requireString("expiresAt"),
            isCurrent = current,
            // isCurrent와 달리 **없어도 받는다.** 나중에 더한 필드라 아직 배포되지 않은
            // 서버는 보내지 않는다 — 여기서 거부하면 배지 하나 때문에 목록 전체가 실패한다.
            // (device를 UNKNOWN으로 접는 것과 같은 규칙이다)
            isConnected = item.opt("isConnected") == true,
            // isConnected와 같은 규칙으로 접는다 — 푸시가 붙기 전 서버가 이 필드를
            // 보내지 않아도 목록은 그려져야 한다.
            pushRegistered = item.opt("pushRegistered") == true,
            // 모르는 값은 거부하지 않고 UNKNOWN으로 접는다 — 갈래가 늘었다고 예전 앱에서
            // 목록 전체가 실패하면 손해가 더 크다(웹 decodeDeviceKind와 같은 규칙).
            device = DeviceKind.from(item.opt("device") as? String),
        )
    }
}

/**
 * 세션 소켓이 내려보낸 메시지 한 줄.
 *
 * [DeviceKind]와 달리 **모르는 type을 접지 않는다** — 이것은 화면 라벨이 아니라 동작이라,
 * 아무 갈래로 접으면 하지 말아야 할 일을 한다. 형식이 어긋나면 null이고, 호출부는 그것을
 * 무시한다(연결을 끊을 이유는 없다).
 */
fun decodeSocketServerMessage(body: String): SocketServerMessage? {
    val json = try {
        JSONObject(body)
    } catch (e: Exception) {
        return null
    }
    return when (SocketServerMessageType.from(json.opt("type") as? String)) {
        SocketServerMessageType.READY -> SocketServerMessage.Ready
        SocketServerMessageType.SESSIONS_CHANGED -> SocketServerMessage.SessionsChanged
        SocketServerMessageType.HEARTBEAT -> SocketServerMessage.Heartbeat
        SocketServerMessageType.ERROR -> {
            val code = json.opt("code") as? String
            // 코드가 없으면 클라이언트가 "갱신하면 되는가"를 판단할 수 없다 —
            // 조용히 통과시키면 그 판단이 아무 갈래로 떨어진다.
            if (code.isNullOrEmpty()) null else SocketServerMessage.Error(code)
        }
        null -> null
    }
}

/** 오류 응답 body(`{ "error": "<코드>" }`)에서 코드만 꺼낸다. 없으면 null. */
fun decodeErrorCode(body: String?): String? {
    if (body.isNullOrBlank()) return null
    return try {
        val code = JSONObject(body).optString("error", "")
        code.ifEmpty { null }
    } catch (e: Exception) {
        null
    }
}
