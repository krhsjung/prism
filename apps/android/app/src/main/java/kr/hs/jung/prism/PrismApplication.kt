package kr.hs.jung.prism

import android.app.Application
import com.kakao.sdk.common.KakaoSdk
import kr.hs.jung.prism.core.di.ServiceContainer
import kr.hs.jung.prism.core.push.createNotificationChannels
import kr.hs.jung.prism.core.util.AppLog

/**
 * 의존성 컨테이너를 만들어 앱 수명 동안 들고 있는다.
 * 화면·ViewModel은 여기서 컨테이너를 얻어 필요한 것만 꺼낸다.
 */
class PrismApplication : Application() {
    lateinit var container: ServiceContainer
        private set

    override fun onCreate() {
        super.onCreate()
        initKakao()
        // 알림 채널은 **첫 알림보다 먼저** 있어야 한다(26+). 없는 채널로 알림을 내면
        // 시스템이 조용히 버리고, 그건 "푸시가 안 온다"로만 보인다.
        createNotificationChannels(this)
        container = ServiceContainer(this)
    }

    /**
     * Kakao SDK는 로그인 전에 네이티브 앱 키로 한 번 초기화돼 있어야 한다. 키가 비어 있으면
     * (미설정 빌드) 초기화를 건너뛴다 — 카카오 로그인만 막히고 데모·구글은 그대로 동작한다.
     */
    private fun initKakao() {
        val key = BuildConfig.KAKAO_NATIVE_APP_KEY
        if (key.isBlank()) {
            AppLog.d("KAKAO_NATIVE_APP_KEY not set — Kakao login disabled")
            return
        }
        KakaoSdk.init(this, key)
    }
}
