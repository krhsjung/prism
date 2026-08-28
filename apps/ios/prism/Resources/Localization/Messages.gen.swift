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
    case commonRetry = "common.retry"
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
    case dashboardStatusInactive = "dashboard.status_inactive"
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
    // Webrtc
    case webrtcTitle = "webrtc.title"
    case webrtcLobbyTitle = "webrtc.lobby_title"
    case webrtcLobbyDesc = "webrtc.lobby_desc"
    case webrtcCamera = "webrtc.camera"
    case webrtcMicrophone = "webrtc.microphone"
    case webrtcDevices = "webrtc.devices"
    case webrtcDevicesDesc = "webrtc.devices_desc"
    case webrtcCall = "webrtc.call"
    case webrtcWillNotify = "webrtc.will_notify"
    case webrtcNotificationsOff = "webrtc.notifications_off"
    case webrtcNoOtherDevices = "webrtc.no_other_devices"
    case webrtcThisTab = "webrtc.this_tab"
    case webrtcLoopback = "webrtc.loopback"
    case webrtcTest = "webrtc.test"
    case webrtcLoopbackNote = "webrtc.loopback_note"
    case webrtcP2pNote = "webrtc.p2p_note"
    case webrtcCalling = "webrtc.calling"
    case webrtcRingingDesc = "webrtc.ringing_desc"
    case webrtcRingTimeoutNote = "webrtc.ring_timeout_note"
    case webrtcNotifiedDesc = "webrtc.notified_desc"
    case webrtcTileNotified = "webrtc.tile_notified"
    case webrtcIncomingTitle = "webrtc.incoming_title"
    case webrtcIncomingBody = "webrtc.incoming_body"
    case webrtcAccept = "webrtc.accept"
    case webrtcDecline = "webrtc.decline"
    case webrtcDeclined = "webrtc.declined"
    case webrtcExpiredTitle = "webrtc.expired_title"
    case webrtcExpiredBody = "webrtc.expired_body"
    case webrtcMute = "webrtc.mute"
    case webrtcUnmute = "webrtc.unmute"
    case webrtcCameraOff = "webrtc.camera_off"
    case webrtcCameraOn = "webrtc.camera_on"
    case webrtcEndCall = "webrtc.end_call"
    case webrtcYou = "webrtc.you"
    case webrtcLoopbackPeer = "webrtc.loopback_peer"
    case webrtcStatusRinging = "webrtc.status_ringing"
    case webrtcStatusNotified = "webrtc.status_notified"
    case webrtcStatusConnecting = "webrtc.status_connecting"
    case webrtcStatusConnected = "webrtc.status_connected"
    case webrtcStatusReconnecting = "webrtc.status_reconnecting"
    case webrtcStatusFailed = "webrtc.status_failed"
    case webrtcTileRinging = "webrtc.tile_ringing"
    case webrtcTileConnecting = "webrtc.tile_connecting"
    case webrtcTileReconnecting = "webrtc.tile_reconnecting"
    case webrtcTileCameraOff = "webrtc.tile_camera_off"
    case webrtcTilePeerCameraOff = "webrtc.tile_peer_camera_off"
    case webrtcTileNoVideo = "webrtc.tile_no_video"
    case webrtcPeerLeft = "webrtc.peer_left"
    case webrtcDiagnostics = "webrtc.diagnostics"
    case webrtcDiagShow = "webrtc.diag_show"
    case webrtcDiagHide = "webrtc.diag_hide"
    case webrtcDiagQuality = "webrtc.diag_quality"
    case webrtcStatRtt = "webrtc.stat_rtt"
    case webrtcStatJitter = "webrtc.stat_jitter"
    case webrtcStatPacketLoss = "webrtc.stat_packet_loss"
    case webrtcStatSending = "webrtc.stat_sending"
    case webrtcStatReceiving = "webrtc.stat_receiving"
    case webrtcStatVideo = "webrtc.stat_video"
    case webrtcStatUnavailable = "webrtc.stat_unavailable"
    case webrtcDiagConnection = "webrtc.diag_connection"
    case webrtcIcePath = "webrtc.ice_path"
    case webrtcIcePathDirect = "webrtc.ice_path_direct"
    case webrtcIcePathReflexive = "webrtc.ice_path_reflexive"
    case webrtcIcePathRelay = "webrtc.ice_path_relay"
    case webrtcIcePathLoopback = "webrtc.ice_path_loopback"
    case webrtcIceLocal = "webrtc.ice_local"
    case webrtcIceRemote = "webrtc.ice_remote"
    case webrtcIceState = "webrtc.ice_state"
    case webrtcDtlsState = "webrtc.dtls_state"
    case webrtcConnectedFor = "webrtc.connected_for"
    case webrtcIceAddressHidden = "webrtc.ice_address_hidden"
    case webrtcDiagSettings = "webrtc.diag_settings"
    case webrtcIcePolicy = "webrtc.ice_policy"
    case webrtcIcePolicyAll = "webrtc.ice_policy_all"
    case webrtcIcePolicyRelay = "webrtc.ice_policy_relay"
    case webrtcIcePolicyNote = "webrtc.ice_policy_note"
    case webrtcDiagSignaling = "webrtc.diag_signaling"
    case webrtcLogSent = "webrtc.log_sent"
    case webrtcLogReceived = "webrtc.log_received"
    case webrtcLogCopy = "webrtc.log_copy"
    case webrtcLogClear = "webrtc.log_clear"
    case webrtcLogEmpty = "webrtc.log_empty"
    case webrtcLogLoopback = "webrtc.log_loopback"
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
    case errorCameraPermissionDenied = "error.camera_permission_denied"
    case errorCameraInUse = "error.camera_in_use"
    case errorDeviceOffline = "error.device_offline"
    case errorDeviceBusy = "error.device_busy"
    case errorNoAnswer = "error.no_answer"
    case errorDeviceUnreachable = "error.device_unreachable"
    case errorCallFailed = "error.call_failed"
    case errorSignalingLost = "error.signaling_lost"

    /// 키가 실린 .xcstrings 카탈로그 이름.
    var table: String {
        switch self {
        case .commonLoading,
             .commonLanguage,
             .commonTheme,
             .commonCancel,
             .commonRetry:
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
             .dashboardStatusInactive,
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
             .dashboardOnlyThisSession:
            "Dashboard"
        case .webrtcTitle,
             .webrtcLobbyTitle,
             .webrtcLobbyDesc,
             .webrtcCamera,
             .webrtcMicrophone,
             .webrtcDevices,
             .webrtcDevicesDesc,
             .webrtcCall,
             .webrtcWillNotify,
             .webrtcNotificationsOff,
             .webrtcNoOtherDevices,
             .webrtcThisTab,
             .webrtcLoopback,
             .webrtcTest,
             .webrtcLoopbackNote,
             .webrtcP2pNote,
             .webrtcCalling,
             .webrtcRingingDesc,
             .webrtcRingTimeoutNote,
             .webrtcNotifiedDesc,
             .webrtcTileNotified,
             .webrtcIncomingTitle,
             .webrtcIncomingBody,
             .webrtcAccept,
             .webrtcDecline,
             .webrtcDeclined,
             .webrtcExpiredTitle,
             .webrtcExpiredBody,
             .webrtcMute,
             .webrtcUnmute,
             .webrtcCameraOff,
             .webrtcCameraOn,
             .webrtcEndCall,
             .webrtcYou,
             .webrtcLoopbackPeer,
             .webrtcStatusRinging,
             .webrtcStatusNotified,
             .webrtcStatusConnecting,
             .webrtcStatusConnected,
             .webrtcStatusReconnecting,
             .webrtcStatusFailed,
             .webrtcTileRinging,
             .webrtcTileConnecting,
             .webrtcTileReconnecting,
             .webrtcTileCameraOff,
             .webrtcTilePeerCameraOff,
             .webrtcTileNoVideo,
             .webrtcPeerLeft,
             .webrtcDiagnostics,
             .webrtcDiagShow,
             .webrtcDiagHide,
             .webrtcDiagQuality,
             .webrtcStatRtt,
             .webrtcStatJitter,
             .webrtcStatPacketLoss,
             .webrtcStatSending,
             .webrtcStatReceiving,
             .webrtcStatVideo,
             .webrtcStatUnavailable,
             .webrtcDiagConnection,
             .webrtcIcePath,
             .webrtcIcePathDirect,
             .webrtcIcePathReflexive,
             .webrtcIcePathRelay,
             .webrtcIcePathLoopback,
             .webrtcIceLocal,
             .webrtcIceRemote,
             .webrtcIceState,
             .webrtcDtlsState,
             .webrtcConnectedFor,
             .webrtcIceAddressHidden,
             .webrtcDiagSettings,
             .webrtcIcePolicy,
             .webrtcIcePolicyAll,
             .webrtcIcePolicyRelay,
             .webrtcIcePolicyNote,
             .webrtcDiagSignaling,
             .webrtcLogSent,
             .webrtcLogReceived,
             .webrtcLogCopy,
             .webrtcLogClear,
             .webrtcLogEmpty,
             .webrtcLogLoopback:
            "Webrtc"
        case .errorGeneric,
             .errorSigninFailed,
             .errorDemoDisabled,
             .errorNetworkError,
             .errorProviderUnavailable,
             .errorLogoutFailed,
             .errorSessionsLoadFailed,
             .errorRevokeFailed,
             .errorSessionEnded,
             .errorCameraPermissionDenied,
             .errorCameraInUse,
             .errorDeviceOffline,
             .errorDeviceBusy,
             .errorNoAnswer,
             .errorDeviceUnreachable,
             .errorCallFailed,
             .errorSignalingLost:
            "Error"
        }
    }
}
