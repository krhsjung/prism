// GENERATED FILE — DO NOT EDIT.
// 원본: i18n/client.csv, i18n/locales.json
// 재생성: i18n에서 `pnpm generate`

import Foundation

/// 지원 언어 — locales.json의 순서 그대로이며, 첫 항목이 기본 언어다.
enum AppLocale: String, CaseIterable, Sendable {
    case en
    case ko
    case ja

    /// 목록에 그리는 이름. 각 언어를 **그 언어로** 적는다 — 지금 화면 언어를 못 읽는
    /// 사용자가 쓰는 장치라, 현재 언어로 번역해 두면 정작 필요한 사람이 찾지 못한다.
    var label: String {
        switch self {
        case .en: "English"
        case .ko: "한국어"
        case .ja: "日本語"
        }
    }
}

/// 번역 키 — 값은 마스터의 `{module}.{key}`이고, `table`은 그 키가 실린 카탈로그다.
enum MessageKey: String, CaseIterable, Sendable {
    // Common
    case commonLoading = "common.loading"
    case commonLanguage = "common.language"
    case commonTheme = "common.theme"
    case commonCancel = "common.cancel"
    // Theme
    case themeSystem = "theme.system"
    case themeLight = "theme.light"
    case themeDark = "theme.dark"
    // Auth
    case authWelcomeBack = "auth.welcome_back"
    case authSignInToContinue = "auth.sign_in_to_continue"
    case authContinueWithGoogle = "auth.continue_with_google"
    case authContinueWithApple = "auth.continue_with_apple"
    case authContinueWithKakao = "auth.continue_with_kakao"
    case authTryTheDemo = "auth.try_the_demo"
    case authConnecting = "auth.connecting"
    case authNoPersonalData = "auth.no_personal_data"
    case authSigningYouIn = "auth.signing_you_in"
    // Dashboard
    case dashboardTitle = "dashboard.title"
    case dashboardSignedInAs = "dashboard.signed_in_as"
    case dashboardLogOut = "dashboard.log_out"
    case dashboardLoggingOut = "dashboard.logging_out"
    case dashboardPlaceholderBody = "dashboard.placeholder_body"
    case dashboardNavWebrtc = "dashboard.nav_webrtc"
    case dashboardComingSoon = "dashboard.coming_soon"
    case dashboardNavigation = "dashboard.navigation"
    case dashboardOpenMenu = "dashboard.open_menu"
    case dashboardCloseMenu = "dashboard.close_menu"
    case dashboardActiveSessions = "dashboard.active_sessions"
    case dashboardActiveSessionsDesc = "dashboard.active_sessions_desc"
    case dashboardSignOutAll = "dashboard.sign_out_all"
    case dashboardSigningOutAll = "dashboard.signing_out_all"
    case dashboardSignOutAllConfirmTitle = "dashboard.sign_out_all_confirm_title"
    case dashboardSignOutAllConfirmBody = "dashboard.sign_out_all_confirm_body"
    case dashboardColDevice = "dashboard.col_device"
    case dashboardColStarted = "dashboard.col_started"
    case dashboardColExpires = "dashboard.col_expires"
    case dashboardColStatus = "dashboard.col_status"
    case dashboardStatusCurrent = "dashboard.status_current"
    case dashboardStatusActive = "dashboard.status_active"
    case dashboardDeviceIphone = "dashboard.device_iphone"
    case dashboardDeviceIpad = "dashboard.device_ipad"
    case dashboardDeviceGalaxy = "dashboard.device_galaxy"
    case dashboardDevicePixel = "dashboard.device_pixel"
    case dashboardDeviceAndroid = "dashboard.device_android"
    case dashboardDeviceMac = "dashboard.device_mac"
    case dashboardDeviceWindows = "dashboard.device_windows"
    case dashboardDeviceDesktop = "dashboard.device_desktop"
    case dashboardDeviceUnknown = "dashboard.device_unknown"
    case dashboardThisSession = "dashboard.this_session"
    case dashboardASession = "dashboard.a_session"
    case dashboardRevoke = "dashboard.revoke"
    case dashboardOnlyThisSession = "dashboard.only_this_session"
    case dashboardRetry = "dashboard.retry"
    // Error
    case errorGeneric = "error.generic"
    case errorSigninFailed = "error.signin_failed"
    case errorDemoDisabled = "error.demo_disabled"
    case errorNetworkError = "error.network_error"
    case errorProviderUnavailable = "error.provider_unavailable"
    case errorLogoutFailed = "error.logout_failed"
    case errorSessionsLoadFailed = "error.sessions_load_failed"
    case errorRevokeFailed = "error.revoke_failed"
    case errorSessionEnded = "error.session_ended"

    /// 키가 실린 .xcstrings 카탈로그 이름.
    var table: String {
        switch self {
        case .commonLoading,
             .commonLanguage,
             .commonTheme,
             .commonCancel:
            "Common"
        case .themeSystem,
             .themeLight,
             .themeDark:
            "Theme"
        case .authWelcomeBack,
             .authSignInToContinue,
             .authContinueWithGoogle,
             .authContinueWithApple,
             .authContinueWithKakao,
             .authTryTheDemo,
             .authConnecting,
             .authNoPersonalData,
             .authSigningYouIn:
            "Auth"
        case .dashboardTitle,
             .dashboardSignedInAs,
             .dashboardLogOut,
             .dashboardLoggingOut,
             .dashboardPlaceholderBody,
             .dashboardNavWebrtc,
             .dashboardComingSoon,
             .dashboardNavigation,
             .dashboardOpenMenu,
             .dashboardCloseMenu,
             .dashboardActiveSessions,
             .dashboardActiveSessionsDesc,
             .dashboardSignOutAll,
             .dashboardSigningOutAll,
             .dashboardSignOutAllConfirmTitle,
             .dashboardSignOutAllConfirmBody,
             .dashboardColDevice,
             .dashboardColStarted,
             .dashboardColExpires,
             .dashboardColStatus,
             .dashboardStatusCurrent,
             .dashboardStatusActive,
             .dashboardDeviceIphone,
             .dashboardDeviceIpad,
             .dashboardDeviceGalaxy,
             .dashboardDevicePixel,
             .dashboardDeviceAndroid,
             .dashboardDeviceMac,
             .dashboardDeviceWindows,
             .dashboardDeviceDesktop,
             .dashboardDeviceUnknown,
             .dashboardThisSession,
             .dashboardASession,
             .dashboardRevoke,
             .dashboardOnlyThisSession,
             .dashboardRetry:
            "Dashboard"
        case .errorGeneric,
             .errorSigninFailed,
             .errorDemoDisabled,
             .errorNetworkError,
             .errorProviderUnavailable,
             .errorLogoutFailed,
             .errorSessionsLoadFailed,
             .errorRevokeFailed,
             .errorSessionEnded:
            "Error"
        }
    }
}
