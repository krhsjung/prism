package kr.hs.jung.prism.core.util

import android.util.Log
import kr.hs.jung.prism.BuildConfig

/**
 * 로깅 한 겹.
 *
 * 인증 흐름을 다루는 앱이라 "무엇을 남기지 않는가"가 규칙의 절반이다 — 세션 쿠키·
 * 표시 이름은 인자로 넘기지 않는다(plan/auth.md §7). 여기 들어온 문자열은 평문으로
 * 남는다고 보면 된다. 디버그 빌드에서만 출력한다.
 */
object AppLog {
    private const val TAG = "prism"

    fun d(message: String) {
        if (BuildConfig.DEBUG) Log.d(TAG, message)
    }

    fun e(message: String, error: Throwable? = null) {
        if (BuildConfig.DEBUG) Log.e(TAG, message, error)
    }
}
