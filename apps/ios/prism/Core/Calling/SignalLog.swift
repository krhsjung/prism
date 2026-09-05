//
//  SignalLog.swift
//  prism
//
//  Path: Core/Calling/SignalLog.swift
//

import Foundation

// 시그널링 로그 — **원소는 §6 계약의 메시지 그대로다**(웹 `lib/webrtc/signal-log.ts`).
//
// 로그를 위한 이벤트를 새로 만들지 않는다: 만드는 순간 계약이 두 벌이 되고, 화면이
// 서버에 없는 것을 약속하게 된다.
//
// 레벨(DEBUG/INFO/WARN/ERROR)을 두지 않고 **방향**으로 가르는 것도 결정이다. 원소가
// 열 몇 가지뿐이라 네 레벨로 나누면 필터 UI가 원소 수보다 커지고, 시그널링에서 실제로
// 헷갈리는 축은 "누가 offer를 냈나" 곧 방향이다(plan/webrtc.md §4).
//
// ⚠️ **본문은 담지 않는다.** SDP와 후보 문자열은 종류와 크기까지만 적는다(§7) —
// 로그는 사용자가 `Copy log`로 통째로 붙여넣는 물건이라, 담은 것이 곧 새어 나갈 수
// 있는 것이다.

/// 화면에 남기는 줄 수. 통화 하나의 시그널링은 수십 줄이라 넉넉하다.
let SIGNAL_LOG_LIMIT = 200

struct SignalLogEntry: Identifiable, Equatable, Sendable {
    /// 목록 key. 같은 밀리초에 두 줄이 생겨도 갈린다.
    let id: Int
    let atMs: Double
    let direction: Direction
    let type: String
    /// 오류 줄만 색을 쓴다(§4).
    let isError: Bool
    /// 크기·코드처럼 본문이 아닌 것.
    let detail: String?

    enum Direction: Sendable {
        case sent
        case received
    }
}

/// 줄에 번호를 매기는 자리. 통화가 끝나도 이어져야 목록 key가 겹치지 않는다.
@MainActor
enum SignalLog {
    private static var nextID = 0

    static func entry(
        _ direction: SignalLogEntry.Direction,
        type: String,
        detail: String?,
        isError: Bool,
        atMs: Double = Date().timeIntervalSince1970 * 1_000,
    ) -> SignalLogEntry {
        defer { nextID += 1 }
        return SignalLogEntry(
            id: nextID,
            atMs: atMs,
            direction: direction,
            type: type,
            isError: isError,
            detail: detail,
        )
    }

    /// 상한을 넘으면 **오래된 쪽부터** 버린다 — 지금 무슨 일이 나는지가 늘 아래에 있다.
    static func append(
        _ entries: [SignalLogEntry],
        _ entry: SignalLogEntry,
    ) -> [SignalLogEntry] {
        let next = entries + [entry]
        return next.count > SIGNAL_LOG_LIMIT
            ? Array(next.suffix(SIGNAL_LOG_LIMIT))
            : next
    }

    /// `Copy log`가 붙여넣는 텍스트. 사용자가 누를 때만 만들어지고 자동 전송은 없다(§7).
    static func format(_ entries: [SignalLogEntry]) -> String {
        entries.map { entry in
            let arrow = entry.direction == .sent ? "→" : "←"
            let detail = entry.detail.map { " \($0)" } ?? ""
            return "\(stamp(entry.atMs, compact: false)) \(arrow) \(entry.type)\(detail)"
        }
        .joined(separator: "\n")
    }

    /// 375에서는 밀리초를 뺀다(시안 `Atom/LogLine` `Compact=Yes`) — 초 단위로도
    /// 순서와 간격은 읽힌다.
    static func stamp(_ atMs: Double, compact: Bool) -> String {
        let seconds = Int(atMs / 1_000)
        let hh = (seconds / 3_600) % 24
        let mm = (seconds / 60) % 60
        let ss = seconds % 60
        let clock = String(format: "%02d:%02d:%02d", hh, mm, ss)
        if compact { return clock }
        return clock + String(format: ".%03d", Int(atMs.truncatingRemainder(dividingBy: 1_000)))
    }
}

// MARK: - 계약의 메시지 → 로그 한 줄

extension CallClientMessage {
    var logType: String {
        switch self {
        case .call: "call"
        case .accept: "accept"
        case .decline: "decline"
        case .cancel: "cancel"
        case .offer: "offer"
        case .answer: "answer"
        case .ice: "ice"
        case .hangup: "hangup"
        case .resume: "resume"
        }
    }

    var logDetail: String? {
        switch self {
        case let .call(to): "#\(to.prefix(8))"
        case let .offer(_, sdp), let .answer(_, sdp): SignalLog.byteSize(sdp)
        case let .ice(_, candidate): SignalLog.byteSize(candidate.candidate)
        default: nil
        }
    }
}

extension CallServerMessage {
    var logType: String {
        switch self {
        case .incoming: "incoming"
        case .ringing: "ringing"
        case .accepted: "accepted"
        case .claimed: "claimed"
        case .declined: "declined"
        case .offer: "offer"
        case .answer: "answer"
        case .ice: "ice"
        case .ended: "ended"
        case .expired: "expired"
        case .callError: "callError"
        }
    }

    var logDetail: String? {
        switch self {
        case let .offer(_, sdp), let .answer(_, sdp): SignalLog.byteSize(sdp)
        case let .ice(_, candidate): SignalLog.byteSize(candidate.candidate)
        case let .ended(_, reason): reason.rawValue
        case let .callError(code): code.rawValue
        case let .accepted(_, servers): "ice \(servers.count)"
        default: nil
        }
    }

    var isLogError: Bool {
        if case .callError = self { return true }
        return false
    }
}

extension SignalLog {
    // 바이트로 적는 이유: SDP는 UTF-8에서 문자 수와 바이트 수가 갈리고, 계약의 상한도
    // 문자 기준이라 둘을 섞으면 "상한에 걸렸는데 화면은 여유가 있다고 말하는" 상태가 된다.
    static func byteSize(_ value: String) -> String {
        let bytes = value.utf8.count
        return bytes < 1_024
            ? "\(bytes) B"
            : String(format: "%.1f kB", Double(bytes) / 1_024)
    }
}
