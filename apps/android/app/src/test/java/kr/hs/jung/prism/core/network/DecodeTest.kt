package kr.hs.jung.prism.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * 경계 디코딩은 서버 계약(contracts.ts)과 같은 강도로 걸러야 한다: 빈 문자열·공백만·모르는
 * provider·비양수 수명값을 거부한다. 실제 org.json으로 JVM에서 돈다(testImplementation).
 */
class DecodeTest {
    private val validUser =
        """{"id":"u1","provider":"demo","displayName":"Demo User","createdAt":"2026-01-01T00:00:00Z"}"""

    @Test
    fun `decodes a valid session-user`() {
        val session = decodeSessionUser("""{"user":$validUser,"accessTokenTtlMs":900000}""")
        assertEquals("u1", session.user.id)
        assertEquals("demo", session.user.provider)
        assertEquals(900_000L, session.accessTokenTtlMs)
    }

    @Test
    fun `rejects empty string field`() {
        val body =
            """{"user":{"id":"","provider":"demo","displayName":"D","createdAt":"t"},"accessTokenTtlMs":1}"""
        assertThrows(ApiError::class.java) { decodeSessionUser(body) }
    }

    @Test
    fun `rejects blank (whitespace-only) field`() {
        val body =
            """{"user":{"id":"  ","provider":"demo","displayName":"D","createdAt":"t"},"accessTokenTtlMs":1}"""
        assertThrows(ApiError::class.java) { decodeSessionUser(body) }
    }

    @Test
    fun `rejects unknown provider`() {
        val body =
            """{"user":{"id":"u1","provider":"facebook","displayName":"D","createdAt":"t"},"accessTokenTtlMs":1}"""
        assertThrows(ApiError::class.java) { decodeSessionUser(body) }
    }

    @Test
    fun `rejects zero ttl`() {
        assertThrows(ApiError::class.java) {
            decodeSessionUser("""{"user":$validUser,"accessTokenTtlMs":0}""")
        }
    }

    @Test
    fun `rejects negative ttl`() {
        assertThrows(ApiError::class.java) {
            decodeSessionUser("""{"user":$validUser,"accessTokenTtlMs":-5}""")
        }
    }

    @Test
    fun `rejects fractional ttl`() {
        assertThrows(ApiError::class.java) {
            decodeSessionUser("""{"user":$validUser,"accessTokenTtlMs":1.5}""")
        }
    }

    @Test
    fun `rejects string ttl (no coercion)`() {
        // optLong은 "900000"을 900000으로 강제 변환하지만, 계약은 숫자 타입만 허용한다.
        assertThrows(ApiError::class.java) {
            decodeSessionUser("""{"user":$validUser,"accessTokenTtlMs":"900000"}""")
        }
    }

    @Test
    fun `rejects non-string field (no coercion)`() {
        // 숫자·boolean을 문자열로 강제 변환하지 않는다 — 서버 계약은 실제 string만 허용.
        val body =
            """{"user":{"id":123,"provider":"demo","displayName":true,"createdAt":"t"},"accessTokenTtlMs":1}"""
        assertThrows(ApiError::class.java) { decodeSessionUser(body) }
    }

    @Test
    fun `rejects ttl beyond safe integer range`() {
        assertThrows(ApiError::class.java) {
            decodeSessionUser("""{"user":$validUser,"accessTokenTtlMs":9007199254740992}""")
        }
    }

    @Test
    fun `accepts ttl at safe integer boundary`() {
        val session =
            decodeSessionUser("""{"user":$validUser,"accessTokenTtlMs":9007199254740991}""")
        assertEquals(9_007_199_254_740_991L, session.accessTokenTtlMs)
    }

    @Test
    fun `rejects malformed json`() {
        assertThrows(ApiError::class.java) { decodeSessionUser("not-json") }
    }

    @Test
    fun `error code extraction`() {
        assertEquals("DEMO_DISABLED", decodeErrorCode("""{"error":"DEMO_DISABLED"}"""))
        assertEquals(null, decodeErrorCode("""{"error":""}"""))
        assertEquals(null, decodeErrorCode(null))
        assertEquals(null, decodeErrorCode("not-json"))
    }

    // 나중에 더한 필드다. 아직 배포되지 않은 서버는 보내지 않으므로, 여기서 거부하면
    // 앱이 옛 서버에 로그인조차 못 한다 — 실제로 그렇게 깨졌다.
    @Test
    fun `accessTokenTtlMs가 없는 옛 서버 응답도 받는다`() {
        val session = decodeAuthSession(
            """{"accessToken":"a.b.c","refreshToken":"sid.secret","user":$validUser}""",
        )
        // 0이면 선제 갱신을 걸지 않는다 — 만료 대응은 401 재시도가 맡는다.
        assertEquals(0L, session.accessTokenTtlMs)
    }

    @Test
    fun `accessTokenTtlMs가 있으면 그대로 읽는다`() {
        val session = decodeAuthSession(
            """{"accessToken":"a.b.c","refreshToken":"sid.secret","user":$validUser,
               "accessTokenTtlMs":900000}""",
        )
        assertEquals(900_000L, session.accessTokenTtlMs)
    }

    @Test
    fun `비양수 accessTokenTtlMs는 거부한다`() {
        assertThrows(ApiError::class.java) {
            decodeAuthSession(
                """{"accessToken":"a.b.c","refreshToken":"sid.secret","user":$validUser,
                   "accessTokenTtlMs":0}""",
            )
        }
    }

    // 배포 중에는 이 필드가 없는 서버와 섞인다 — 거부하면 배지 하나 때문에 목록 전체가
    // 실패한다(device를 UNKNOWN으로 접는 것과 같은 규칙).
    @Test
    fun `folds a missing isConnected to false`() {
        val list = decodeSessionList(
            """[{"id":"s1","startedAt":"a","expiresAt":"b","isCurrent":true,"device":"mac"}]""",
        )
        assertEquals(false, list[0].isConnected)
    }

    @Test
    fun `reads isConnected when present`() {
        val list = decodeSessionList(
            """[{"id":"s1","startedAt":"a","expiresAt":"b","isCurrent":false,"isConnected":true,"device":"mac"}]""",
        )
        assertEquals(true, list[0].isConnected)
    }
}
