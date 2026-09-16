package kr.hs.jung.prism.core.util

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper

/**
 * Compose가 넘기는 Context는 `ContextThemeWrapper`라 Activity까지 벗겨 낸다.
 *
 * 두 곳이 쓴다 — 환경 설정 스위처(창을 띄울 자리)와 푸시 화면(권한을 다시 물을 수 있는지).
 * 사본을 두면 언젠가 한쪽만 고쳐진다.
 */
internal fun Context.findActivity(): Activity? {
    var context: Context? = this
    while (context is ContextWrapper) {
        if (context is Activity) return context
        context = context.baseContext
    }
    return null
}
