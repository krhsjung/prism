import java.net.URI
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// FCM 설정 파일이 있을 때만 google-services를 건다.
//
// 이 플러그인은 파일이 없으면 **빌드를 실패시킨다.** 그런데 `google-services.json`은
// 배포마다 다른 값이라 레포에 두지 않으므로(.gitignore), 무조건 걸면 새로 클론한 사람이
// 아무것도 빌드하지 못한다 — `secrets.properties`가 없어도 빌드되는 성질과 같은 자리다.
//
// 파일이 없으면 푸시만 꺼진 앱이 된다. 그 사실은 화면이 말한다(`Notifications off`).
val pushConfigured: Boolean = file("google-services.json").exists()
if (pushConfigured) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

// 커밋되지 않는 로컬 설정 파일(iOS의 Config/Secrets.xcconfig와 같은 자리). 없으면 없는
// 대로 빌드된다 — 새로 클론한 사람은 그대로 빌드되고 소셜 로그인만 비활성이 된다.
// 채울 값은 옆의 secrets.example.properties에 적혀 있다.
//
// `providers.fileContents`로 읽는 이유: 설정 캐시가 이 파일을 **입력으로 추적**한다.
// File을 직접 읽으면 값을 고쳐도 캐시된 설정이 그대로 재사용돼, 바꾼 값이 반영되지 않는다.
val secrets = Properties().apply {
    val text = providers
        .fileContents(rootProject.layout.projectDirectory.file("secrets.properties"))
        .asText.getOrElse("")
    if (text.isNotBlank()) load(text.reader())
}

/**
 * 설정값 한 개를 정해진 우선순위로 고른다:
 * gradle 프로퍼티(-P…) > 환경변수 > secrets.properties > 빈 문자열.
 *
 * 명령줄·환경변수가 파일을 이긴다 — CI나 일회성 빌드가 로컬 파일에 발목 잡히지 않게.
 */
fun secret(property: String, env: String): String =
    (project.findProperty(property) as String?)
        ?: System.getenv(env)
        ?: secrets.getProperty(property)
        ?: ""

// API(=auth 서비스) 주소. 소스에 박지 않고 여기서 BuildConfig로 흘려보낸다 — 웹의
// VITE_API_URL·iOS의 PRISM_API_URL과 같은 역할이다.
val configuredApiUrl: String? =
    secret("prismApiUrl", "PRISM_API_URL").takeIf { it.isNotBlank() }

// 값이 없을 때의 기본값은 **빌드 타입별로** 다르다:
//  - debug: 배포된 개발 서버(iOS `APIConfiguration.developmentURL`과 같은 주소). 에뮬레이터
//    루프백(10.0.2.2)을 기본으로 두면 **실기기에서는 자기 자신을 가리켜** 아무 데도 닿지
//    않는다 — 기기에 설치해 보는 것이 기본 확인 경로이므로 닿는 주소를 기본으로 둔다.
//    호스트에서 서버를 직접 띄웠다면 -PprismApiUrl=http://10.0.2.2:3000 으로 덮어쓴다.
//  - release: 개발 서버를 절대 가리키면 안 되므로 빈 값 — 설정을 빠뜨린 릴리스 빌드는
//    조용히 개발 서버에 붙는 대신 런타임에서 명확히 실패한다.
val debugApiUrl: String = configuredApiUrl ?: "https://hsjung.asuscomm.com"
val releaseApiUrl: String = configuredApiUrl ?: ""

// 세션 소켓(= socket 서비스) 주소. **API에서 유도할 수 없다** — 로컬에서 auth는 :3000이고
// socket은 :3002라 스킴만 바꿔서는 닿지 않는다. 기본값 규칙은 API와 같다.
val configuredSocketUrl: String? =
    secret("prismSocketUrl", "PRISM_SOCKET_URL").takeIf { it.isNotBlank() }
val debugSocketUrl: String = configuredSocketUrl ?: "wss://hsjung.asuscomm.com/socket"
val releaseSocketUrl: String = configuredSocketUrl ?: ""

// 네이티브 소셜 로그인 크리덴셜(비시크릿이지만 커밋 소스에서는 분리한다).
//  - GOOGLE_SERVER_CLIENT_ID: Google Cloud OAuth 2.0 "웹(서버)" 클라이언트 ID.
//    google_sign_in이 이 값으로 받은 id_token의 audience가 서버 검증 대상과 일치해야 한다.
//  - KAKAO_NATIVE_APP_KEY: Kakao 개발자 콘솔의 네이티브 앱 키. SDK 초기화 + redirect 스킴에 쓴다.
// 둘 다 비어 있으면 해당 provider만 비활성(데모·구글/카카오 각각 독립).
val googleServerClientId: String =
    secret("prismGoogleServerClientId", "PRISM_GOOGLE_SERVER_CLIENT_ID")
val kakaoNativeAppKey: String =
    secret("prismKakaoNativeAppKey", "PRISM_KAKAO_NATIVE_APP_KEY")

