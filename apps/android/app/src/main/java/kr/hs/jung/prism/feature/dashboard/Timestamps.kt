package kr.hs.jung.prism.feature.dashboard

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import java.text.DateFormat
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * 계약의 ISO-8601 시각을 **화면 언어의 표기**로 옮긴다.
 *
 * 언어를 바꾸면 날짜 표기도 함께 바뀌어야 한다 — 로케일은 `LocalConfiguration`에서
 * 읽는다(`MainActivity.attachBaseContext`가 고른 언어를 Activity 설정에 심어 둔다).
 *
 * `java.time`을 쓰지 않는 이유: minSdk 24라 API 26 미만에서는 desugaring 없이 못 쓴다.
 * 파싱은 서버가 보내는 형태(`2026-08-20T12:08:26.806Z`)에 맞춘 `SimpleDateFormat`이고,
 * 표기는 기기·언어 관습을 따르는 `DateFormat`이다.
 *
 * 값이 형식에서 벗어나면 **원문을 그대로 보여준다** — 화면이 빈칸이 되는 것보다
 * 낫고(무엇이 잘못됐는지 보인다), 목록 전체를 실패로 만들 이유도 없다.
 */
@Composable
fun formatTimestamp(iso: String): String {
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()
    return formatTimestamp(iso, locale)
}

internal fun formatTimestamp(iso: String, locale: Locale): String {
    val parsed = parseIso(iso) ?: return iso
    return DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale)
        .format(parsed)
}

/**
 * 서버가 보내는 두 형태를 받는다 — 밀리초가 있는 값과 없는 값.
 * 파서는 관대하지 않게(`isLenient = false`) 둔다: `2026-13-45` 같은 값이 조용히 다른
 * 날짜로 굴러가면 화면에 틀린 시각이 그대로 뜬다.
 */
private fun parseIso(iso: String): Date? {
    for (pattern in ISO_PATTERNS) {
        val format = SimpleDateFormat(pattern, Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
            isLenient = false
        }
        try {
            return format.parse(iso)
        } catch (e: ParseException) {
            continue
        }
    }
    return null
}

private val ISO_PATTERNS = listOf(
    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    "yyyy-MM-dd'T'HH:mm:ss'Z'",
)
