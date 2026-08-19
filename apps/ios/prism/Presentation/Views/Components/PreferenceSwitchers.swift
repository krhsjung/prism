//
//  PreferenceSwitchers.swift
//  prism
//
//  Path: Presentation/Views/Components/PreferenceSwitchers.swift
//

import SwiftUI

/// 테마 선택. 고르기 전에는 기기 설정을 따르고(system), 한 번 고르면 그 값이 저장되어
/// 기기 설정과 무관하게 유지된다.
///
/// 트리거에는 **고른 값**을 그대로 보여준다 — system일 때 지금 칠해진 색(라이트/다크)을
/// 보여주면 사용자가 무엇을 골랐는지 알 수 없게 된다(웹 ThemeSwitcher와 같은 규칙).
struct ThemeSwitcher: View {
    @Environment(ThemeStore.self) private var store
    @Environment(LocalizationStore.self) private var t

    var body: some View {
        Menu {
            Picker(t(.commonTheme), selection: selection) {
                ForEach(AppTheme.allCases, id: \.self) { theme in
                    Label(t(theme.messageKey), systemImage: theme.symbol).tag(theme)
                }
            }
            .pickerStyle(.inline)
        } label: {
            PreferenceLabel(symbol: store.theme.symbol, title: t(store.theme.messageKey))
        }
        .accessibilityLabel(t(.commonTheme))
    }

    private var selection: Binding<AppTheme> {
        Binding(get: { store.theme }, set: { store.setTheme($0) })
    }
}

/// 언어 선택. 기기 설정과 다른 언어로 보고 싶은 경우를 위한 탈출구이며,
/// 고른 값은 저장되어 다음 실행에도 유지된다.
struct LocaleSwitcher: View {
    @Environment(LocalizationStore.self) private var t

    var body: some View {
        Menu {
            Picker(t(.commonLanguage), selection: selection) {
                // 각 언어 이름은 그 언어로 적는다(`AppLocale.label`) — 지금 화면 언어를
                // 못 읽는 사용자가 쓰는 장치라, 현재 언어로 번역하면 정작 필요한 사람이
                // 자기 언어를 찾지 못한다.
                ForEach(AppLocale.allCases, id: \.self) { locale in
                    Text(locale.label).tag(locale)
                }
            }
            .pickerStyle(.inline)
        } label: {
            PreferenceLabel(symbol: "globe", title: t.locale.label)
        }
        .accessibilityLabel(t(.commonLanguage))
    }

    private var selection: Binding<AppLocale> {
        Binding(get: { t.locale }, set: { t.setLocale($0) })
    }
}

/// 두 스위처가 공유하는 트리거 모양 — 아이콘 + 현재 값.
private struct PreferenceLabel: View {
    let symbol: String
    let title: String

    var body: some View {
        HStack(spacing: AppDimension.Spacing.sm) {
            Image(systemName: symbol)
            Text(title)
        }
        .font(.system(size: AppDimension.FontSize.body, weight: .medium))
        .foregroundStyle(AppColor.muted)
        .padding(.horizontal, AppDimension.Spacing.md)
        .frame(height: AppDimension.Button.height)
        .background(AppColor.card)
        .clipShape(.rect(cornerRadius: AppDimension.Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                .stroke(AppColor.border, lineWidth: AppDimension.Button.borderWidth)
        }
    }
}

#Preview {
    HStack(spacing: AppDimension.Spacing.sm) {
        ThemeSwitcher()
        LocaleSwitcher()
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(AppColor.surface)
    .environment(ThemeStore())
    .environment(LocalizationStore())
}
