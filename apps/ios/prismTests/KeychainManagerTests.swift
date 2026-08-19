//
//  KeychainManagerTests.swift
//  prismTests
//
//  단일 항목 저장의 왕복·옛 형식 마이그레이션·손상 항목 복구를 검증한다. 실제 Keychain
//  대신 인메모리 RawKeychainStore를 주입해 결정적으로 돈다(unsigned 테스트 빌드는
//  entitlement가 없어 SecItem 쓰기가 막힌다 — 그래서 로직을 이 경계에서 테스트한다).
//

import Foundation
import Testing
@testable import prism

/// 인메모리 원시 저장소. 계정별 바이트만 담는다. 읽기·쓰기·삭제 실패를 계정별로
/// 강제할 수 있어 Keychain 장애 경로를 결정적으로 재현한다.
private final class MemoryRawStore: RawKeychainStore, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: Data] = [:]
    var failWrite = false
    var failReadAccounts: Set<String> = []
    var failDeleteAccounts: Set<String> = []
    private(set) var deletedAccounts: [String] = []

    init(_ seed: [String: Data] = [:]) { items = seed }

    func read(account: String) -> RawReadResult {
        lock.withLock {
            if failReadAccounts.contains(account) { return .failure }
            if let data = items[account] { return .data(data) }
            return .notFound
        }
    }

    func write(_ data: Data, account: String) -> Bool {
        lock.withLock {
            if failWrite { return false }
            items[account] = data
            return true
        }
    }

    func delete(account: String) -> Bool {
        lock.withLock {
            deletedAccounts.append(account)
            if failDeleteAccounts.contains(account) { return false }
            items[account] = nil
            return true
        }
    }
}

private let legacyAccess = "kr.hs.jung.prism.accessToken"
private let legacyRefresh = "kr.hs.jung.prism.refreshToken"

// 프로젝트가 MainActor 기본 격리라, StoredSession·RawReadResult의 Equatable도 MainActor
// 격리다. 이 스위트를 @MainActor로 두어 `==` 비교가 격리 컨텍스트에서 일어나게 한다.
@MainActor
@Suite("keychain manager")
struct KeychainManagerTests {
    @Test("저장·조회·삭제 왕복")
    func roundTrips() {
        let keychain = KeychainManager(store: MemoryRawStore())

        #expect(keychain.load() == StoredSession.none)
        #expect(keychain.save(.init(accessToken: "a", refreshToken: "r")))
        #expect(keychain.load() == .credentials(.init(accessToken: "a", refreshToken: "r")))
        // 같은 키에 다시 저장하면 교체된다(회전).
        #expect(keychain.save(.init(accessToken: "a2", refreshToken: "r2")))
        #expect(keychain.load() == .credentials(.init(accessToken: "a2", refreshToken: "r2")))
        #expect(keychain.clear())
        #expect(keychain.load() == StoredSession.none)
    }

    @Test("저장 실패는 false로 표면화된다")
    func surfacesWriteFailure() {
        let store = MemoryRawStore()
        store.failWrite = true
        let keychain = KeychainManager(store: store)
        #expect(!keychain.save(.init(accessToken: "a", refreshToken: "r")))
        #expect(keychain.load() == StoredSession.none)
    }

    // #5: 이전 버전(토큰마다 항목 하나)에서 업데이트한 기기가 강제 로그아웃되지 않아야 한다.
    @Test("옛 두-키 형식을 단일 항목으로 마이그레이션한다")
    func migratesLegacyFormat() {
        let store = MemoryRawStore([
            legacyAccess: Data("a".utf8),
            legacyRefresh: Data("r".utf8),
        ])
        let keychain = KeychainManager(store: store)

        // 옛 값이 그대로 읽히고, 새 형식으로 옮겨지며 옛 항목은 사라진다.
        #expect(keychain.load() == .credentials(.init(accessToken: "a", refreshToken: "r")))
        #expect(store.read(account: legacyAccess) == .notFound)
        #expect(store.read(account: legacyRefresh) == .notFound)
        // 새 항목에서 다시 읽힌다.
        #expect(keychain.load() == .credentials(.init(accessToken: "a", refreshToken: "r")))
    }

    @Test("옛 형식이 반쪽만 있으면 마이그레이션하지 않는다")
    func skipsPartialLegacy() {
        let store = MemoryRawStore([legacyAccess: Data("a".utf8)])
        let keychain = KeychainManager(store: store)
        #expect(keychain.load() == StoredSession.none)
    }

    @Test("clear는 옛 두-키 형식도 함께 지운다")
    func clearRemovesLegacy() {
        let store = MemoryRawStore([
            legacyAccess: Data("a".utf8),
            legacyRefresh: Data("r".utf8),
        ])
        let keychain = KeychainManager(store: store)
        #expect(keychain.clear())
        #expect(store.read(account: legacyAccess) == .notFound)
        #expect(store.read(account: legacyRefresh) == .notFound)
    }

    // #6: 손상된 항목은 조용한 nil이 아니라 제거로 이어져, 다음부터 깨끗한 흐름으로 복구된다.
    @Test("손상된 세션 항목은 nil을 주고 스스로 지운다")
    func discardsCorruptItem() {
        let store = MemoryRawStore(["session": Data("not-json".utf8)])
        let keychain = KeychainManager(store: store)

        #expect(keychain.load() == StoredSession.none)
        #expect(store.read(account: "session") == .notFound) // 손상 항목이 지워졌다
        // 정상 저장이 곧바로 성립한다.
        #expect(keychain.save(.init(accessToken: "a", refreshToken: "r")))
        #expect(keychain.load() == .credentials(.init(accessToken: "a", refreshToken: "r")))
    }

