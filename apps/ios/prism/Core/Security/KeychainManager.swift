//
//  KeychainManager.swift
//  prism
//
//  Path: Core/Security/KeychainManager.swift
//

import Foundation
import Security

/// 원시 읽기 결과. "없음"과 "읽기 실패"를 **구분**한다 — 이 둘을 nil로 뭉개면, 일시적
/// 읽기 오류를 "항목 없음"으로 오인해 최신 자격증명을 옛 값으로 마이그레이션·덮어쓰는
/// data-loss가 생긴다.
enum RawReadResult: Equatable {
    case data(Data)
    case notFound
    case failure
}

/// 계정 이름으로 원시 바이트를 넣고 빼는 저장소(SecItem 한 겹). KeychainManager가 이 위에
/// 세션 상태(자격증명·로그아웃 마커·마이그레이션·손상 복구)를 얹는다. 이 경계를 두면 그
/// 로직을 실제 Keychain 없이(인메모리 가짜로) 결정적으로 테스트할 수 있다 — unsigned
/// 테스트 빌드는 entitlement가 없어 SecItem 쓰기가 막힌다.
protocol RawKeychainStore: Sendable {
    func read(account: String) -> RawReadResult
    @discardableResult func write(_ data: Data, account: String) -> Bool
    @discardableResult func delete(account: String) -> Bool
}

/// 저장된 세션의 상태.
///
/// `revoked`가 핵심이다: 로그아웃 의도를 **자격증명을 지우는 것이 아니라 마커로 덮어써**
/// 남긴다. 삭제는 실패할 수 있고(그러면 옛 값이 되살아난다), 앱이 로그아웃 도중 죽거나
/// 재설치돼도 Keychain은 남으므로, "지웠다"에 기대면 로그아웃이 취소되는 경로가 생긴다.
/// 마커로 덮으면 그 durable한 의도가 자격증명과 같은 저장소(Keychain)에 함께 산다.
enum StoredSession: Equatable {
    case credentials(KeychainManager.Credentials)
    case revoked
    case none

    /// 자격증명이 있으면 꺼낸다(로그아웃 시 Bearer로 보낼 액세스 토큰 등).
    var credentials: KeychainManager.Credentials? {
        if case .credentials(let value) = self { return value }
        return nil
    }
}

/// 세션 자격증명 저장소의 계약. `AuthManager`가 이 프로토콜에 의존해, 테스트에서
/// 인메모리 가짜 저장소로 갈아 끼울 수 있다.
protocol CredentialStoring: Sendable {
    func load() -> StoredSession
    @discardableResult func save(_ credentials: KeychainManager.Credentials) -> Bool
    /// 로그아웃 의도를 durable하게 남긴다 — 자격증명을 `revoked` 마커로 대체한다.
    @discardableResult func revoke() -> Bool
    /// 완전 정리 — 마커까지 삭제한다(정상 로그아웃의 마무리 청소).
    @discardableResult func clear() -> Bool
}

/// 세션 자격증명 저장소.
///
/// 액세스 토큰과 리프레시 자격증명은 Keychain에만 둔다 — `UserDefaults`는 평문 plist라
/// 백업·파일 접근으로 새어 나간다(plan/auth.md §6: "iOS는 Keychain, 일반 UserDefaults 금지").
///
/// 세션은 **한 항목**(JSON 한 덩이)이며 세 상태를 가진다: 자격증명 · 로그아웃 마커
/// (`revoked`) · 없음. 한 항목이라 교체가 원자적이고, 로그아웃 의도도 같은 durable
/// 저장소에 함께 산다.
final class KeychainManager: CredentialStoring, Sendable {
    /// 세션을 잇는 자격증명 한 쌍. 항상 함께 저장·삭제된다.
    struct Credentials: Codable, Equatable, Sendable {
        let accessToken: String
        /// 액세스 토큰이 만료됐을 때 세션을 잇는 자격증명(1회용 — 쓰면 회전된다).
        let refreshToken: String
    }

    /// Keychain에 실제로 저장되는 JSON. `revoked`면 로그아웃 마커, 아니면 자격증명.
    ///
    /// `revoked`가 없으면 false로 본다 — 이전 형식(마커 개념이 없던 `{accessToken,refreshToken}`)
    /// 도 자격증명으로 읽혀 업데이트 후 강제 로그아웃되지 않는다.
    private struct Payload: Codable {
        let revoked: Bool
        let accessToken: String?
        let refreshToken: String?

