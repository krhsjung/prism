package kr.hs.jung.prism.core.network

import kr.hs.jung.prism.domain.model.AUTH_PROVIDERS
import kr.hs.jung.prism.domain.model.AuthSession
import kr.hs.jung.prism.domain.model.SessionUser
import kr.hs.jung.prism.domain.model.User
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
    // ttl은 토큰이 아니라 수명값이라 body에 실려 온다(HttpOnly라 클라이언트가 exp를 못 읽는다).
    // 서버 decodePositiveInt와 같게 **양의 정수**만 받는다 — optLong의 문자열·소수 강제
    // 변환에 기대지 않고, 실제 숫자 타입인지·정수인지·양수인지 직접 검사한다.
    val ttlValue = json.opt("accessTokenTtlMs")
    if (ttlValue !is Number) throw ApiError.invalidResponse
    val ttl = ttlValue.toLong()
    // 양의 정수 + JS 안전 정수 범위(2^53-1). 서버 decodePositiveInt(Number.isSafeInteger)와
    // 맞춘다 — 소수·범위 밖 값은 플랫폼마다 해석이 갈린다.
    if (ttl <= 0 || ttlValue.toDouble() != ttl.toDouble() || ttl > MAX_SAFE_INTEGER) {
        throw ApiError.invalidResponse
    }
    return SessionUser(user = decodeUser(userJson), accessTokenTtlMs = ttl)
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
    )
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
