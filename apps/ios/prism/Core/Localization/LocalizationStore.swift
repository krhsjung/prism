//
//  LocalizationStore.swift
//  prism
//
//  Path: Core/Localization/LocalizationStore.swift
//

import Foundation
import Observation

extension AppLocale {
    /// 기본 언어 — locales.json의 첫 항목이다(생성 순서가 곧 우선순위).
    /// 생성기가 빈 목록을 거부하므로 첫 원소는 항상 존재한다.
    nonisolated static var fallback: AppLocale { allCases[0] }

    /// BCP 47 태그를 지원 언어로 좁힌다 — 하위 태그를 뒤에서부터 하나씩 떼며 맞춰 본다
    /// (`ko-KR` → `ko`, `zh-Hant-TW` → `zh-Hant` → `zh`). 시스템이 주는 값은 거의 항상
    /// 지역까지 붙어 있어(ko-KR) 정확히 일치하는 경우가 오히려 드물다.
    /// 웹의 `toLocale`(apps/web/src/lib/i18n/locale.ts)과 같은 규칙이다.
    nonisolated static func matching(_ tag: String) -> AppLocale? {
        var candidate = tag.trimmingCharacters(in: .whitespaces).lowercased()
        while !candidate.isEmpty {
            if let match = allCases.first(where: { $0.rawValue.lowercased() == candidate }) {
                return match
            }
            guard let cut = candidate.lastIndex(of: "-") else { return nil }
            candidate = String(candidate[candidate.startIndex..<cut])
        }
        return nil
    }

    /// 선호 순서대로 훑어 처음 지원되는 언어를 고른다. 하나도 없으면 기본 언어.
    nonisolated static func negotiated(from preferred: [String]) -> AppLocale {
        preferred.lazy.compactMap(matching).first ?? fallback
    }
}

/// 화면 언어를 정하고 문구를 꺼내 주는 곳.
///
/// iOS의 기본 동작은 "시스템 언어를 따른다"이고 앱 안에서 바꾸려면 설정 앱으로 나가야
/// 한다. 웹에는 화면 안에 언어 선택이 있으므로(LocaleSwitcher), 같은 경험을 주려면
/// 앱이 직접 언어를 골라 **그 언어의 `.lproj` 번들에서** 문구를 읽어야 한다 —
/// `String(localized:)`는 시스템 언어로만 해석하므로 여기서는 쓰지 않는다.
@MainActor
@Observable
final class LocalizationStore {
    /// 지금 화면에 쓰는 언어. 바뀌면 이 값을 읽는 뷰가 다시 그려진다.
    private(set) var locale: AppLocale

    /// 선택된 언어의 `.lproj` 번들. 못 찾으면 메인 번들(= 시스템 해석)로 떨어진다.
    @ObservationIgnored
    private var bundle: Bundle

    @ObservationIgnored
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let resolved = Self.detect(defaults: defaults)
        locale = resolved
        bundle = Self.resolveBundle(for: resolved)
    }

    /// 사용자가 고른 언어. 저장해 두고 다음 실행에도 유지한다.
    func setLocale(_ next: AppLocale) {
        guard next != locale else { return }
        defaults.set(next.rawValue, forKey: StorageKeys.locale)
        bundle = Self.resolveBundle(for: next)
        locale = next
    }

    /// 문구 한 줄. `values`는 `{name}` 형태의 런타임 변수를 채운다
    /// (빌드 시점 변수 `{{platform}}`은 생성기가 이미 치환했다).
    func callAsFunction(_ key: MessageKey, _ values: [String: String] = [:]) -> String {
        // `locale`을 읽어 SwiftUI observation 의존성을 등록한다. `bundle`은 locale에서
        // 파생된 @ObservationIgnored 캐시라, 이 읽기가 없으면 언어를 바꿔도 이 문구를 그린
        // 뷰가 다시 평가되지 않아 옛 언어로 남을 수 있다(문구는 뷰 body에서 호출된다).
        _ = locale
        let format = bundle.localizedString(forKey: key.rawValue, value: nil, table: key.table)
        guard !values.isEmpty else { return format }
        return values.reduce(format) { text, pair in
            text.replacingOccurrences(of: "{\(pair.key)}", with: pair.value)
        }
    }

    // MARK: - Private

    /// 표시할 언어: 사용자가 고른 값 > 기기 선호 순서 > 기본 언어.
    /// 지금 화면이 쓰고 있는 언어를 **격리 없이** 읽는다.
    ///
    /// `locale` 프로퍼티는 MainActor의 것이라 네트워크 계층(Sendable)에서 읽을 수 없다.
    /// 값의 원천은 어차피 UserDefaults와 시스템 선호 순서라 여기서 다시 계산해도 같다 —
    /// 웹이 `currentLocale()`을 두는 것과 같은 자리이며, 서버는 이 값을
    /// `Accept-Language`로 받아 **세션의 언어**로 담아 둔다(plan/push.md D4).
    nonisolated static func current(defaults: UserDefaults = .standard) -> AppLocale {
        detect(defaults: defaults)
    }

    nonisolated private static func detect(defaults: UserDefaults) -> AppLocale {
        if let stored = defaults.string(forKey: StorageKeys.locale),
           let match = AppLocale.matching(stored) {
            return match
        }
        return AppLocale.negotiated(from: Locale.preferredLanguages)
    }

    private static func resolveBundle(for locale: AppLocale) -> Bundle {
        guard let path = Bundle.main.path(forResource: locale.rawValue, ofType: "lproj"),
              let bundle = Bundle(path: path)
        else {
            // 번들에 그 언어가 없다면 프로젝트의 knownRegions에 코드가 빠진 것이다.
            // 문구 하나 때문에 앱이 죽을 이유는 없으므로 시스템 해석으로 넘긴다.
            Log.error("missing lproj for locale \(locale.rawValue) — check knownRegions")
            return .main
        }
        return bundle
    }
}
