//
//  CallContracts.swift
//  prism
//
//  Path: Domain/Models/Auth/CallContracts.swift
//

import Foundation

/// 통화 시그널링 계약(서버: `apps/server/libs/common/src/types/contracts.ts` §통화).
///
/// presence와 **같은 소켓**을 쓰지만 계약은 갈라져 있다. presence가 클라 → 서버 방향을
/// 두지 않았던 이유(살아 있다는 주장을 믿으면 반쯤 죽은 소켓이 계속 Active로 남는다)는
/// 그대로 유효하고, 여기 메시지들은 그 주장을 하지 않는다.
///
/// **미디어는 이 소켓을 지나지 않는다.** 서버가 나르는 것은 상대를 찾는 신호와 SDP·ICE
/// 문자열뿐이고, 연결이 서면 그 뒤로는 P2P다. 녹화도 저장도 없다.

/// 벨의 상한. **서버 상수이고 클라이언트는 재지 않는다** — 양쪽이 재면 시계가 두 벌이
/// 되고 언젠가 어긋난다. 지나면 서버가 양쪽에 `ended(timeout)`을 보낸다.
let RING_TIMEOUT_MS = 45_000

/// 릴레이가 나르는 문자열의 상한. 서버는 SDP를 해석하지 않으므로 길이와 형식이 경계에서
/// 볼 수 있는 전부다 — 상한이 없으면 소켓이 임의 크기 릴레이가 된다.
let MAX_SDP_LENGTH = 16_384
let MAX_ICE_CANDIDATE_LENGTH = 1_024
let MAX_SDP_MID_LENGTH = 64

/// 클라이언트가 `RTCPeerConnection`에 그대로 넘기는 ICE 서버 하나.
///
/// 목록은 `accepted`와 함께 소켓이 내려준다 — 값은 전부 env에서 오고 앱에는 호스트도
/// 자격증명도 없다. 화면에도 띄우지 않는다(plan/webrtc.md §7).
struct IceServer: Decodable, Equatable, Sendable {
    let urls: [String]
    /// TURN에만 있다. STUN은 자격증명을 쓰지 않는다.
    let username: String?
    let credential: String?
}

/// 상대를 가리키는 값은 **기기 종류뿐**이다 — 화면이 필요로 하는 전부이고, 그 이상은
/// 담지 않는다(`SessionInfo`가 User-Agent 원문도 IP도 담지 않는 것과 같은 선).
struct SessionRef: Decodable, Equatable, Sendable {
    let id: String
    let device: DeviceKind
}

/// 후보 하나. 웹의 `RTCIceCandidateInit`을 그대로 옮긴 모양이다.
///
/// **후보 문자열만으로는 붙일 수 없다** — `addIceCandidate`는 sdpMid와 sdpMLineIndex가
/// 둘 다 없으면 거부한다. 서버는 릴레이라 어느 쪽인지 고르지 않고 온 것을 그대로 넘긴다.
struct IceCandidatePayload: Codable, Equatable, Sendable {
    let candidate: String
    let sdpMid: String?
    let sdpMLineIndex: Int32?
}

/// 통화가 끝난 이유. **통화의 성질이지 받는 사람의 사정이 아니다** — 같은 문장이 양쪽에
/// 그대로 참이어야 벨을 함께 받았던 다른 기기에도 같은 메시지를 보낼 수 있다.
enum CallEndReason: String, Decodable, Sendable {
    /// 사람이 끊었다(거는 쪽의 취소 · 어느 쪽의 종료).
    case hangup
    /// 당사자의 소켓이 사라졌다.
    case peerGone = "peer-gone"
    /// `RING_TIMEOUT_MS`가 지났다.
    case timeout
}

/// 통화를 시작할 수 없는 이유.
///
/// **없는 세션과 남의 세션을 구별해 주지 않는다**(`unknownSession` 하나로 접는다) —
/// 남의 세션 id를 넣어 존재를 떠보는 경로를 열지 않기 위해서다.
enum CallErrorCode: String, Decodable, Sendable {
    case unreachable
    case busy
    case unknownSession = "unknown-session"
    case selfCall = "self"
}