        init(revoked: Bool, accessToken: String?, refreshToken: String?) {
            self.revoked = revoked
            self.accessToken = accessToken
            self.refreshToken = refreshToken
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            revoked = try c.decodeIfPresent(Bool.self, forKey: .revoked) ?? false
            accessToken = try c.decodeIfPresent(String.self, forKey: .accessToken)
            refreshToken = try c.decodeIfPresent(String.self, forKey: .refreshToken)
        }
    }

    private let store: RawKeychainStore

    private let account = "session"
    /// 옛 형식(토큰마다 항목 하나)의 계정 이름. 이제는 한 항목으로 저장하지만, 이전 버전을
    /// 설치했던 기기에는 이 항목들이 남아 있어 마이그레이션·정리 대상이다.
    private let legacyAccessAccount = "kr.hs.jung.prism.accessToken"
    private let legacyRefreshAccount = "kr.hs.jung.prism.refreshToken"

    init(store: RawKeychainStore) {
        self.store = store
    }

    /// 운영용 — 실제 Keychain(SecItem)에 저장한다.
    convenience init(service: String = Bundle.main.bundleIdentifier ?? "kr.hs.jung.prism") {
        self.init(store: SecurityKeychainStore(service: service))
    }

    /// 저장된 세션 상태.
    ///
    /// 새 항목이 없으면(진짜로 없을 때만) 옛 두-키 형식을 옮긴다(마이그레이션) — 이전 버전
    /// 사용자가 업데이트 후 강제 로그아웃되지 않게 한다. 읽기 실패는 "없음"으로 오인하지
    /// 않고 `.none`으로만 다뤄 기존 항목을 건드리지 않는다. 손상 항목은 지운 뒤 `.none`.
    func load() -> StoredSession {
        switch store.read(account: account) {
        case .data(let data):
            guard let payload = try? JSONDecoder().decode(Payload.self, from: data) else {
                Log.error("keychain session corrupt — removing")
                _ = store.delete(account: account)
                return .none
            }
            if payload.revoked { return .revoked }
            guard let accessToken = payload.accessToken,
                  let refreshToken = payload.refreshToken else {
                Log.error("keychain session malformed — removing")
                _ = store.delete(account: account)
                return .none
            }
            return .credentials(.init(accessToken: accessToken, refreshToken: refreshToken))
        case .notFound:
            return migrateLegacyIfPresent()
        case .failure:
            // 읽기 실패를 "없음"으로 오인하면 legacy로 최신 회전 토큰을 덮어쓰거나 로그아웃
            // 마커를 놓친다. 기존 항목을 건드리지 않고 세션 없음으로만 다룬다(다음에 복구).
            return .none
        }
    }

    /// 자격증명 저장(원자적 교체). `revoked` 마커가 있었다면 덮어쓴다(새 로그인).
    @discardableResult
    func save(_ credentials: Credentials) -> Bool {
        writePayload(
            .init(
                revoked: false,
                accessToken: credentials.accessToken,
                refreshToken: credentials.refreshToken,
            ),
        )
    }

    /// 로그아웃 의도를 durable하게 남긴다 — 자격증명을 `revoked` 마커로 **덮어쓰고** 옛
    /// 두-키 형식도 정리한다.
    ///
    /// 삭제가 아니라 덮어쓰기라, 앱이 로그아웃 도중 죽거나 재설치돼도(Keychain 잔존) 옛
    /// 자격증명이 되살아나지 않는다. 마커는 새 항목 슬롯에 있어 옛 두-키를 **가리므로**,
    /// 옛 항목 삭제가 실패해도(best-effort) load는 `.revoked`를 준다. 이 마커는 다음
    /// 로그인(`save`)이 자격증명으로 덮을 때까지 **영구 지키개**로 남는다 — 정상 경로에서는
    /// 절대 지우지 않는다(지우면 옛 항목이 다시 마이그레이션돼 부활할 수 있다).
    ///
    /// 반환값은 **마커 쓰기 성공 여부**다. 실패(Keychain에 쓸 수 없음)면 가릴 방법이 없어
    /// 호출부가 삭제 폴백을 시도한다.
    @discardableResult
    func revoke() -> Bool {
        let ok = writePayload(.init(revoked: true, accessToken: nil, refreshToken: nil))
        // 마커가 이미 가리지만, 남겨 둘 이유도 없으니 정리한다(실패해도 마커가 가린다).
        _ = store.delete(account: legacyAccessAccount)
        _ = store.delete(account: legacyRefreshAccount)
        return ok
    }

