package kr.hs.jung.prism.core.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

/**
 * 알림의 `닫기` 버튼.
 *
 * **아무것도 열지 않는다** — 알림을 치우려고 누른 사람에게 화면을 띄우면 버튼을 둔
 * 의미가 반대로 뒤집힌다. Activity가 아니라 BroadcastReceiver인 이유가 그것이다.
 */
class PushDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }
}
