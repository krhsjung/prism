package kr.hs.jung.prism

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import kr.hs.jung.prism.core.i18n.withAppLocale
import kr.hs.jung.prism.core.push.PushLinks
import kr.hs.jung.prism.core.theme.AppTheme
import kr.hs.jung.prism.core.theme.PrismAppTheme
import kr.hs.jung.prism.ui.RootScreen

class MainActivity : ComponentActivity() {

    // 선택된 언어의 리소스로 Activity의 base context를 감싼다. 이렇게 해야 화면 문구는
    // 물론 팝업·다이얼로그까지 그 언어를 따른다(Compose CompositionLocal 덮어쓰기는
    // 별도 윈도우인 팝업에 닿지 않는다). 언어를 바꾸면 recreate()로 이 경로를 다시 탄다.
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(newBase.withAppLocale())
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // 앱이 꺼져 있을 때 시스템이 그린 알림을 눌러 들어온 경로.
        PushLinks.offerFrom(intent?.extras)

        val container = (application as PrismApplication).container

        setContent {
            // 고른 테마를 실제 라이트/다크로 푼다. SYSTEM은 기기 설정을 따른다.
            val darkTheme = when (container.themeStore.theme) {
                AppTheme.SYSTEM -> isSystemInDarkTheme()
                AppTheme.LIGHT -> false
                AppTheme.DARK -> true
            }
            PrismAppTheme(darkTheme = darkTheme) {
                RootScreen(container = container)
            }
        }
    }

    /**
     * 앱이 이미 떠 있는데 알림을 눌렀다. **`singleTop`이라야 여기로 온다** —
     * 아니면 인스턴스가 하나 더 쌓이고, 새 인스턴스는 소켓도 통화 상태도 없는
     * 빈 앱이라 `resume`이 갈 곳을 잃는다.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        PushLinks.offerFrom(intent.extras)
    }
}