    /// 완전 삭제. 새 항목과 옛 두-키 형식을 **모두** 지운다(각각 실행 — `&&`로 이으면 단락
    /// 평가로 하나가 남을 수 있다).
    ///
    /// 이건 `revoke()`(마커 쓰기)가 **실패했을 때의 폴백**으로만 쓴다: 마커를 못 남기면
    /// 옛 항목을 가릴 수 없으므로, 삭제로라도 자격증명을 없애 본다. 정상 로그아웃은 마커를
    /// 지키개로 남기므로 이 경로를 타지 않는다.
    @discardableResult
    func clear() -> Bool {
        let sessionOK = store.delete(account: account)
        let legacyAccessOK = store.delete(account: legacyAccessAccount)
        let legacyRefreshOK = store.delete(account: legacyRefreshAccount)
        return sessionOK && legacyAccessOK && legacyRefreshOK
    }

    // MARK: - Private

    private func writePayload(_ payload: Payload) -> Bool {
        guard let data = try? JSONEncoder().encode(payload) else {
            Log.error("keychain encode failed")
            return false
        }
        return store.write(data, account: account)
    }

    /// 옛 두-키 형식이 있으면 새 형식으로 옮기고 옛 항목을 지운 뒤 그 값을 돌려준다.
    /// 둘 중 하나라도 없으면(부분 저장된 옛 상태) 마이그레이션하지 않고 `.none`.
    private func migrateLegacyIfPresent() -> StoredSession {
        guard
            case .data(let accessData) = store.read(account: legacyAccessAccount),
            case .data(let refreshData) = store.read(account: legacyRefreshAccount),
            let accessToken = String(data: accessData, encoding: .utf8),
            let refreshToken = String(data: refreshData, encoding: .utf8)
        else {
            return .none
        }
        let credentials = Credentials(accessToken: accessToken, refreshToken: refreshToken)
        Log.auth("migrating legacy keychain credentials to single-item format")
        // **저장 성공을 확인한 뒤에만** 옛 항목을 지운다 — 실패인데 옛 값을 지우면 복구할
        // 유일한 자격증명이 사라진다. 그때는 옛 값을 보존하고 이번 실행용 값만 돌려준다.
        guard save(credentials) else {
            Log.error("legacy migration save failed — keeping legacy for retry")
            return .credentials(credentials)
        }
        _ = store.delete(account: legacyAccessAccount)
        _ = store.delete(account: legacyRefreshAccount)
        return .credentials(credentials)
    }
}

/// 실제 Keychain(SecItem) 구현.
///
/// 접근 등급은 `AfterFirstUnlockThisDeviceOnly`다: 기기 잠금 해제 뒤에는 백그라운드에서도
/// 세션을 이을 수 있어야 하고(`WhenUnlocked`면 잠긴 화면에서 갱신이 실패한다),
/// `ThisDeviceOnly`라 백업·다른 기기로 따라가지 않는다 — 세션은 기기에 매인 값이다.
/// 저장은 delete 후 add가 아니라 update-or-add를 쓴다: update가 실패해도 기존 값은 남는다.
struct SecurityKeychainStore: RawKeychainStore {
    let service: String

    func read(account: String) -> RawReadResult {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return .notFound }
        guard status == errSecSuccess, let data = result as? Data else {
            // "항목 없음"과 진짜 오류(접근 제한·장애)를 구분한다 — 오류를 없음으로 뭉개면
            // 최신 자격증명을 옛 값으로 덮는 data-loss가 생긴다.
            Log.error("keychain read failed (\(account)): \(status)")
            return .failure
        }
        return .data(data)
    }

    func write(_ data: Data, account: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let insert = query.merging(attributes) { _, new in new }
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        if status != errSecSuccess {
            Log.error("keychain write failed (\(account)): \(status)")
            return false
        }
        return true
    }

    func delete(account: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        let ok = status == errSecSuccess || status == errSecItemNotFound
        if !ok { Log.error("keychain delete failed (\(account)): \(status)") }
        return ok
    }
}
