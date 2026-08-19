//
//  Log.swift
//  prism
//
//  Path: Core/Utils/Log.swift
//

import Foundation
import os

/// 구조화된 로깅.
///
/// 인증 흐름을 다루는 앱이라 "무엇을 남기지 않는가"가 규칙의 절반이다 —
/// 액세스 토큰·리프레시 자격증명·표시 이름은 인자로 넘기지 않는다(plan/auth.md §7).
/// os.log의 `privacy` 옵션에 기대는 대신, 민감한 값을 애초에 호출부에서 넘기지 않는
/// 쪽을 규칙으로 둔다 — 여기 들어온 문자열은 전부 평문으로 남는다고 보면 된다.
enum Log {
    private static let subsystem = Bundle.main.bundleIdentifier ?? "kr.hs.jung.prism"

    private static let authLogger = Logger(subsystem: subsystem, category: "auth")
    private static let networkLogger = Logger(subsystem: subsystem, category: "network")
    private static let uiLogger = Logger(subsystem: subsystem, category: "ui")
    private static let errorLogger = Logger(subsystem: subsystem, category: "error")

    // 흐름/네트워크/UI 이벤트는 **디버그 빌드에서만** 남긴다. `.public`은 리댁션이 아니라
    // "평문 노출"이라, release에 남기면 흐름·타이밍이 그대로 드러난다(공개 배포라 리뷰어
    // 활동 추적을 피한다). release에는 아래 error(고정 카테고리 코드)만 남는다.
    static func auth(_ message: String) {
        #if DEBUG
        authLogger.info("\(message, privacy: .public)")
        #endif
    }

    static func network(_ message: String) {
        #if DEBUG
        networkLogger.info("\(message, privacy: .public)")
        #endif
    }

    static func ui(_ message: String) {
        #if DEBUG
        uiLogger.debug("\(message, privacy: .public)")
        #endif
    }

    /// 오류는 release에도 남긴다 — 단, **호출부가 고정 카테고리 코드만** 넘긴다(원시 오류
    /// 메시지·localizedDescription 금지: 서드파티/시스템이 토큰·URL을 품을 수 있다).
    static func error(_ message: String) {
        errorLogger.error("\(message, privacy: .public)")
    }
}