// MARK: - 서버 → 클라

/// presence 메시지와 **같은 소켓**으로 내려온다.
enum CallServerMessage: Equatable, Sendable {
    /// 받는 쪽에 벨. 그 세션의 **모든** 연결에 간다 — 사용자가 어느 화면에 있는지 모른다.
    case incoming(callId: String, from: SessionRef)
    /// 거는 쪽 — 상대에게 전달됐다.
    case ringing(callId: String)
    /// 거는 쪽 — 상대에게 **소켓이 없어 푸시로 알렸다**.
    ///
    /// `ringing`과 갈라 두는 이유는 기다리는 성격이 다르기 때문이다: 알림이 뜨고 사람이
    /// 기기를 집어 앱을 여는 시간이 창 안에 들어간다. 같은 배지로 뭉뚱그리면 느린 쪽이
    /// 고장으로 읽힌다(plan/webrtc.md §4). 정상 결말은 `Call expired` + 되걸기다(§8-10).
    case notified(callId: String)
    /// 양쪽에 간다. **이것을 받은 거는 쪽이 offer를 낸다** — 역할이 방향에서 나오므로
    /// glare가 구조적으로 없다.
    case accepted(callId: String, iceServers: [IceServer])
    /// 벨을 **함께 받았지만 지지 않은** 연결에 간다 — 다른 기기가 먼저 받았다.
    ///
    /// 이것이 없으면 그 창들이 통화 내내 벨을 붙들고 있다(`accepted`는 창구에만 가고
    /// `ended`는 통화가 끝나야 온다). **끝이 아니라 "내 차례가 아니었다"라서** 알림도
    /// 남기지 않는다 — 다른 기기에서 받은 전화가 조용히 사라지는 것과 같다.
    case claimed(callId: String)
    case declined(callId: String)
    case offer(callId: String, sdp: String)
    case answer(callId: String, sdp: String)
    case ice(callId: String, candidate: IceCandidatePayload)
    case ended(callId: String, reason: CallEndReason)
    /// 알림을 늦게 열었다. `from`은 **없을 수 있다** — 서버가 그 통화를 더는 기억하지
    /// 못하거나 애초에 내 통화가 아니었으면 기기 종류를 지어내지 않는다.
    case expired(callId: String, from: SessionRef?)
    case callError(code: CallErrorCode)
}

extension CallServerMessage: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, callId, from, iceServers, sdp, candidate, reason, code
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        func callId() throws -> String { try c.decode(String.self, forKey: .callId) }

        switch type {
        case "incoming":
            self = .incoming(
                callId: try callId(),
                from: try c.decode(SessionRef.self, forKey: .from),
            )
        case "ringing":
            self = .ringing(callId: try callId())
        case "notified":
            self = .notified(callId: try callId())
        case "accepted":
            self = .accepted(
                callId: try callId(),
                iceServers: try c.decode([IceServer].self, forKey: .iceServers),
            )
        case "claimed":
            self = .claimed(callId: try callId())
        case "declined":
            self = .declined(callId: try callId())
        case "offer":
            self = .offer(callId: try callId(), sdp: try Self.sdp(c))
        case "answer":
            self = .answer(callId: try callId(), sdp: try Self.sdp(c))
        case "ice":
            self = .ice(
                callId: try callId(),
                candidate: try Self.candidate(c),
            )
        case "ended":
            self = .ended(
                callId: try callId(),
                reason: try c.decode(CallEndReason.self, forKey: .reason),
            )
        case "expired":
            self = .expired(
                callId: try callId(),
                from: try c.decodeIfPresent(SessionRef.self, forKey: .from),
            )
        case "callError":
            self = .callError(code: try c.decode(CallErrorCode.self, forKey: .code))
        default:
            // **모르는 값을 접지 않는다** — 이것은 화면 라벨이 아니라 동작이라,
            // 아무 갈래로 접으면 하지 말아야 할 일을 한다.
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: c,
                debugDescription: "unknown call message type",
            )
        }
    }

    /// 상한은 **받는 쪽에서도** 본다. 서버가 이미 검사하지만, 경계에서 한 번 더 보는 것이
    /// 이 앱이 다른 서버를 보게 되는 날의 유일한 방어다.
    private static func sdp(
        _ c: KeyedDecodingContainer<CodingKeys>,
    ) throws -> String {
        let value = try c.decode(String.self, forKey: .sdp)
        guard value.count <= MAX_SDP_LENGTH else {
            throw DecodingError.dataCorruptedError(
                forKey: .sdp, in: c, debugDescription: "sdp too long",
            )
        }
        return value
    }

    private static func candidate(
        _ c: KeyedDecodingContainer<CodingKeys>,
    ) throws -> IceCandidatePayload {
        let value = try c.decode(IceCandidatePayload.self, forKey: .candidate)
        guard value.candidate.count <= MAX_ICE_CANDIDATE_LENGTH,
              (value.sdpMid?.count ?? 0) <= MAX_SDP_MID_LENGTH
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .candidate, in: c, debugDescription: "candidate too long",
            )
        }
        return value
    }
}

