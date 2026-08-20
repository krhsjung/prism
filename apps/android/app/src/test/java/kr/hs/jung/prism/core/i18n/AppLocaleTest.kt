package kr.hs.jung.prism.core.i18n

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 화면 언어를 고르는 규칙. 기기가 주는 태그는 거의 항상 지역까지 붙어 있어(ko-KR)
 * 정확히 일치하는 경우가 오히려 드물다 — 여기가 어긋나면 앱이 조용히 영어로만 뜬다.
 * (Android API를 쓰지 않는 순수 로직이라 JVM 유닛 테스트로 돈다.)
 */
class AppLocaleTest {
    @Test
    fun `strips region subtags`() {
        assertEquals(AppLocale.KO, AppLocale.matching("ko-KR"))
        assertEquals(AppLocale.JA, AppLocale.matching("ja-JP"))
        assertEquals(AppLocale.EN, AppLocale.matching("en"))
    }

    @Test
    fun `ignores casing and whitespace`() {
        assertEquals(AppLocale.KO, AppLocale.matching(" KO-kr "))
    }

    @Test
    fun `rejects unsupported languages`() {
        assertNull(AppLocale.matching("fr-FR"))
        assertNull(AppLocale.matching(""))
    }

    @Test
    fun `picks first supported in preference order`() {
        assertEquals(AppLocale.JA, AppLocale.negotiated(listOf("fr-FR", "ja-JP", "ko-KR")))
    }

    @Test
    fun `falls back to default when none supported`() {
        assertEquals(AppLocale.fallback, AppLocale.negotiated(listOf("fr-FR")))
        assertEquals(AppLocale.fallback, AppLocale.negotiated(emptyList()))
    }
}
