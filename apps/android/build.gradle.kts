// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    // google-services는 **조건부로 적용된다**(app/build.gradle.kts) — google-services.json이
    // 없으면 플러그인이 빌드를 실패시키는데, 시크릿 없이도 클론해서 빌드되는 성질을
    // 지켜야 한다(secrets.properties와 같은 규칙).
    alias(libs.plugins.google.services) apply false
}