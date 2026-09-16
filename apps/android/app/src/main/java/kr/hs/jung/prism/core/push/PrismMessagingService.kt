package kr.hs.jung.prism.core.push

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.getSystemService
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kr.hs.jung.prism.BuildConfig
import kr.hs.jung.prism.MainActivity
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.withAppLocale
import kr.hs.jung.prism.core.util.AppLog
import kr.hs.jung.prism.domain.model.PushActionSet
import kr.hs.jung.prism.domain.model.PushDataKey
import kr.hs.jung.prism.domain.model.PushKind
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * FCM 수신기 — **알림을 그리는 곳은 여기 하나다.**
 *
 * 서버는 Android에 `notification` 블록을 보내지 않고 그릴 재료를 전부 `data`로 싣는다
 * (plan/push.md §5-20). data 메시지는 앱이 앞에 있든 뒤에 있든 이 메서드로 온다.
 *
 * ⚠️ 예전에는 `notification` 블록이 함께 와서, **앱이 뒤에 있으면 이 클래스가 불리지
 * 않고 FCM SDK가 대신 그렸다.** 그 알림은 우리 것과 달랐다 — 버튼이 없고(FCM v1의
 * `AndroidNotification`에 버튼 필드가 없다), 아이콘은 매니페스트 기본값인 런처 아이콘으로
 * 떨어졌고, 반대로 앞에서 받은 우리 알림에는 이미지가 빠져 있었다. 앞/뒤가 아이콘·버튼·
 * 이미지 셋 다 서로 반대로 갈려 있었다.
 */
class PrismMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val kind = PushKind.from(data[PushDataKey.KIND])
        val callId = data[PushDataKey.CALL_ID]

        // 통화는 **화면이 떠 있을 때만 곧바로** 받는다 — 알림을 거치지 않고 소켓으로
        // 이어 가며, `resume`으로 아직 살아 있는지 묻는다.
        //
        // ⚠️ **뒤에 있을 때는 넘기지 않는다.** 이제 뒤에서도 여기가 불리므로, 그대로
        // 넘기면 사람이 알림을 누르지도 않았는데 다음에 앱을 열 때 통화 화면으로 튄다.
        // 뒤에서는 알림을 누르는 것이 그 의사표시다(`MainActivity`가 인텐트에서 읽는다).
        // 이 메서드가 앞에서만 불리던 때의 동작을 그대로 지킨다.
        if (kind == PushKind.CALL && callId != null && isInForeground()) {
            PushLinks.offer(callId)
        }

        // 문구는 data에서 읽되, **없으면 `notification` 블록으로 물러난다.** 옛 서버는 문구를
        // 그쪽에만 실었다 — 이 앱이 먼저 깔리고 서버가 나중에 올라가는 동안 data만 보면,
        // 앱이 앞에 있을 때 받은 알림을 **아무것도 그리지 않고 버린다.**
        val title = data[PushDataKey.TITLE] ?: message.notification?.title ?: return
        show(
            title = title,
            body = data[PushDataKey.BODY] ?: message.notification?.body.orEmpty(),
            channelId = if (kind == PushKind.CALL) CHANNEL_CALLS else CHANNEL_GENERAL,
            data = data,
        )
    }

    /**
     * 앱이 사람 앞에 있는가.
     *
     * `ProcessLifecycleOwner`를 쓰려면 의존성이 하나 늘어 시스템이 이미 주는 값을 읽는다 —
     * 이 프로세스의 중요도가 "보이는 것"인지만 알면 된다.
     */
    private fun isInForeground(): Boolean {
        val info = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(info)
        return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
            info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
    }

    /**
     * 알림에 붙일 그림을 내려받는다. **실패하면 null** — 그림 없이 문구만 뜬다.
     *
     * 예전에는 FCM SDK가 `notification.image`를 받아 붙였는데, 이제 그 블록이 없으니
     * 우리가 한다. 이 메서드는 이미 작업 스레드에서 불리고 몇 초의 시간이 주어지므로
     * 그 안에서 끝낸다 — 타임아웃을 짧게 잡아 알림 자체가 늦지 않게 한다.
     *
     * iOS 알림 확장이 택한 결말과 같다: **실패의 결말이 "알림이 안 뜬다"가 아니라
     * "그림이 빠진다"** 여야 한다. 주소는 서버가 https만 통과시켰다(§5-11).
     */
    private fun downloadImage(url: String?): Bitmap? {
        if (url.isNullOrBlank()) return null
        // **한도를 둔다** — 연결·읽기 타임아웃은 "한 번 기다리는 시간"이라 조금씩 흘려보내는
        // 응답은 끝없이 붙들 수 있고, 크기 상한이 없으면 큰 그림 하나가 메모리를 다 쓴다.
        // 전체 시간은 다른 스레드에 맡기고 넘기면 연결을 끊어 읽기를 깨운다. 바이트도 자르고,
        // 표본 추출로 작게 푼다.
        val executor = Executors.newSingleThreadExecutor()
        // 연결은 두 스레드가 본다 — 일꾼이 세우고, 시간이 넘치면 부른 쪽이 끊어 읽기를 깨운다.
        val connection = java.util.concurrent.atomic.AtomicReference<HttpURLConnection?>(null)
        return try {
            val future = executor.submit<Bitmap?> {
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = IMAGE_TIMEOUT_MS
                    readTimeout = IMAGE_TIMEOUT_MS
                }
                connection.set(conn)
                try {
                    val bytes = conn.inputStream.use { readBounded(it) } ?: return@submit null
                    decodeSampled(bytes)
                } finally {
                    // 일꾼이 자기 연결을 반드시 닫는다 — 부른 쪽이 늦게 세워진 연결을 놓쳐도 새지 않는다.
                    conn.disconnect()
                }
            }
            future.get(IMAGE_TIMEOUT_MS.toLong(), TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            AppLog.d("push image timed out")
            null
        } catch (e: Exception) {
            AppLog.d("push image unavailable")
            null
        } finally {
            connection.get()?.disconnect()
            executor.shutdownNow()
        }
    }

    /** 바이트 상한 안에서 전부 읽는다. 넘기면 null — 그림 없이 문구만 뜬다. */
    private fun readBounded(input: java.io.InputStream): ByteArray? {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) return out.toByteArray()
            if (out.size() + read > IMAGE_MAX_BYTES) return null
            out.write(buffer, 0, read)
        }
    }

    /** 긴 변이 [IMAGE_MAX_EDGE_PX]를 넘지 않게 표본을 줄여 푼다 — 알림에는 그 이상이 필요 없다. */
    private fun decodeSampled(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > IMAGE_MAX_EDGE_PX) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }

    /**
     * 알림을 누르면 갈 곳.
     *
     * **통화는 앱이 자기 화면으로 연다**(`PushLinks`). 그 밖의 알림에서 링크가 **우리 주소면
     * 앱 안의 그 화면**으로(딥링크 — 인텐트 엑스트라로 `MainActivity`에 실어 `PushLinks`가
     * 읽는다), 바깥 주소면 브라우저로, 없으면 앱을 연다(plan/push.md §5-11). 링크는 https만
     * 서버가 통과시켰으므로 여기서 다시 검사하지 않는다 — 두 곳에서 검사하면 규칙이 둘이
     * 되고, 언젠가 한쪽만 고쳐진다.
     */
    private fun openIntent(data: Map<String, String>): PendingIntent {
        val open = PushLinks.resolve(data[PushDataKey.LINK], data[PushDataKey.KIND], BuildConfig.PRISM_API_URL)
        val intent = if (open is PushOpen.External) {
            Intent(Intent.ACTION_VIEW, Uri.parse(open.link))
        } else {
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                // 시스템이 그린 알림이 주는 것과 **같은 모양**으로 싣는다 — 두 경로가
                // MainActivity에서 한 코드로 읽히게(PushLinks.offerFrom).
                for ((key, value) in data) putExtra(key, value)
            }
        }
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** 알림만 지우는 인텐트. 화면을 띄우지 않는다. */
    private fun dismissIntent(): PendingIntent = PendingIntent.getBroadcast(
        this,
        1,
        Intent(this, PushDismissReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /**
     * 토큰이 회전했다(재설치·데이터 삭제·백업 복원·로그아웃의 `deleteToken`).
     *
     * **여기서 붙이지 않는다.** 붙이려면 액세스 토큰이 있어야 하는데, 이 콜백은 로그인해
     * 있지 않을 때도 불린다 — 그 자리에서 인증을 끌어오면 메시징 서비스가 세션의 일을
     * 알게 된다. 사실만 남기면 살아 있는 세션의 코디네이터(`PushRegistration`)가 듣고
     * 지금 값을 받아 다시 붙인다. 세션이 없으면 다음 로그인의 되살리기가 같은 일을 한다.
     */
    override fun onNewToken(token: String) {
        // 토큰 값은 로그에 남기지 않는다 — 설치 단위 식별자이고 로그는 기기에 남는다.
        AppLog.d("fcm token rotated")
        PushTokenRotations.note()
    }

    // Lint는 `permissionGranted()` 안을 보지 못한다 — 검사가 `PushTokens`에 있어서
    // 호출부에서는 가드가 없는 것처럼 읽힌다. 검사를 여기로 복제하면 33 미만의 예외
    // (런타임 권한이 없다)까지 두 곳이 되고, 둘이 갈라지는 날 알림이 조용히 사라진다.
    // 가드는 `notify` **바로 위 한 줄**에 있다.
    @SuppressLint("MissingPermission")
    private fun show(
        title: String,
        body: String,
        channelId: String,
        data: Map<String, String>,
    ) {
        createNotificationChannels(this)
        val pending = openIntent(data)
        val builder = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            // 26 미만(minSdk 24)에는 채널이 없어 소리·진동과 중요도를 알림이 직접 말해야 한다 —
            // 없으면 첫 알림이 조용히 뜬다. 26+에서는 채널이 이 값을 덮는다.
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setPriority(
                if (channelId == CHANNEL_CALLS) NotificationCompat.PRIORITY_HIGH
                else NotificationCompat.PRIORITY_DEFAULT,
            )

        // 버튼의 **문구는 서버가 보내지 않는다** — 여기서 자기 언어로 그린다(§5-13).
        // iOS가 등록 시점에 문구를 굳혀야 해서 서버가 요청의 언어를 알 수 없고,
        // 그 하나 때문에 서버 문구 마스터에 사본을 두면 client.csv와 갈라진다.
        // 버튼은 **첫 알림부터** 붙는다 — 그림과 무관하다.
        // 문구는 **앱에서 고른 언어**로 그린다 — 서비스의 컨텍스트는 기기 언어라, 그대로 쓰면
        // 앱은 한국어인데 버튼만 영어가 된다(`MainActivity`가 같은 래퍼를 쓴다).
        val localized = withAppLocale()
        val actions = PushActionSet.from(data[PushDataKey.ACTIONS]) ?: PushActionSet.NONE
        if (actions != PushActionSet.NONE) {
            builder.addAction(0, localized.getString(R.string.push_action_open), pending)
        }
        if (actions == PushActionSet.OPEN_DISMISS) {
            // 닫기는 **아무것도 열지 않는다** — 알림을 치우려고 누른 사람에게 화면을
            // 띄우면 버튼을 둔 의미가 반대로 뒤집힌다. 알림만 사라진다.
            builder.addAction(
                0,
                localized.getString(R.string.push_action_dismiss),
                dismissIntent(),
            )
        }

        // 33+에서 권한이 없으면 조용히 무시된다 — 예외가 아니라 "안 뜬다"가 결말이다.
        if (!PushTokens(this).permissionGranted()) return
        val manager = NotificationManagerCompat.from(this)
        // **문구를 먼저 띄운다.** 그림을 내려받는 동안(상한 5초) 알림이 늦어지면 통화
        // 알림은 그만큼 45초 창을 잃는다 — 그림은 오면 붙이고, 안 오면 이 상태가 결말이다.
        // 이 첫 알림은 **울린다** — 앞의 알림이 남아 있어도 새 메시지는 새 소식이다.
        manager.notify(NOTIFICATION_ID, builder.build())

        // 그림은 펼친 알림에 크게, 접힌 알림에는 오른쪽에 작게 붙인다. 펼쳤을 때 큰 그림이
        // 그 자리를 차지하므로 작은 그림은 치운다(`bigLargeIcon(null)`) — 같은 그림이
        // 두 번 보이지 않게. 그림을 붙이는 두 번째 알림은 소리·진동 없이 내용만 바뀐다.
        val image = downloadImage(data[PushDataKey.IMAGE]) ?: return
        builder
            .setOnlyAlertOnce(true)
            .setLargeIcon(image)
            .setStyle(
                NotificationCompat.BigPictureStyle()
                    .bigPicture(image)
                    .bigLargeIcon(null as Bitmap?),
            )
        // 사람이 그사이 알림을 치웠을 수 있다 — 다시 세우지 않는다.
        val shown = getSystemService<android.app.NotificationManager>()
            ?.activeNotifications
            ?.any { it.id == NOTIFICATION_ID } ?: false
        if (!shown) return
        manager.notify(NOTIFICATION_ID, builder.build())
    }
}

// 알림 하나만 유지한다 — 이 앱의 알림은 "지금 걸려 온 통화"와 "방금 보낸 테스트"뿐이라
// 쌓아 둘 이유가 없고, 쌓으면 지난 통화의 알림이 남아 되걸기를 헷갈리게 한다.
internal const val NOTIFICATION_ID = 1

/** 알림 그림을 기다리는 상한(연결·읽기 각각, 그리고 **전체**). 넘기면 그림 없이 문구만 띄운다. */
private const val IMAGE_TIMEOUT_MS = 5_000

/** 알림 그림의 바이트 상한. 알림에 붙는 그림이 이보다 클 이유가 없다. */
private const val IMAGE_MAX_BYTES = 1_024 * 1_024

/** 알림 그림의 긴 변 상한(px). 그 이상은 표본을 줄여 푼다. */
private const val IMAGE_MAX_EDGE_PX = 1_024
