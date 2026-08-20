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
///
/// 줄마다 아이콘이 붙는 것이 언어 선택과 다른 점이다(디자인의 `ThemeMenu`).
struct ThemeSwitcher: View {
    @Environment(ThemeStore.self) private var store
    @Environment(LocalizationStore.self) private var t
    @State private var isOpen = false

    var body: some View {
        PreferenceMenu(
            symbol: store.theme.symbol,
            current: t(store.theme.messageKey),
            label: t(.commonTheme),
            isOpen: $isOpen,
        ) {
            ForEach(AppTheme.allCases, id: \.self) { theme in
                PreferenceOption(
                    label: t(theme.messageKey),
                    symbol: theme.symbol,
                    isSelected: theme == store.theme,
                ) {
                    store.setTheme(theme)
                    isOpen = false
                }
            }
        }
    }
}

/// 언어 선택. 기기 설정과 다른 언어로 보고 싶은 경우를 위한 탈출구이며,
/// 고른 값은 저장되어 다음 실행에도 유지된다.
struct LocaleSwitcher: View {
    @Environment(LocalizationStore.self) private var t
    @State private var isOpen = false

    var body: some View {
        PreferenceMenu(
            symbol: "globe",
            current: t.locale.label,
            label: t(.commonLanguage),
            isOpen: $isOpen,
        ) {
            // 각 언어 이름은 그 언어로 적는다(`AppLocale.label`) — 지금 화면 언어를
            // 못 읽는 사용자가 쓰는 장치라, 현재 언어로 번역하면 정작 필요한 사람이
            // 자기 언어를 찾지 못한다.
            ForEach(AppLocale.allCases, id: \.self) { locale in
                PreferenceOption(
                    label: locale.label,
                    isSelected: locale == t.locale,
                ) {
                    t.setLocale(locale)
                    isOpen = false
                }
            }
        }
    }
}

/// 두 스위처가 공유하는 트리거 + 팝오버 껍데기 — 디자인의 `ThemeSelector`·`LanguageSelector`와
/// 그 짝인 `Menu` 컴포넌트에 해당하고, 웹에서는 SelectMenu 하나가 같은 자리를 맡는다
/// (apps/web/src/components/SelectMenu.tsx). 두 선택이 생김새를 공유해야 하므로 모양은
/// 여기에만 둔다.
///
/// 시스템 `Menu`가 아니라 팝오버를 직접 띄운다 — 시스템 메뉴는 껍데기 색·너비·줄 모양이
/// 플랫폼 소유라 디자인의 카드형 메뉴(`--color-card` · 184 너비 · 강조색 체크)를 그릴 수
/// 없고, **열린 상태를 알려주지 않아** 트리거가 눌린 티를 낼 수 없다.
private struct PreferenceMenu<Options: View>: View {
    let symbol: String
    let current: String
    /// 무엇을 고르는 목록인지(예: Language · Theme). 화면에는 보이지 않고 접근성
    /// 이름으로만 쓰인다 — 트리거에 보이는 것은 지금 고른 값뿐이라, 이 설명이 없으면
    /// 스크린 리더로는 그 버튼이 무엇을 하는지 알 수 없다.
    let label: String
    @Binding var isOpen: Bool
    @ViewBuilder let options: () -> Options

    var body: some View {
        Button { isOpen.toggle() } label: {
            HStack(spacing: AppDimension.Spacing.sm) {
                Image(systemName: symbol)
                Text(current)
                Image(systemName: "chevron.down")
            }
            .font(.system(size: AppDimension.FontSize.body, weight: .semibold))
            .foregroundStyle(isOpen ? AppColor.text : AppColor.muted)
            .padding(.horizontal, AppDimension.Select.triggerPadding)
            .frame(height: AppDimension.Select.triggerHeight)
            // 트리거는 평소 배경 없이 앉아 있다가 열릴 때만 판이 생긴다(웹
            // `.select__trigger`). 테두리는 닫혀 있을 때도 투명으로 자리를 잡아 둔다 —
            // 열릴 때 생기면 그만큼 폭이 늘어 트리거가 흔들린다.
            .background(
                isOpen ? AppColor.secondaryBackground : .clear,
                in: .rect(cornerRadius: AppDimension.Radius.md),
            )
            .overlay {
                RoundedRectangle(cornerRadius: AppDimension.Radius.md)
                    .stroke(
                        isOpen ? AppColor.border : .clear,
                        lineWidth: AppDimension.Select.borderWidth,
                    )
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .popover(isPresented: $isOpen) {
            VStack(spacing: AppDimension.Select.optionSpacing) {
                options()
            }
            .padding(AppDimension.Select.menuPadding)
            .frame(width: AppDimension.Select.menuWidth)
            // 아이폰에서 팝오버는 기본적으로 시트로 바뀐다 — 목록 하나 고르는 데 화면을
            // 절반 덮을 이유가 없어 팝오버로 유지한다(디자인의 `Theme open` 프레임).
            .presentationCompactAdaptation(.popover)
            .presentationBackground(AppColor.card)
        }
    }
}

/// 메뉴 한 줄(디자인의 `ThemeOption`·`LanguageOption`). 고른 항목은 **체크와 굵기**로
/// 구분한다 — 배경까지 쓰면 눌림 표시와 겹쳐 읽힌다(웹 `.select__option`과 같은 규칙).
private struct PreferenceOption: View {
    let label: String
    var symbol: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: AppDimension.Spacing.sm) {
                if let symbol {
                    Image(systemName: symbol)
                }
                Text(label)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if isSelected {
                    // 체크는 강조색이다 — 줄 색(muted/text)과 달라야 한눈에 지금 값이 잡힌다.
                    Image(systemName: "checkmark")
                        .foregroundStyle(AppColor.accent)
                }
            }
            .font(.system(
                size: AppDimension.FontSize.body,
                weight: isSelected ? .semibold : .regular,
            ))
            .foregroundStyle(isSelected ? AppColor.text : AppColor.muted)
            .padding(.horizontal, AppDimension.Select.optionPadding)
            .frame(height: AppDimension.Select.optionHeight)
            // 글자·아이콘이 없는 빈 자리도 눌리게 한다 — 줄 전체가 표적이다.
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // 목록에서 하나만 고르는 줄이다 — 스크린 리더가 "선택됨"을 읽도록 표시한다
        // (웹의 `role="menuitemradio"`와 같은 자리).
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
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
