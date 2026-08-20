package kr.hs.jung.prism.core.theme

import android.content.Context
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kr.hs.jung.prism.R

/**
 * 고를 수 있는 테마. `SYSTEM`은 "고르지 않음"이 아니라 기기 설정을 따르겠다는 선택이다 —
 * 라이트/다크를 고른 뒤에도 되돌아올 수 있어야 하므로 하나의 값으로 둔다
 * (웹 apps/web/src/lib/theme/theme.ts와 같은 정의).
 *
 * 아이콘은 선택 메뉴가 줄마다 그린다(웹 THEME_ICONS와 같은 짝: 모니터 · 해 · 달).
 */
enum class AppTheme(@StringRes val labelRes: Int, @DrawableRes val iconRes: Int) {
    SYSTEM(R.string.theme_system, R.drawable.ic_monitor),
    LIGHT(R.string.theme_light, R.drawable.ic_sun),
    DARK(R.string.theme_dark, R.drawable.ic_moon),
}

/**
 * 테마 선택을 기억하는 곳. 고른 적이 없으면 기기 설정을 따른다.
 * 테마는 민감 정보가 아니라 일반 SharedPreferences면 충분하다(세션은 SecureStore).
 */
class ThemeStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // Compose가 관찰하는 상태 — 바뀌면 이 값을 읽는 화면이 다시 그려진다.
    var theme by mutableStateOf(load())
        private set

    fun select(next: AppTheme) {
        if (next == theme) return
        prefs.edit().putString(KEY, next.name).apply()
        theme = next
    }

    private fun load(): AppTheme {
        val stored = prefs.getString(KEY, null) ?: return AppTheme.SYSTEM
        return runCatching { AppTheme.valueOf(stored) }.getOrDefault(AppTheme.SYSTEM)
    }

    private companion object {
        const val PREFS = "prism.prefs"
        const val KEY = "theme"
    }
}
