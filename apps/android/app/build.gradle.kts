import java.net.URI
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
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
fun isValidHttpsUrl(value: String): Boolean = try {
    val uri = URI(value)
    uri.scheme == "https" && !uri.host.isNullOrBlank()
} catch (e: Exception) {
    false
}
gradle.taskGraph.whenReady {
    val buildingRelease = allTasks.any { it.name.contains("Release", ignoreCase = false) }
    if (buildingRelease && !isValidHttpsUrl(releaseApiUrl)) {
        throw GradleException(
            "Release builds require a valid https PRISM_API_URL with a host " +
                "(set -PprismApiUrl=… or PRISM_API_URL). Got: '$releaseApiUrl'",
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
        // Kakao 로그인 redirect 스킴(kakao{앱키}://oauth)을 AndroidManifest에 채운다.
        manifestPlaceholders["kakaoNativeAppKey"] = kakaoNativeAppKey
    }

    // 번역 산출물은 전용 생성 소스셋에 있다(i18n 생성기가 채운다). 손으로 쓴 res/와
    // 섞이지 않아 잔재 정리가 안전하다 — i18n/README.md 참고.
    sourceSets["main"].res.srcDir("src/generated/res")

    buildTypes {
        debug {
            buildConfigField("String", "PRISM_API_URL", "\"$debugApiUrl\"")
        }
        release {
            buildConfigField("String", "PRISM_API_URL", "\"$releaseApiUrl\"")
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