// MARK: - 클라 → 서버

/// **callId는 담아도 발급하지는 않는다** — 서버가 준 것을 되돌려줄 뿐이다.
enum CallClientMessage: Equatable, Sendable {
    /// 대상 세션 id. 내 세션이 아니면 서버가 `unknownSession`으로 거절한다.
    case call(to: String)
    case accept(callId: String)
    case decline(callId: String)
    /// 거는 쪽이 벨을 접는다. 붙은 뒤로는 `hangup`의 자리다.
    case cancel(callId: String)
    case offer(callId: String, sdp: String)
    case answer(callId: String, sdp: String)
    case ice(callId: String, candidate: IceCandidatePayload)
    case hangup(callId: String)
    /// 알림으로 열었다 — 이 통화가 아직 살아 있나. 소켓이 붙자마자 묻는다.
    case resume(callId: String)
}

extension CallClientMessage: Encodable {
    private enum CodingKeys: String, CodingKey {
        case type, to, callId, sdp, candidate
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .call(to):
            try c.encode("call", forKey: .type)
            try c.encode(to, forKey: .to)
        case let .accept(callId):
            try c.encode("accept", forKey: .type)
            try c.encode(callId, forKey: .callId)
        case let .decline(callId):
            try c.encode("decline", forKey: .type)
            try c.encode(callId, forKey: .callId)
        case let .cancel(callId):
            try c.encode("cancel", forKey: .type)
            try c.encode(callId, forKey: .callId)
        case let .offer(callId, sdp):
            try c.encode("offer", forKey: .type)
            try c.encode(callId, forKey: .callId)
            try c.encode(sdp, forKey: .sdp)
        case let .answer(callId, sdp):
            try c.encode("answer", forKey: .type)
            try c.encode(callId, forKey: .callId)
            try c.encode(sdp, forKey: .sdp)
        case let .ice(callId, candidate):
            try c.encode("ice", forKey: .type)
            try c.encode(callId, forKey: .callId)
            try c.encode(candidate, forKey: .candidate)
        case let .hangup(callId):
            try c.encode("hangup", forKey: .type)
            try c.encode(callId, forKey: .callId)
        case let .resume(callId):
            try c.encode("resume", forKey: .type)
            try c.encode(callId, forKey: .callId)
        }
    }
}

/// 푸시 화면에서 사람이 적는 문구의 상한(서버 계약의 `MAX_PUSH_MESSAGE_LENGTH`).
///
/// 생성기는 문자열 배열·레코드만 옮기므로 숫자 상수는 손으로 둔다 — 서버가 같은 값으로
/// 400을 내므로, 입력에서 먼저 막아 왕복을 아낀다.
let MAX_PUSH_MESSAGE_LENGTH = 120

/// 한 번에 고를 수 있는 대상 수(서버 계약의 `MAX_PUSH_TARGETS`).
let MAX_PUSH_TARGETS = 20
