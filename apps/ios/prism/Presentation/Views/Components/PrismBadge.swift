//
//  PrismBadge.swift
//  prism
//
//  Path: Presentation/Views/Components/PrismBadge.swift
//

import SwiftUI

/// 상태 배지 — 디자인의 `Atom/Badge`.
///
/// 세션 목록에서 "현재 세션"(Success)과 "그 밖의 활성 세션"(Info)을 가른다. 색만으로
/// 구분하지 않는다 — 배지 안의 문구가 같은 정보를 글로도 말한다(색각 이상·흑백 출력).
struct PrismBadge: View {
    enum Variant {
        case success
        case info

        var background: Color {
            switch self {
            case .success: AppColor.successBackground
            case .info: AppColor.secondaryBackground
            }
        }

        var foreground: Color {
            switch self {
            case .success: AppColor.success
            // 웹 `.badge--info`와 같은 토큰이다 — secondaryForeground(네이비)를 쓰면
            // 같은 배지가 플랫폼마다 다른 파랑으로 나온다.
            case .info: AppColor.accent
            }
        }
    }

    let title: String
    var variant: Variant = .info

    var body: some View {
        Text(title)
            .font(.system(size: AppDimension.Dashboard.badgeFontSize, weight: .semibold))
            .foregroundStyle(variant.foreground)
            .padding(.horizontal, AppDimension.Dashboard.badgeHorizontalPadding)
            // 높이를 **고정한다**. 패딩만 주면 플랫폼마다 글자 상자의 여백이 달라
            // (Compose는 폰트 패딩을 더하고 SwiftUI는 더하지 않는다) 같은 배지가 서로
            // 다른 높이로 나온다. 시안(`Atom/Badge`)의 23으로 못박아 셋을 맞춘다.
            .frame(height: AppDimension.Dashboard.badgeHeight)
            // 알약 모양 — 양끝이 완전한 반원이 된다.
            .background(variant.background, in: .capsule)
    }
}

/// 사용자 아바타 — 디자인의 `Atom/Avatar`.
///
/// 이미지를 쓰지 않는다. provider의 프로필 사진을 저장·중계하면 개인정보 미저장 원칙이
/// 깨지고(plan/auth.md §7), 원격 이미지를 그대로 걸면 리뷰어의 방문이 provider 쪽에
/// 남는다. 표시 이름에서 뽑은 이니셜로 대신한다(웹·Android `Avatar`와 같은 규칙).
///
/// 스크린리더에는 읽히지 않게 한다 — 이니셜은 옆의 이름을 줄인 장식이라, 읽어 주면
/// 같은 이름이 두 번 나온다.
struct PrismAvatar: View {
    let name: String

    var body: some View {
        Text(PrismAvatar.initials(of: name))
            .font(.system(size: AppDimension.FontSize.label, weight: .bold))
            .foregroundStyle(AppColor.primaryForeground)
            .frame(
                width: AppDimension.Dashboard.avatarSize,
                height: AppDimension.Dashboard.avatarSize,
            )
            .background(AppColor.primary, in: .circle)
            .accessibilityHidden(true)
    }

    /// 표시 이름 → 최대 두 글자.
    ///
    /// 라틴 이름은 단어별 첫 글자를 모으고(`Alex Kim` → `AK`), 한글·일본어는 앞 한 글자만
    /// 쓴다 — `정희석`을 `정희`로 자르면 이름이 아니라 다른 단어로 읽힌다. `Character`
    /// 단위로 다루므로 이모지·결합 문자도 쪼개지지 않는다.
    static func initials(of name: String) -> String {
        let words = name.split(whereSeparator: \.isWhitespace)
        guard let first = words.first?.first else { return "?" }
        if words.count == 1 || isCJK(first) {
            return String(first).uppercased()
        }
        guard let second = words.dropFirst().first?.first else {
            return String(first).uppercased()
        }
        return "\(first)\(second)".uppercased()
    }

    private static func isCJK(_ character: Character) -> Bool {
        guard let scalar = character.unicodeScalars.first else { return false }
        return switch scalar.value {
        case 0x3040...0x30FF, // 히라가나·가타카나
            0x3400...0x9FFF, // 한자
            0xAC00...0xD7AF: // 한글 음절
            true
        default:
            false
        }
    }
}

#Preview {
    VStack(spacing: AppDimension.Spacing.md) {
        PrismBadge(title: "Current", variant: .success)
        PrismBadge(title: "Active", variant: .info)
        PrismAvatar(name: "Alex Kim")
        PrismAvatar(name: "정희석")
    }
    .padding(AppDimension.Card.padding)
    .background(AppColor.card)
}
