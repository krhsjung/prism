//
//  ThemeStore.swift
//  prism
//
//  Path: Core/Theme/ThemeStore.swift
//

import Observation
import SwiftUI

/// 고를 수 있는 테마. `system`은 "고르지 않음"이 아니라 기기 설정을 따르겠다는 선택이다 —
/// 라이트/다크를 고른 뒤에도 되돌아올 수 있어야 하므로 하나의 값으로 둔다
/// (웹 apps/web/src/lib/theme/theme.ts와 같은 정의).
enum AppTheme: String, CaseIterable, Sendable {
    case system
    case light
    case dark

    /// 이름은 번역 마스터에서 온다 — 웹의 테마 선택과 같은 문구를 쓴다.
    var messageKey: MessageKey {
        switch self {
        case .system: .themeSystem
        case .light: .themeLight
        case .dark: .themeDark
        }
    }

    var symbol: String {
        switch self {
        case .system: "desktopcomputer"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }

    /// SwiftUI에 넘길 값. `system`은 nil이어야 기기 설정을 그대로 따른다.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// 테마 선택을 기억하는 곳. 고른 적이 없으면 기기 설정을 따른다.
@MainActor
@Observable
final class ThemeStore {
    private(set) var theme: AppTheme

    @ObservationIgnored
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.string(forKey: StorageKeys.theme)
        theme = stored.flatMap(AppTheme.init(rawValue:)) ?? .system
    }

    func setTheme(_ next: AppTheme) {
        guard next != theme else { return }
        defaults.set(next.rawValue, forKey: StorageKeys.theme)
        theme = next
    }
}
