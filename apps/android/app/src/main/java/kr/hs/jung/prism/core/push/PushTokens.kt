package kr.hs.jung.prism.core.push

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kr.hs.jung.prism.BuildConfig
import kr.hs.jung.prism.core.util.AppLog
import kotlin.coroutines.resume

private const val PREFS = "prism.prefs"
private const val KEY_WANTED = "prism.push.wanted"
private const val KEY_ASKED = "prism.push.asked"
// 앞 세션의 토큰을 아직 버리지 못했다 — 버리기 전에는 새 등록을 시작하지 않는다.
private const val KEY_PENDING_DELETE = "prism.push.pending_delete"
/** 끄기를 시작했다는 표식 — 웹·iOS와 같은 이름이다. */
private const val KEY_DISABLE_PENDING = "prism.push.disable_pending"

/**
 * 이 기기의 알림 상태. 화면이 그릴 수 있는 갈래가 그대로다 — iOS `PushPermission`의 짝.
 *
 * **네 갈래여야 하는 이유는 [DENIED]다.** 허용/거부 둘로만 나누면 거부한 사람에게도
 * `켜기` 버튼이 서는데, 13+에서 그 버튼은 눌러도 아무 일이 없다(시스템이 다시 묻지
 * 않는다). 화면이 고장 난 것으로 읽히는 자리라 갈래를 나눈다(plan/push.md §5-15).
 */
enum class PushPermission {
    /** `google-services.json` 없이 빌드했다 — 물어도 소용이 없다. */
    UNSUPPORTED,
    /** 아직 안 물었거나 한 번 거부라 다시 물을 수 있다. */
    ASKABLE,
    GRANTED,
    /** 시스템이 더는 묻지 않는다 — 설정으로 안내하는 것이 전부다. */
    DENIED,
}

/**
 * 등록 코디네이터([PushRegistration])가 이 기기에 대해 묻고 남기는 것.
 *
 * 인터페이스인 이유는 테스트다 — 실물은 Firebase와 시스템 설정을 읽어 JVM에서 세울 수
 * 없고, 코디네이터가 보는 것은 이 다섯뿐이다.
 */
interface PushDevice {
    /** 이 빌드에 FCM 설정이 있는가. 없으면 묻지도 받지도 않는다. */
    val enabled: Boolean

    /** 시스템이 지금 우리 알림을 띄워 주는가. */
    fun permissionGranted(): Boolean

    /** 지금의 등록 토큰. 받을 수 없으면 null. */
    suspend fun current(): String?

    /** 이 기기가 받기로 했는가 — 사람의 선택. */
    fun wanted(): Boolean

    fun rememberWanted(wanted: Boolean)

    /** 끄기를 **시작했다** — 떼는 도중 앱이 죽거나 떼지 못해도 다음 맞추기가 이어서 뗀다. */
    fun disablePending(): Boolean

    fun rememberDisablePending(pending: Boolean)
}

/**
 * 이 기기의 FCM 등록 토큰과 알림 권한.
 *
 * 토큰은 **살아 있는 세션에 붙는다**(`POST /auth/push/register`, plan/push.md §5-2를
 * 뒤집은 결과) — 로그인은 로그인만 하고, 붙이는 일은 [PushRegistration]이 한다.
 * 권한을 주지 않아도 로그인은 그대로 된다 — 그 세션이 `Notifications off`가 될 뿐이다.
 */
class PushTokens(context: Context) : PushDevice {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * 설정 파일(`google-services.json`)이 없는 빌드에서는 Firebase가 초기화되지 않는다.
     * 그 경우 시도조차 하지 않는다 — 예외를 잡는 것보다 부르지 않는 편이 읽기 쉽다.
     */
    override val enabled: Boolean get() = BuildConfig.PUSH_ENABLED

