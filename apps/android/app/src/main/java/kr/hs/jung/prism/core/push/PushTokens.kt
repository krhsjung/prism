package kr.hs.jung.prism.core.push

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kr.hs.jung.prism.BuildConfig
import kr.hs.jung.prism.core.util.AppLog
import kotlin.coroutines.resume

private const val PREFS = "prism.prefs"
private const val KEY_WANTED = "prism.push.wanted"

/**
 * 이 기기의 FCM 등록 토큰.
 *
 * **토큰은 로그인 요청에 실려야 세션 안으로 들어간다**(plan/push.md §5-2) — 살아 있는
 * 세션 레코드를 고치는 경로를 두지 않기로 했기 때문이다. 그래서 로그인 화면이 먼저
 * 권한을 받고 여기서 토큰을 얻은 뒤 로그인을 부른다.
 *
 * 권한을 주지 않아도 로그인은 그대로 된다 — 그 세션이 `Notifications off`가 될 뿐이다.
 */
class PushTokens(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * 설정 파일(`google-services.json`)이 없는 빌드에서는 Firebase가 초기화되지 않는다.
     * 그 경우 시도조차 하지 않는다 — 예외를 잡는 것보다 부르지 않는 편이 읽기 쉽다.
     */
    val enabled: Boolean get() = BuildConfig.PUSH_ENABLED

    /** 시스템이 알림을 허용했는가. **33 미만에는 런타임 권한이 없다**(minSdk 24). */
    fun permissionGranted(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * 등록 토큰을 받아 온다. 실패하면 null — 로그인은 계속돼야 한다.
     *
     * 토큰 값은 **로그에 남기지 않는다.** 설치 단위 식별자라 세션보다 오래 살고,
     * 로그는 기기에 남는다(plan/push.md §5-3과 같은 이유).
     */
    suspend fun current(): String? {
        if (!enabled || !permissionGranted()) return null
        return runCatching { awaitToken() }
            .onFailure { AppLog.d("fcm token unavailable") }
            .getOrNull()
    }

    private suspend fun awaitToken(): String? =
        suspendCancellableCoroutine { cont ->
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resume(null) }
        }

    /**
     * 이 기기가 **받기로 했는가**. 토큰이 아니라 사람의 선택을 남긴다.
     *
     * 등록은 세션에 붙으므로 로그아웃하면 함께 사라진다(plan/push.md §5-2). 그때마다 다시
     * 누르게 하면 토글이 "켜 두는 것"이 아니라 "매번 켜는 것"이 된다 — 그래서 선택만
     * 남기고, 로그인한 뒤 그 선택대로 조용히 다시 붙인다(§5-16).
     *
     * **토큰을 남기지 않는 것이 핵심이다.** 토큰은 회전하므로 저장하면 금세 거짓이 된다.
     */
    fun rememberWanted(wanted: Boolean) {
        prefs.edit().putBoolean(KEY_WANTED, wanted).apply()
    }

    fun wanted(): Boolean = prefs.getBoolean(KEY_WANTED, false)
}