// 릴리스는 주소가 없거나 평문(비-HTTPS)이거나 **형태가 URL이 아니면** 빌드 시점에
// 실패시킨다 — 설정을 빠뜨린/잘못 준 릴리스가 조용히 빌드된 뒤 로그인만 런타임에서 깨지는
// 것을 막는다. 실제 릴리스 태스크가 그래프에 있을 때만 검사해 debug 빌드는 영향받지 않는다.
fun isValidUrl(value: String, scheme: String): Boolean = try {
    val uri = URI(value)
    uri.scheme == scheme && !uri.host.isNullOrBlank()
} catch (e: Exception) {
    false
}
gradle.taskGraph.whenReady {
    val buildingRelease = allTasks.any { it.name.contains("Release", ignoreCase = false) }
    if (buildingRelease && !isValidUrl(releaseApiUrl, "https")) {
        throw GradleException(
            "Release builds require a valid https PRISM_API_URL with a host " +
                "(set -PprismApiUrl=… or PRISM_API_URL). Got: '$releaseApiUrl'",
        )
    }
    // 소켓 주소도 같은 이유로 막는다 — 빠뜨리면 릴리스가 **소켓 없는 대시보드**를
    // 조용히 출고한다(목록은 뜨지만 연결 상태가 영영 두 갈래로 후퇴한 채다).
    // wss여야 한다: 평문 ws로는 세션 쿠키(__Host- 접두어)가 실리지 않고, 앱의 Bearer도
    // 평문으로 흐른다.
    if (buildingRelease && !isValidUrl(releaseSocketUrl, "wss")) {
        throw GradleException(
            "Release builds require a valid wss PRISM_SOCKET_URL with a host " +
                "(set -PprismSocketUrl=… or PRISM_SOCKET_URL). Got: '$releaseSocketUrl'",
        )
    }
}

android {
    namespace = "kr.hs.jung.prism"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "kr.hs.jung.prism"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // 네이티브 소셜 로그인 크리덴셜을 런타임/매니페스트로 흘려보낸다(빌드 타입 공통).
        buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", "\"$googleServerClientId\"")
        buildConfigField("String", "KAKAO_NATIVE_APP_KEY", "\"$kakaoNativeAppKey\"")
        // 앱이 **푸시를 시도할지**를 여기서 가른다. 설정 파일이 없으면 Firebase
        // 초기화가 실패하는데, 예외를 잡는 것보다 애초에 부르지 않는 편이 읽기 쉽다.
        buildConfigField("boolean", "PUSH_ENABLED", pushConfigured.toString())
        // Kakao 로그인 redirect 스킴(kakao{앱키}://oauth)을 AndroidManifest에 채운다.
        manifestPlaceholders["kakaoNativeAppKey"] = kakaoNativeAppKey
    }

    // 번역 산출물은 전용 생성 소스셋에 있다(i18n 생성기가 채운다). 손으로 쓴 res/와
    // 섞이지 않아 잔재 정리가 안전하다 — i18n/README.md 참고.
    sourceSets["main"].res.srcDir("src/generated/res")

    buildTypes {
        debug {
            buildConfigField("String", "PRISM_API_URL", "\"$debugApiUrl\"")
            buildConfigField("String", "PRISM_SOCKET_URL", "\"$debugSocketUrl\"")
        }
        release {
            buildConfigField("String", "PRISM_API_URL", "\"$releaseApiUrl\"")
            buildConfigField("String", "PRISM_SOCKET_URL", "\"$releaseSocketUrl\"")
            optimization {
                enable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            // JVM 유닛 테스트에서 android.jar 스텁(예: android.util.Log)이 예외를 던지는 대신
            // 기본값을 돌려주게 한다 — 로깅 한 줄 때문에 순수 로직 테스트가 깨지지 않도록.
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.okhttp)
    implementation(libs.androidx.security.crypto)
    // 네이티브 소셜 로그인: Google은 Credential Manager + Google ID, Kakao는 공식 SDK.
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.googleid)
    implementation(libs.kakao.user)
    // 웹 redirect(flow=native) 로그인을 시스템 브라우저 탭으로 연다(iOS의 ASWebAuthenticationSession 대응).
    implementation(libs.androidx.browser)
    // WebRTC 엔진. 브라우저에는 내장돼 있지만 네이티브에는 없다 — 통화 화면이 쓰는
    // PeerConnection·카메라 캡처·렌더러가 전부 여기서 온다(plan/webrtc.md §5).
    implementation(libs.webrtc)
    // FCM. 설정 파일이 없으면 플러그인이 걸리지 않아 초기화가 실패하지만, 앱은
    // `PushTokens`가 그 예외를 접어 푸시 없이 그대로 뜬다.
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    // JVM 유닛 테스트에서 실제 org.json을 쓴다(android.jar의 org.json은 스텁이라 던진다).
    testImplementation(libs.json)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