    /**
     * 시스템이 알림을 허용했는가.
     *
     * **세 가지를 함께 본다.** 33+의 런타임 권한(`POST_NOTIFICATIONS`), 버전과 무관하게
     * 설정에서 끌 수 있는 앱 알림 스위치(`areNotificationsEnabled`), 그리고 26+에서
     * 채널마다 따로 끌 수 있는 스위치다.
     *
     * ⚠️ 예전에는 **33 미만을 무조건 true로 돌려줬다**(런타임 권한이 없으니까). 그런데
     * 12L 이하에서도 사람은 설정에서 알림을 끌 수 있고, 그러면 앱은 GRANTED로 분류한 채
     * 토큰을 받아 등록한다 — 화면은 "받는다"고 말하고 다른 기기의 로비는 이 기기를
     * `Will notify`로 그리는데 알림은 오지 않는다. 갈래 자체가 틀린 자리였다.
     *
     * **채널도 같은 자리다.** 통화와 데모를 채널로 갈라 둔 탓에(`NotificationChannels`)
     * 사람은 통화 채널만 끌 수 있는데, 그러면 `pushRegistered`가 참인 채 통화 알림이 뜨지
     * 않는다 — 다른 기기의 로비가 이 기기를 `Will notify`로 그리는 것이 거짓이 된다.
     * `pushRegistered` 하나가 뜻하는 것은 **"이 기기에 우리 알림이 뜬다"**이고, 채널이
     * 하나라도 꺼져 있으면 그 말이 성립하지 않는다(plan/push.md §5-22).
     */
    override fun permissionGranted(): Boolean {
        if (!NotificationManagerCompat.from(appContext).areNotificationsEnabled()) {
            return false
        }
        if (channelBlocked()) return false
        // 33 미만에는 런타임 권한이 없다(minSdk 24) — 위 스위치가 전부다.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * 우리 채널 중 하나라도 꺼져 있는가(26+).
     *
     * 아직 만들지 않은 채널(`null`)은 꺼진 것이 아니다 — 앱이 처음 뜨면 만들고, 만들
     * 때의 중요도는 켜짐이다.
     */
    private fun channelBlocked(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val manager = appContext.getSystemService<NotificationManager>() ?: return false
        return NOTIFICATION_CHANNELS.any { id ->
            manager.getNotificationChannel(id)?.importance == NotificationManager.IMPORTANCE_NONE
        }
    }

    /**
     * 등록 토큰을 받아 온다. 실패하면 null.
     *
     * 토큰 값은 **로그에 남기지 않는다.** 설치 단위 식별자라 세션보다 오래 살고,
     * 로그는 기기에 남는다(plan/push.md §5-3과 같은 이유).
     */
    override suspend fun current(): String? {
        if (!enabled || !permissionGranted()) return null
        // 앞 세션의 토큰을 아직 못 버렸다면 **먼저 버린다.** 못 버리면 토큰을 주지 않는다 —
        // 그 토큰은 앞 계정의 세션이 아직 가리키고 있을 수 있어, 그것을 새 계정에 붙이면
        // 앞 계정의 알림이 이 기기로 온다(plan/push.md §5-21).
        if (prefs.getBoolean(KEY_PENDING_DELETE, false) && !awaitDelete()) return null
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
     * 이 설치의 토큰을 **버린다** — 세션이 끝날 때 부른다(`AuthManager`).
     *
     * 로그아웃이 서버에서 실패해도 로컬은 지워지는데(사용자가 "로그아웃"으로 기대하는
     * 최소한이다), 그러면 서버의 세션은 살아 있고 그 안의 토큰은 **이 기기**를 가리킨다.
     * 다음에 다른 계정이 이 기기에 로그인하면 앞 계정의 알림(통화 제목·문구)이 여기로
     * 온다. 토큰을 버리면 그 세션의 토큰은 죽은 값이 되고 — 다음 발송·통화가 거부를
     * 받는 순간 서버가 세션에서 뗀다(`clearPushTokenIfMatches`).
     *
     * 성공한 로그아웃에서도 부른다 — 세션이 이미 사라져 잃을 것이 없고, 갈래를 둘로
     * 두면 어느 쪽만 고쳐지는 날이 온다. 던지고 잊는다: 다음 로그인의 되살리기가
     * 새 토큰을 받는다.
     */
    fun deleteToken() {
        if (!enabled) return
        // **버려야 한다는 사실을 먼저 남긴다.** 지금 실패하거나 앱이 죽어도 다음 등록이
        // 그 전에 다시 버린다(`current`) — 성공했을 때만 지운다.
        prefs.edit().putBoolean(KEY_PENDING_DELETE, true).apply()
        scope.launch { awaitDelete() }
    }

    /**
     * 버리기의 본체 — **한 번에 하나만 돈다.** 로그아웃과 다음 등록이 같은 순간에 부르면
     * 같은 일을 기다리고, 성공하면 표식을 지운다.
     */
    private suspend fun awaitDelete(): Boolean {
        // 만들기와 치우기를 한 락 안에서 한다 — 두 스레드가 각자 만들거나, 끝난 일을 치운 뒤에
        // 다른 쪽이 그 끝난 일을 다시 걸어 두는 일이 없게. 치우기는 **일 자체의 완료**에
        // 매단다 — 기다리던 쪽이 취소됐다고 치우면, 아직 도는 일이 있는데 다음 호출이 하나를
        // 더 만든다.
        val job = deleteLock.withLock {
            deleting ?: scope.async { deleteOnce() }.also { created ->
                deleting = created
                created.invokeOnCompletion {
                    scope.launch { deleteLock.withLock { if (deleting === created) deleting = null } }
                }
            }
        }
        return job.await()
    }

    private suspend fun deleteOnce(): Boolean {
        val ok = suspendCancellableCoroutine { cont ->
            FirebaseMessaging.getInstance().deleteToken()
                .addOnSuccessListener { cont.resume(true) }
                .addOnFailureListener {
                    AppLog.d("fcm token delete failed — retried before next registration")
                    cont.resume(false)
                }
        }
        if (ok) prefs.edit().remove(KEY_PENDING_DELETE).apply()
        return ok
    }

    // 던지고 잊는 버리기가 도는 자리. 앱 컨텍스트와 같은 수명이다.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val deleteLock = Mutex()
    private var deleting: Deferred<Boolean>? = null

    /**
     * 이 기기가 **받기로 했는가**. 토큰이 아니라 사람의 선택을 남긴다.
     *
     * 등록은 세션에 붙으므로 로그아웃하면 함께 사라진다(plan/push.md §5-2). 그때마다 다시
     * 누르게 하면 토글이 "켜 두는 것"이 아니라 "매번 켜는 것"이 된다 — 그래서 선택만
     * 남기고, 로그인한 뒤 그 선택대로 조용히 다시 붙인다(§5-16).
     *
     * **설치 단위다 — 계정 단위가 아니다**(§5-21). "이 기기가 받는다"는 선택이라 다음에
     * 로그인한 계정도 그대로 받는다. 앞 계정의 알림이 새는 것은 아니다 — 그 세션의
     * 토큰은 로그아웃에서 버렸다([deleteToken]).
     *
     * **토큰을 남기지 않는 것이 핵심이다.** 토큰은 회전하므로 저장하면 금세 거짓이 된다.
     */
    override fun rememberWanted(wanted: Boolean) {
        prefs.edit().putBoolean(KEY_WANTED, wanted).apply()
    }

    override fun wanted(): Boolean = prefs.getBoolean(KEY_WANTED, false)

    /**
     * 끄기를 시작했다는 표식. 선택(`wanted`)은 서버에서 뗀 뒤에야 바꾸므로, 그 사이에 앱이
     * 죽으면 선택은 켜진 채 서버는 떼였거나 남았거나다 — 이 표식이 "끄다 만 것"임을 말한다.
     */
    override fun rememberDisablePending(pending: Boolean) {
        prefs.edit().putBoolean(KEY_DISABLE_PENDING, pending).apply()
    }

    override fun disablePending(): Boolean = prefs.getBoolean(KEY_DISABLE_PENDING, false)

    /**
     * 권한을 물어본 적이 있는가.
     *
     * **Android는 "아직 안 물었다"와 "영구 거부"를 구분해 주지 않는다.** 둘 다
     * `checkSelfPermission`이 DENIED이고 `shouldShowRequestPermissionRationale`이
     * false다. 물어본 사실을 우리가 남겨야 그 둘이 갈라진다.
     */
    fun rememberAsked() {
        prefs.edit().putBoolean(KEY_ASKED, true).apply()
    }

    private fun hasAsked(): Boolean = prefs.getBoolean(KEY_ASKED, false)

    /**
     * 화면이 그릴 갈래.
     *
     * @param canShowRationale `Activity.shouldShowRequestPermissionRationale`의 값.
     *   Activity가 필요해 화면이 읽어 넘긴다 — 이 클래스는 Activity를 쥐지 않는다.
     */
    fun permission(canShowRationale: Boolean): PushPermission = when {
        !enabled -> PushPermission.UNSUPPORTED
        permissionGranted() -> PushPermission.GRANTED
        // **33 미만에는 물어볼 창이 없다.** 런타임 권한이 없으니 여기까지 왔다는 것은
        // 설정에서 껐다는 뜻이고, 앱이 다시 물을 방법은 없다 — `ASKABLE`로 두면 눌러도
        // 아무 일이 없는 켜기 버튼이 선다(§5-17이 막으려던 바로 그 자리다. `current()`가
        // 권한을 보고 null을 돌려주므로 정말로 아무 일도 일어나지 않는다).
        // `DENIED`는 할 수 있는 일을 정확히 말한다: 설정에서 켜세요.
        //
        // 채널만 끈 경우도 여기로 온다 — 런타임 권한은 있으니 `canShowRationale`이 무엇이든
        // 시스템 창으로는 고칠 수 없고, 설정의 채널 스위치가 유일한 길이다.
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> PushPermission.DENIED
        runtimePermissionGranted() -> PushPermission.DENIED
        !hasAsked() || canShowRationale -> PushPermission.ASKABLE
        else -> PushPermission.DENIED
    }

    private fun runtimePermissionGranted(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
}

/**
 * FCM이 토큰을 돌렸다는 신호.
 *
 * `PrismMessagingService.onNewToken`은 서비스라 세션의 것(코디네이터)에 닿을 수 없고,
 * 로그인해 있지 않을 때도 불린다. 그래서 사실만 남기고, 살아 있는 세션의
 * [PushRegistration]이 이것을 듣고 새 토큰을 붙인다. 세션이 없으면 다음 로그인의
 * 되살리기가 같은 일을 한다. `PushLinks`와 같은 모양(프로세스 메모리)이다.
 */
object PushTokenRotations {
    private val _count = kotlinx.coroutines.flow.MutableStateFlow(0)
    val count: kotlinx.coroutines.flow.StateFlow<Int> = _count

    fun note() {
        _count.value = _count.value + 1
    }
}
