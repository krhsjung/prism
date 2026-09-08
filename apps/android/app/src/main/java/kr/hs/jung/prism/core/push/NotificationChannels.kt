package kr.hs.jung.prism.core.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.content.getSystemService
import kr.hs.jung.prism.R

/**
 * 알림 채널. **통화와 데모를 가른다** — 한 채널에 넣으면 사용자가 하나를 끌 때 둘 다
 * 꺼진다. 서버도 페이로드에서 같은 두 값을 보낸다(`libs/push/src/fcm-message.ts`).
 */
const val CHANNEL_CALLS = "prism_calls"
const val CHANNEL_GENERAL = "prism_general"

fun createNotificationChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService<NotificationManager>() ?: return
    manager.createNotificationChannel(
        NotificationChannel(
            CHANNEL_CALLS,
            context.getString(R.string.push_channel_calls),
            // 통화는 사람을 기다리게 하는 알림이라 배너로 떠야 한다.
            NotificationManager.IMPORTANCE_HIGH,
        ),
    )
    manager.createNotificationChannel(
        NotificationChannel(
            CHANNEL_GENERAL,
            context.getString(R.string.push_channel_general),
            NotificationManager.IMPORTANCE_DEFAULT,
        ),
    )
}
