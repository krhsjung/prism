//
//  SdpFingerprintTests.swift
//  prismTests
//
//  offer를 받는 쪽은 이 답 하나로 "이어 붙일까, 새로 세울까"를 가른다 — 틀리면 ICE restart가
//  새 연결에 들어가 통화가 끊기거나, 정책 전환의 새 offer가 옛 연결에 들어간다.
//

import Foundation
import Testing
@testable import prism

private func libwebrtc(_ fingerprint: String) -> String {
    [
        "v=0",
        "m=audio 9 UDP/TLS/RTP/SAVPF 111",
        "a=fingerprint:sha-256 \(fingerprint)",
        "m=video 9 UDP/TLS/RTP/SAVPF 96",
        "a=fingerprint:sha-256 \(fingerprint)",
    ].joined(separator: "\r\n")
}

private func firefox(_ fingerprint: String) -> String {
    ["v=0", "a=fingerprint:sha-256 \(fingerprint)", "m=audio 9 UDP/TLS/RTP/SAVPF 111"]
        .joined(separator: "\n")
}

@Suite("SDP — 연결의 신원")
struct SdpFingerprintTests {
    @Test("m-section마다 실린 같은 지문은 하나로 읽는다")
    func dedupes() {
        #expect(SdpFingerprint.fingerprints(of: libwebrtc("AA:BB")) == ["sha-256 aa:bb"])
    }

    @Test("같은 연결의 재-offer(ICE restart)는 같은 연결로 본다")
    func sameConnection() {
        #expect(SdpFingerprint.sameConnection(libwebrtc("AA:BB"), libwebrtc("AA:BB")))
    }

    // Firefox는 세션 수준에 한 번, libwebrtc는 m-section마다 — 값이 같으면 같은 연결이다.
    @Test("지문을 어디에 적었든 값이 같으면 같은 연결이다")
    func placementDoesNotMatter() {
        #expect(SdpFingerprint.sameConnection(libwebrtc("AA:BB"), firefox("aa:bb")))
    }

    @Test("새로 세운 연결의 offer는 지문이 달라 다른 연결로 본다")
    func differentConnection() {
        #expect(!SdpFingerprint.sameConnection(libwebrtc("AA:BB"), libwebrtc("CC:DD")))
    }

    // 모르는 것을 "같다"로 접으면 낯선 offer를 살아 있는 연결에 붙인다.
    @Test("지문이 없으면 같다고 하지 않는다")
    func unknownIsNotSame() {
        #expect(!SdpFingerprint.sameConnection("v=0", "v=0"))
        #expect(!SdpFingerprint.sameConnection("v=0", libwebrtc("AA:BB")))
    }
}
