//
//  PrismGlyph.swift
//  prism
//
//  Path: Presentation/Views/Components/PrismGlyph.swift
//

import SwiftUI

/// 웹·Android와 **같은 모양**을 그리는 아이콘.
///
/// SF Symbol을 쓰면 같은 자리에 다른 그림이 나온다 — `desktopcomputer`는 면으로 채운
/// 모니터라, 웹(`DeviceIcon`)·Android(`ic_monitor.xml`)의 선으로 그린 모니터와 실루엣이
/// 다르다. 세 플랫폼을 나란히 놓고 보는 프로젝트라 그 차이가 그대로 드러난다.
///
/// 원본은 웹의 SVG 패스이고, 24 그리드 · stroke 2 · 둥근 끝을 그대로 옮긴다. 크기는
/// 쓰는 쪽이 정하므로 `.frame`으로 준 크기에 맞춰 비례한다.
enum PrismGlyph {
    /// 세션 행의 기기 아이콘 — 화면 + 받침대(웹 `DeviceIcon`).
    struct Monitor: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            let s = scale(in: rect)
            // 화면: (3,4)에서 18×12, 모서리 반지름 1.
            path.addRoundedRect(
                in: CGRect(x: 3 * s.x, y: 4 * s.y, width: 18 * s.x, height: 12 * s.y),
                cornerSize: CGSize(width: 1 * s.x, height: 1 * s.y),
            )
            // 목: (12,16) → (12,20).
            path.move(to: CGPoint(x: 12 * s.x, y: 16 * s.y))
            path.addLine(to: CGPoint(x: 12 * s.x, y: 20 * s.y))
            // 받침: (8,20) → (16,20).
            path.move(to: CGPoint(x: 8 * s.x, y: 20 * s.y))
            path.addLine(to: CGPoint(x: 16 * s.x, y: 20 * s.y))
            return path
        }
    }

    /// 세션 행의 기기 아이콘 — 종류별 실루엣.
    ///
    /// **브랜드 로고를 쓰지 않는다** — 상표를 앱에 심는 일이고, 목록에서 필요한 것은
    /// 폰·태블릿·데스크톱이라는 형태 구분뿐이다. `unknown`은 모니터를 재사용한다:
    /// 모르는 것에 특별한 그림을 주면 그 자체가 하나의 상태처럼 읽힌다.
    /// 분기마다 타입이 달라 `some Shape`로는 묶이지 않는다 — 지우개 타입으로 감싼다.
    static func device(_ kind: DeviceKind) -> AnyShape {
        switch kind {
        case .iphone, .galaxy, .pixel, .android: AnyShape(Slab(inset: 7))
        case .ipad: AnyShape(Slab(inset: 4))
        case .mac, .windows, .desktop, .unknown: AnyShape(Monitor())
        }
    }

    /// 폰·태블릿의 공통 형태 — 세로로 선 판에 아래쪽 홈 하나. 좌우 여백만 다르다.
    struct Slab: Shape {
        let inset: CGFloat

        func path(in rect: CGRect) -> Path {
            var path = Path()
            let s = scale(in: rect)
            path.addRoundedRect(
                in: CGRect(
                    x: inset * s.x,
                    y: 2 * s.y,
                    width: (24 - inset * 2) * s.x,
                    height: 20 * s.y,
                ),
                cornerSize: CGSize(width: 2 * s.x, height: 2 * s.y),
            )
            path.move(to: CGPoint(x: 11 * s.x, y: 18 * s.y))
            path.addLine(to: CGPoint(x: 13 * s.x, y: 18 * s.y))
            return path
        }
    }

    /// 상단 바의 햄버거 — 세 줄(웹 `.topbar__menu`·Android `ic_menu.xml`).
    struct Menu: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            let s = scale(in: rect)
            for y in [7.0, 12.0, 17.0] {
                path.move(to: CGPoint(x: 4 * s.x, y: y * s.y))
                path.addLine(to: CGPoint(x: 20 * s.x, y: y * s.y))
            }
            return path
        }
    }

    /// 24 그리드를 실제 크기로 옮기는 배율.
    fileprivate static func scale(in rect: CGRect) -> CGPoint {
        CGPoint(x: rect.width / 24, y: rect.height / 24)
    }
}

private extension Shape {
    func scale(in rect: CGRect) -> CGPoint { PrismGlyph.scale(in: rect) }
}

extension Shape {
    /// 이 프로젝트의 아이콘 선 규칙 — 24 그리드에서 두께 2, 둥근 끝·이음.
    /// 크기가 달라져도 두께가 비례하도록 그리는 크기에 맞춰 환산한다.
    func prismStroke(size: CGFloat) -> some View {
        stroke(
            style: StrokeStyle(lineWidth: 2 * size / 24, lineCap: .round, lineJoin: .round),
        )
    }
}

#Preview {
    HStack(spacing: 16) {
        PrismGlyph.Monitor().prismStroke(size: 24).frame(width: 24, height: 24)
        PrismGlyph.Menu().prismStroke(size: 24).frame(width: 24, height: 24)
    }
    .foregroundStyle(AppColor.heading)
    .padding()
    .background(AppColor.card)
}
