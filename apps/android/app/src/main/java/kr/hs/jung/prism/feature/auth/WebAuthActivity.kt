package kr.hs.jung.prism.feature.auth

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity

/**
 * 웹 redirect 로그인의 브라우저 탭을 열고, 콜백(커스텀 스킴)을 잡아 [WebAuthCoordinator]에
 * 넘기는 투명 액티비티. iOS의 ASWebAuthenticationSession이 한 몸으로 하던 "열기 + 콜백
 * 캡처 + 취소 감지"를 Android에서는 이 액티비티가 대신한다.
 *
 * 흐름:
 *  1. 처음 [onResume]에서 Custom Tab을 연다(그 뒤 탭이 화면을 덮어 이 액티비티는 멈춘다).
 *  2. 서버 콜백 `prism://auth/callback?code=…`은 매니페스트 intent-filter로 다시 이 액티비티에
 *     (singleTop → [onNewIntent]) 배달된다 → 코드/오류를 코디네이터에 넘기고 끝낸다.
 *  3. 사용자가 탭을 닫고 콜백 없이 돌아오면 [onResume]이 다시 불린다 → 취소로 처리한다.
 *
 * 회전으로 인한 재생성이 취소로 오인되지 않도록 매니페스트에서 configChanges를 잡는다.
 */
class WebAuthActivity : ComponentActivity() {
    private var launched = false
    private var delivered = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        launched = savedInstanceState?.getBoolean(STATE_LAUNCHED) ?: false
        // 딥링크로 (재)진입했다면 콜백을 바로 처리한다.
        if (intent?.data != null) handleCallback()
    }

    override fun onResume() {
        super.onResume()
        if (delivered) return
        if (!launched) {
            val url = intent?.getStringExtra(EXTRA_URL)
            if (url == null) {
                finish()
                return
            }
            try {
                CustomTabsWebAuth.launch(this, url)
                launched = true
            } catch (e: Exception) {
                // 탭을 열 브라우저가 없다 — 실패로 돌린다.
                WebAuthCoordinator.deliverError()
                delivered = true
                finish()
            }
        } else {
            // 탭에서 콜백 없이 돌아왔다 = 사용자가 닫았다(취소).
            WebAuthCoordinator.cancel()
            delivered = true
            finish()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCallback()
    }

    /** 콜백 URL(`…?code=…` | `…?error=…`)에서 결과를 뽑아 코디네이터에 넘긴다. */
    private fun handleCallback() {
        val data = intent?.data ?: return
        val code = data.getQueryParameter("code")
        val error = data.getQueryParameter("error")
        when {
            !code.isNullOrEmpty() -> WebAuthCoordinator.deliverCode(code)
            error != null -> WebAuthCoordinator.deliverError()
            else -> WebAuthCoordinator.cancel()
        }
        delivered = true
        finish()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(STATE_LAUNCHED, launched)
    }

    companion object {
        private const val EXTRA_URL = "web_auth_url"
        private const val STATE_LAUNCHED = "web_auth_launched"

        fun intent(context: Context, url: String): Intent =
            Intent(context, WebAuthActivity::class.java).putExtra(EXTRA_URL, url)
    }
}
