package kr.hs.jung.prism.core.push

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kr.hs.jung.prism.BuildConfig
import kr.hs.jung.prism.MainActivity
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.util.AppLog
import kr.hs.jung.prism.domain.model.PushActionSet
import kr.hs.jung.prism.domain.model.PushDataKey

/**
 * FCM 수신기.
 *
 * **앱이 꺼져 있거나 백그라운드면 이 클래스는 불리지 않는다** — 서버가 `notification`을
 * 함께 보내므로 시스템이 알림을 직접 그리고, 누르면 `MainActivity`가 데이터를 인텐트
 * 엑스트라로 받는다(plan/push.md D4).
 *
 * 여기가 불리는 것은 **앱이 떠 있을 때**다. 그때는 시스템이 아무것도 그리지 않으므로
 * 우리가 그린다 — 안 그리면 다른 화면을 보고 있는 사용자에게 아무 일도 일어나지 않는다.
 */
class PrismMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val kind = data[PushDataKey.KIND]
        val callId = data[PushDataKey.CALL_ID]

        // 통화는 **화면이 먼저 받는다.** 앱이 떠 있으니 알림을 거치지 않고 바로
        // 이어 갈 수 있다 — 소켓을 붙이고 `resume`으로 아직 살아 있는지 묻는다.
        if (kind == PUSH_KIND_CALL && callId != null) {
            PushLinks.offer(callId)
        }

        val notification = message.notification ?: return
        show(
            title = notification.title.orEmpty(),
            body = notification.body.orEmpty(),
            channelId = if (kind == PUSH_KIND_CALL) CHANNEL_CALLS else CHANNEL_GENERAL,
            data = data,
        )
    }

    /**
     * 알림을 누르면 갈 곳.
     *
     * **링크가 있으면 그 주소를 열고**, 없으면 앱을 연다(plan/push.md §5-11). 링크는
     * https만 서버가 통과시켰으므로 여기서 다시 검사하지 않는다 — 두 곳에서 검사하면
     * 규칙이 둘이 되고, 언젠가 한쪽만 고쳐진다.
     */
    private fun openIntent(data: Map<String, String>): PendingIntent {
        val link = data[PushDataKey.LINK]
        val intent = if (link.isNullOrBlank() || isAppLink(link)) {
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                // 시스템이 그린 알림이 주는 것과 **같은 모양**으로 싣는다 — 두 경로가
                // MainActivity에서 한 코드로 읽히게(PushLinks.offerFrom).
                for ((key, value) in data) putExtra(key, value)
            }
        } else {
            Intent(Intent.ACTION_VIEW, Uri.parse(link))
        }
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** 우리 웹 앱의 주소인가 — 그러면 브라우저가 아니라 앱을 연다. */
    private fun isAppLink(link: String): Boolean =
        BuildConfig.PRISM_API_URL.isNotBlank() && link.startsWith(BuildConfig.PRISM_API_URL)

    /** 알림만 지우는 인텐트. 화면을 띄우지 않는다. */
    private fun dismissIntent(): PendingIntent = PendingIntent.getBroadcast(
        this,
        1,
        Intent(this, PushDismissReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /**
     * 토큰이 회전했다(재설치·데이터 삭제·백업 복원).
     *
     * **여기서 붙이지 않는다.** 붙이려면 액세스 토큰이 있어야 하는데, 이 콜백은 로그인해
     * 있지 않을 때도 불린다 — 그 자리에서 인증을 끌어오면 메시징 서비스가 세션의 일을
     * 알게 된다.
     *
     * 대신 **다음 로그인이 낫는다**(plan/push.md §5-16). 로그인할 때마다 지금 토큰을 받아
     * 다시 붙이므로, 회전은 재로그인 한 번으로 사라진다. 한 세션을 오래 열어 둔 채
     * 회전한 경우에만 그때까지 죽은 토큰이 남고, 푸시 화면에서 껐다 켜면 낫는다.
     */
    override fun onNewToken(token: String) {
        // 토큰 값은 로그에 남기지 않는다 — 설치 단위 식별자이고 로그는 기기에 남는다.
        AppLog.d("fcm token rotated")
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

        // 버튼의 **문구는 서버가 보내지 않는다** — 여기서 자기 언어로 그린다(§5-13).
        // iOS가 등록 시점에 문구를 굳혀야 해서 서버가 요청의 언어를 알 수 없고,
        // 그 하나 때문에 서버 문구 마스터에 사본을 두면 client.csv와 갈라진다.
        val actions = PushActionSet.from(data[PushDataKey.ACTIONS]) ?: PushActionSet.NONE
        if (actions != PushActionSet.NONE) {
            builder.addAction(0, getString(R.string.push_action_open), pending)
        }
        if (actions == PushActionSet.OPEN_DISMISS) {
            // 닫기는 **아무것도 열지 않는다** — 알림을 치우려고 누른 사람에게 화면을
            // 띄우면 버튼을 둔 의미가 반대로 뒤집힌다. 알림만 사라진다.
            builder.addAction(
                0,
                getString(R.string.push_action_dismiss),
                dismissIntent(),
            )
        }
        val notification = builder.build()

        // 33+에서 권한이 없으면 조용히 무시된다 — 예외가 아니라 "안 뜬다"가 결말이다.
        if (!PushTokens(this).permissionGranted()) return
        NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, notification)
    }
}

// 알림 하나만 유지한다 — 이 앱의 알림은 "지금 걸려 온 통화"와 "방금 보낸 테스트"뿐이라
// 쌓아 둘 이유가 없고, 쌓으면 지난 통화의 알림이 남아 되걸기를 헷갈리게 한다.
internal const val NOTIFICATION_ID = 1
