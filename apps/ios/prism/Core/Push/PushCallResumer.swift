//
//  PushCallResumer.swift
//  prism
//
//  Path: Core/Push/PushCallResumer.swift
//

import Foundation

/// 알림이 가리킨 통화를 서버에 **묻는 일**의 주인 — 비동기 보내기와 사람의 이동이 겹치는 자리다.
///
/// `RootView`의 계기(요청 + 소켓 준비)마다 여기를 부른다. 규칙:
///  - 같은 통화를 겹쳐 묻지 않는다 — **같은 연결**에서 진행 중인 보내기가 있으면 함께 기다린다
///    (서버는 물을 때마다 답한다). 연결이 새로 붙었으면(`connection`이 다르면) 옛 보내기에 합류하지
///    않고 새 연결로 다시 보낸다 — 옛 소켓에 매달린 보내기는 끝내 실패하고, 그때는 준비 상태가
///    이미 참이라 다시 부를 계기가 없다.
///  - 결과는 **그 차례의 요청이 아직 지금 것일 때만** 적용한다 — 앞 요청의 성공·실패가 뒤 요청을
///    지우거나 남기지 않는다.
///  - 성공하면 요청을 비운다. 실패하면 요청을 **남긴다** — 다시 붙으면 `RootView`가 다시 부른다.
///  - 사람이 통화 화면을 떠나면 **지금 요청을 버린다** — 아직 묻지 못한 것도, 묻는 중인 것도. 남겨
///    두면 다시 붙는 순간 통화 화면으로 끌려간다. iOS의 요청은 언제나 사람이 알림을 눌러 생기므로,
///    떠나는 것은 그 요청을 거둔 것이다.
@MainActor
final class PushCallResumer {
    typealias Resume = (String) async -> Bool

    private struct Attempt {
        let connection: Int
        let task: Task<Bool, Never>
    }

    private let links: PushLinks
    private let resume: Resume
    /// 통화별 진행 중인 보내기 — 같은 연결의 두 번째 요청은 이것을 함께 기다린다.
    private var inFlight: [String: Attempt] = [:]
    /// 묻지 못해 남긴 요청의 차례. 다음 계기가 다시 묻는다.
    private(set) var retainedSeq: Int?

    init(links: PushLinks, resume: @escaping Resume) {
        self.links = links
        self.resume = resume
    }

    /// 계기 하나 — 요청(`callId`, `seq`)이 지금 것이고 소켓이 준비됐다. `connection`은 소켓이
    /// 준비될 때마다 오르는 값이다.
    func attempt(callId: String, seq: Int, connection: Int) {
        let attempt: Attempt
        if let current = inFlight[callId], current.connection == connection {
            attempt = current
        } else {
            attempt = Attempt(connection: connection, task: Task { [resume] in await resume(callId) })
            inFlight[callId] = attempt
        }
        let task = attempt.task
        Task { @MainActor in
            let ok = await task.value
            if inFlight[callId]?.task == task { inFlight[callId] = nil }
            // 그사이 다른 요청이 들어왔거나 사람이 거뒀으면 이 결과는 쓸 데가 없다.
            guard links.callSeq == seq, links.pendingCallId != nil else { return }
            if ok {
                links.consume(seq: seq)
                if retainedSeq == seq { retainedSeq = nil }
            } else {
                retainedSeq = seq
            }
        }
    }

    /// 사람이 통화 화면을 떠났다 — 지금 요청을 거둔다.
    func leaveCallScreen() {
        retainedSeq = nil
        guard links.pendingCallId != nil else { return }
        links.dropCall(seq: links.callSeq)
    }
}