    // 라운드4 문제1(data-loss): 마이그레이션 저장이 실패하면 옛 항목을 지우면 안 된다 —
    // 복구할 유일한 자격증명이 사라진다. 이번 실행엔 값을 쓰되 옛 값은 보존해 재시도한다.
    @Test("마이그레이션 저장 실패 시 옛 항목을 보존한다")
    func keepsLegacyWhenMigrationSaveFails() {
        let store = MemoryRawStore([
            legacyAccess: Data("a".utf8),
            legacyRefresh: Data("r".utf8),
        ])
        store.failWrite = true
        let keychain = KeychainManager(store: store)

        // 이번 실행에는 값이 나온다(로그인 유지).
        #expect(keychain.load() == .credentials(.init(accessToken: "a", refreshToken: "r")))
        // 하지만 옛 항목은 지워지지 않았다 — 다음 실행에서 다시 시도할 수 있다.
        #expect(store.read(account: legacyAccess) == .data(Data("a".utf8)))
        #expect(store.read(account: legacyRefresh) == .data(Data("r".utf8)))
    }

    // 라운드4 문제2(정합성): clear()가 앞 삭제 실패에도 뒤 삭제를 건너뛰지 않아야 한다.
    // 건너뛰면 남은 옛 항목이 다시 마이그레이션돼 로그아웃 세션이 부활한다.
    @Test("clear는 앞 삭제가 실패해도 나머지 옛 항목을 모두 시도한다")
    func clearAttemptsAllDeletesDespiteFailure() {
        let store = MemoryRawStore([
            legacyAccess: Data("a".utf8),
            legacyRefresh: Data("r".utf8),
        ])
        store.failDeleteAccounts = [legacyAccess] // 앞 legacy 삭제를 실패시킨다
        let keychain = KeychainManager(store: store)

        #expect(!keychain.clear()) // 실패를 표면화
        // 그럼에도 legacy refresh 삭제는 시도됐다(단락 평가로 건너뛰지 않았다).
        #expect(store.deletedAccounts.contains(legacyRefresh))
        #expect(store.read(account: legacyRefresh) == .notFound)
    }

    // 라운드4 문제3(data-loss): 새 항목 읽기가 실패하면 "없음"으로 오인하지 말고,
    // 기존 항목을 건드리지 않은 채 세션 없음으로만 다뤄야 한다(옛 값으로 덮지 않는다).
    @Test("새 항목 읽기 실패를 없음으로 오인해 마이그레이션하지 않는다")
    func readFailureDoesNotTriggerMigration() {
        let store = MemoryRawStore([
            "session": Data(#"{"accessToken":"a2","refreshToken":"r2"}"#.utf8),
            legacyAccess: Data("a".utf8),
            legacyRefresh: Data("r".utf8),
        ])
        store.failReadAccounts = ["session"] // 최신 항목 읽기 일시 실패
        let keychain = KeychainManager(store: store)

        // 세션 없음으로만 다룬다 — legacy로 마이그레이션하지 않는다.
        #expect(keychain.load() == StoredSession.none)
        // 최신 항목은 그대로 남아 있다(옛 값으로 덮이지 않았다).
        #expect(store.deletedAccounts.isEmpty)
        // 읽기가 회복되면 최신 회전 토큰이 그대로 살아난다.
        store.failReadAccounts = []
        #expect(keychain.load() == .credentials(.init(accessToken: "a2", refreshToken: "r2")))
    }

    // 라운드6: revoke는 자격증명을 durable한 마커로 덮고, 새 로그인(save)이 그것을 되돌린다.
    @Test("revoke는 자격증명을 마커로 덮고 save가 되돌린다")
    func revokeThenSave() {
        let keychain = KeychainManager(store: MemoryRawStore())
        #expect(keychain.save(.init(accessToken: "a", refreshToken: "r")))
        #expect(keychain.revoke())
        #expect(keychain.load() == StoredSession.revoked) // 자격증명이 아니라 마커
        // 새 로그인이 마커를 덮는다.
        #expect(keychain.save(.init(accessToken: "a2", refreshToken: "r2")))
        #expect(keychain.load() == .credentials(.init(accessToken: "a2", refreshToken: "r2")))
    }

    // revoke 마커는 새 항목 슬롯에 있어 옛 두-키를 가리고, 옛 항목도 정리한다
    // (마이그레이션으로 옛 세션이 되살아나지 않는다).
    @Test("revoke는 legacy를 가리고 정리한다")
    func revokeShadowsAndCleansLegacy() {
        let store = MemoryRawStore([
            legacyAccess: Data("a".utf8),
            legacyRefresh: Data("r".utf8),
        ])
        let keychain = KeychainManager(store: store)
        #expect(keychain.revoke())
        #expect(keychain.load() == StoredSession.revoked)
        // 옛 항목은 정리됐다(가리기만 하는 게 아니라 지운다).
        #expect(store.read(account: legacyAccess) == .notFound)
        #expect(store.read(account: legacyRefresh) == .notFound)
    }

    // 이전 형식({accessToken,refreshToken}, revoked 키 없음)도 자격증명으로 읽힌다.
    @Test("revoked 키가 없는 이전 형식도 자격증명으로 읽는다")
    func decodesLegacyPayloadWithoutRevokedKey() {
        let store = MemoryRawStore([
            "session": Data(#"{"accessToken":"a","refreshToken":"r"}"#.utf8),
        ])
        let keychain = KeychainManager(store: store)
        #expect(keychain.load() == .credentials(.init(accessToken: "a", refreshToken: "r")))
    }

}
