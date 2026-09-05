package kr.hs.jung.prism.core.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * 디자인 토큰 색상.
 *
 * 이름·값은 웹의 CSS 변수와 1:1이다(`--color-surface` ↔ `PrismColors.surface`). 원천은
 * Figma → `design/tokens` → `apps/web/src/index.css` 순서이며, Compose에는 Material의
 * ColorScheme에 다 담기지 않는 값이 많아 별도 팔레트로 둔다. 색을 새로 쓰려면 여기가
 * 아니라 토큰부터 늘린다.
 */
@Immutable
data class PrismColors(
    val surface: Color,
    val card: Color,
    val border: Color,
    val heading: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val primary: Color,
    val primaryForeground: Color,
    val primaryPress: Color,
    val secondaryBackground: Color,
    val secondaryForeground: Color,
    val error: Color,
    val errorBackground: Color,
    /**
     * **error 위에 얹히는** 글자·글리프(종료 버튼). 흰색을 하드코딩하면 다크의 밝은
     * 빨강(#E08A8A) 위에서 대비가 나오지 않는다(plan/webrtc.md §4).
     */
    val errorForeground: Color,
    val success: Color,
    val successBackground: Color,
    /**
     * "되돌릴 수 있는 꺼짐"(음소거·카메라 오프). 종료(Destructive)와 색으로 갈라 둔다 —
     * 둘 다 빨강이면 화면에 빨간 원이 둘 생기고 되돌릴 수 있는 것과 없는 것이 같아 보인다.
     */
    val warning: Color,
    val warningBackground: Color,
    val info: Color,
    val infoBackground: Color,
    /**
     * 무대의 어두운 타일. **판은 [surface], 타일이 [stage]다** — 둘이 같은 색이면 타일
     * 경계가 사라진다. 라이트/다크 양쪽에서 어둡다(영상 위의 글씨가 늘 흰색이도록).
     */
    val stage: Color,
    val stageForeground: Color,
    // Kakao 브랜드 고정색 — 로그인 버튼 가이드 값이라 라이트/다크 공통이다(노랑 배경·검정 85%).
    val kakao: Color,
    val kakaoForeground: Color,
)

private val LightColors = PrismColors(
    surface = Color(0xFFF5F8FC),
    card = Color(0xFFFFFFFF),
    border = Color(0xFFD4DEEC),
    heading = Color(0xFF162338),
    text = Color(0xFF3B4E68),
    muted = Color(0xFF5F6F85),
    accent = Color(0xFF4A78B8),
    primary = Color(0xFF1D3557),
    primaryForeground = Color(0xFFFFFFFF),
    primaryPress = Color(0xFF162338),
    secondaryBackground = Color(0xFFEDF3FB),
    secondaryForeground = Color(0xFF1D3557),
    error = Color(0xFFC75B5B),
    errorBackground = Color(0xFFFDEEEE),
    errorForeground = Color(0xFFFFFFFF),
    success = Color(0xFF4A9D6E),
    successBackground = Color(0xFFE9F6EF),
    warning = Color(0xFFD4A844),
    warningBackground = Color(0xFFFFF6E8),
    info = Color(0xFF5B8FC7),
    infoBackground = Color(0xFFE8F0FA),
    stage = Color(0xFF162338),
    stageForeground = Color(0xFFFFFFFF),
    kakao = Color(0xFFFEE500),
    kakaoForeground = Color(0xD9000000),
)

private val DarkColors = PrismColors(
    surface = Color(0xFF1A2436),
    card = Color(0xFF243044),
    border = Color(0xFF30425E),
    heading = Color(0xFFFFFFFF),
    text = Color(0xFFE5ECF7),
    muted = Color(0xFFAAB8CC),
    accent = Color(0xFF7FA9DE),
    primary = Color(0xFF5F92D8),
    primaryForeground = Color(0xFFFFFFFF),
    primaryPress = Color(0xFF3A5F93),
    secondaryBackground = Color(0xFF30425E),
    secondaryForeground = Color(0xFFE5ECF7),
    error = Color(0xFFE08A8A),
    errorBackground = Color(0xFF3A2630),
    errorForeground = Color(0xFF162338),
    success = Color(0xFF7CC79A),
    successBackground = Color(0xFF1F3A2C),
    warning = Color(0xFFE3C173),
    warningBackground = Color(0xFF3A3122),
    info = Color(0xFF8FB8E0),
    infoBackground = Color(0xFF22334A),
    stage = Color(0xFF0F1726),
    stageForeground = Color(0xFFFFFFFF),
    // 브랜드 고정색이라 다크에서도 동일하다.
    kakao = Color(0xFFFEE500),
    kakaoForeground = Color(0xD9000000),
)

private val LocalPrismColors = staticCompositionLocalOf { LightColors }

/** `PrismTheme.colors.heading` 처럼 토큰 색에 접근한다. */
object PrismTheme {
    val colors: PrismColors
        @Composable @ReadOnlyComposable get() = LocalPrismColors.current
}

/**
 * 앱 테마. 커스텀 컴포넌트가 색을 직접 지정하므로 Material ColorScheme는 최소한만
 * 채우고(리플·기본 컨테이너 색 등), 실제 팔레트는 [PrismColors]로 내려보낸다.
 */
@Composable
fun PrismAppTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    val colors = if (darkTheme) DarkColors else LightColors
    val scheme = if (darkTheme) {
        darkColorScheme(
            primary = colors.primary,
            onPrimary = colors.primaryForeground,
            background = colors.surface,
            surface = colors.card,
            error = colors.error,
        )
    } else {
        lightColorScheme(
            primary = colors.primary,
            onPrimary = colors.primaryForeground,
            background = colors.surface,
            surface = colors.card,
            error = colors.error,
        )
    }
    CompositionLocalProvider(LocalPrismColors provides colors) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
