package kr.hs.jung.prism.core.i18n

import android.content.Context
import android.content.res.Configuration
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.os.ConfigurationCompat
import java.util.Locale

// 언어 선택은 두 곳이 함께 읽는다: UI(트리거 라벨·선택 메뉴)는 아래 LocaleStore가,
// 리소스 해석은 Activity의 attachBaseContext가 본다. 그래서 "어떤 언어인가"를 정하는
// 규칙은 여기 top-level 함수 한 곳에 두고 양쪽이 공유한다 — 두 곳이 갈리면 트리거는
// 한국어인데 화면 문구는 영어인 식으로 어긋난다.

private const val PREFS = "prism.prefs"
private const val KEY = "locale"

/** 표시할 언어: 사용자가 고른 값 > 기기 선호 순서 > 기본 언어. */
fun resolveLocale(context: Context): AppLocale {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.getString(KEY, null)?.let { stored ->
        AppLocale.matching(stored)?.let { return it }
    }
    val configured = ConfigurationCompat.getLocales(context.resources.configuration)
    val preferred = (0 until configured.size()).mapNotNull { configured[it]?.toLanguageTag() }
    return AppLocale.negotiated(preferred)
}

/**
 * base Context를 선택된 언어의 리소스로 감싼다. Activity.attachBaseContext에서 쓰면
 * 그 Activity의 모든 리소스 해석(팝업·다이얼로그 포함)이 이 언어를 따른다 —
 * Compose의 CompositionLocal 덮어쓰기는 별도 윈도우인 팝업까지 닿지 않기 때문이다.
 */
fun Context.withAppLocale(): Context {
    val locale = Locale.forLanguageTag(resolveLocale(this).tag)
    Locale.setDefault(locale)
    val config = Configuration(resources.configuration)
    config.setLocale(locale)
    return createConfigurationContext(config)
}

/**
 * 화면 언어 선택.
 *
 * 웹에는 화면 안에 언어 선택이 있으므로(LocaleSwitcher) 같은 경험을 주려면 앱이 직접
 * 언어를 골라 그 언어의 리소스로 문자열을 읽어야 한다. 여기서 고른 값은 저장되고,
 * Activity를 다시 만들면(attachBaseContext 재실행) 그 언어의 `values-{tag}` 리소스가 실린다.
 */
class LocaleStore(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // Compose가 관찰하는 상태 — 트리거 라벨·선택 표시에 쓴다.
    var locale by mutableStateOf(resolveLocale(appContext))
        private set

    fun select(next: AppLocale) {
        if (next == locale) return
        prefs.edit().putString(KEY, next.tag).apply()
        locale = next
    }
}
