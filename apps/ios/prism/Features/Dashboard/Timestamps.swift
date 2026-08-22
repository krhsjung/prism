//
//  Timestamps.swift
//  prism
//
//  Path: Features/Dashboard/Timestamps.swift
//

import Foundation

/// 계약의 ISO-8601 시각을 **화면 언어의 표기**로 옮긴다.
///
/// 기기 언어가 아니라 앱에서 고른 언어를 따른다 — 언어를 바꾸면 목록의 날짜도 함께
/// 바뀌어야 한다(웹은 `Intl`에 고른 로케일을, Android는 Activity 설정을 넘긴다).
///
/// 표기는 `DateFormatter`의 medium·short다. `Date.formatted(date: .abbreviated…)`를 쓰면
/// 한국어가 `2026년 8월 20일`로 나와 웹·Android의 `2026. 8. 20.`과 갈라진다 — 셋을 나란히
/// 놓고 보는 프로젝트라 같은 CLDR 표기로 맞춘다.
///
/// > 영어만 이음말이 다르다: Apple은 `Aug 20, 2026 at 11:55 PM`, 웹·Android는 `,`로 잇는다.
/// > 날짜와 시각을 따로 뽑아 손으로 이으면 영어는 맞지만 한국어·일본어가 어긋나므로
/// > (그 둘은 쉼표 없이 띄어 쓴다), 로케일이 정하는 이음말을 그대로 둔다.
@MainActor
enum DashboardTimestamp {

    /// 값이 형식에서 벗어나면 **원문을 그대로 보여준다** — 화면이 빈칸이 되는 것보다
    /// 낫고(무엇이 잘못됐는지 보인다), 목록 전체를 실패로 만들 이유도 없다.
    static func format(_ iso: String, locale: AppLocale) -> String {
        guard let date = parse(iso) else { return iso }
        return formatter(for: locale).string(from: date)
    }

    // MARK: - Private

    /// 서버가 보내는 두 형태를 받는다 — 밀리초가 있는 값과 없는 값.
    private static func parse(_ iso: String) -> Date? {
        withFraction.date(from: iso) ?? withoutFraction.date(from: iso)
    }

    private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let withoutFraction = ISO8601DateFormatter()

    /// `DateFormatter`는 만드는 값이 비싸다 — 언어마다 하나만 두고 재사용한다.
    private static var cache: [AppLocale: DateFormatter] = [:]

    private static func formatter(for locale: AppLocale) -> DateFormatter {
        if let cached = cache[locale] { return cached }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale.rawValue)
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        cache[locale] = formatter
        return formatter
    }
}
