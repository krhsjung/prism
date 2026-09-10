//
//  PushSamples.swift
//  prism
//
//  Path: Features/Push/PushSamples.swift
//

import SwiftUI

/// 알림에 바로 실어 볼 수 있는 샘플 이미지 — 웹 `lib/push/samples.ts`의 짝이다.
///
/// **이 서비스가 서빙한다.** 리뷰어가 공개 이미지 주소를 따로 구해 오지 않아도
/// 시연할 수 있어야 하기 때문이다(plan/push.md §5-11). 업로드를 받지 않는 이유도
/// 거기 있다 — 저장소가 생기면 "개인정보를 저장하지 않습니다"와 부딪힌다.
///
/// ⚠️ **로컬 개발에서는 뜨지 않는다.** FCM이 이미지를 직접 내려받는데 `localhost`에는
/// 닿을 수 없다. 배포된 주소에서만 보인다.
nonisolated enum PushSampleImages {
    struct Sample: Identifiable {
        let path: String
        /// 고른 것을 표시하는 칩의 색. 그림을 만든 두 색과 같은 토큰이다.
        ///
        /// ⚠️ 토큰은 테마를 따라가지만 **그림은 고정이다** — 다크에서 칩과 그림의 색이
        /// 조금 어긋난다. 칩이 하는 일은 "어느 샘플인가"를 가리키는 것뿐이라 그대로 둔다.
        /// 웹은 hex를 박아 두었지만, 이 저장소는 색을 박지 않는다(AppColor 주석).
        let from: Color
        let to: Color

        var id: String { path }
    }

    static let all: [Sample] = [
        Sample(path: "/push-samples/deep.png", from: AppColor.primary, to: AppColor.accent),
        Sample(
            path: "/push-samples/calm.png",
            from: AppColor.secondaryBackground,
            to: AppColor.accent,
        ),
        Sample(path: "/push-samples/green.png", from: AppColor.success, to: AppColor.primary),
    ]

    /// 샘플의 절대 주소. **웹과 같은 출처에서 온다** — nginx가 `/auth`·`/api`·`/socket`만
    /// 서버로 보내고 나머지는 웹 정적 파일로 주기 때문에, API 주소가 곧 그 출처다.
    static func url(_ sample: Sample) -> String {
        URL(string: sample.path, relativeTo: APIConfiguration.baseURL)?.absoluteString ?? ""
    }
}
