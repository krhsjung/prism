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

    // ── 통화 화면이 새로 쓰는 글리프들 ──────────────────────────────────────
    //
    // 원본은 웹 `CallIcons.tsx`의 패스이고, 여기서도 24 그리드 · stroke 2다.
    // 꺼짐 글리프의 **사선 하나가 "지금 꺼져 있다"를 말하는 유일한 획**이라,
    // 굵기를 나머지와 같게 둔다(가늘게 하면 상태가 장식으로 읽힌다).

    /// 마이크 — 캡슐 + 받침 호 + 목.
    struct Mic: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            let s = scale(in: rect)
            // 캡슐: (9,2)에서 6×12, 반지름 3.
            path.addRoundedRect(
                in: CGRect(x: 9 * s.x, y: 2 * s.y, width: 6 * s.x, height: 12 * s.y),
                cornerSize: CGSize(width: 3 * s.x, height: 3 * s.y),
            )
            path.addPath(cradle(s))
            path.move(to: CGPoint(x: 12 * s.x, y: 18 * s.y))
            path.addLine(to: CGPoint(x: 12 * s.x, y: 22 * s.y))
            return path
        }
    }

    /// 마이크 꺼짐 — 같은 자리에 사선이 하나 더 있다.
    struct MicOff: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            let s = scale(in: rect)
            // 캡슐의 윗머리만 남긴다(사선이 아랫부분을 지나므로 그쪽은 끊어 그린다).
            path.move(to: CGPoint(x: 15 * s.x, y: 5 * s.y))
            path.addArc(
                center: CGPoint(x: 12 * s.x, y: 5 * s.y),
                radius: 3 * s.x,
                startAngle: .zero,
                endAngle: .radians(.pi),
                clockwise: true,
            )
            path.addLine(to: CGPoint(x: 9 * s.x, y: 10 * s.y))
            path.move(to: CGPoint(x: 9 * s.x, y: 12 * s.y))
            path.addLine(to: CGPoint(x: 9 * s.x, y: 11 * s.y))
            path.addPath(cradle(s))
            path.move(to: CGPoint(x: 12 * s.x, y: 18 * s.y))
            path.addLine(to: CGPoint(x: 12 * s.x, y: 22 * s.y))
            path.addPath(slash(s))
            return path
        }
    }

    /// 카메라 — 몸통 + 렌즈 쐐기.
    struct Camera: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            let s = scale(in: rect)
            path.addRoundedRect(
                in: CGRect(x: 2 * s.x, y: 6 * s.y, width: 14 * s.x, height: 12 * s.y),
                cornerSize: CGSize(width: 2 * s.x, height: 2 * s.y),
            )
            path.addPath(lens(s))
            return path
        }
    }

    /// 카메라 꺼짐.
    struct CameraOff: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            let s = scale(in: rect)
            path.addRoundedRect(
                in: CGRect(x: 2 * s.x, y: 6 * s.y, width: 14 * s.x, height: 12 * s.y),
                cornerSize: CGSize(width: 2 * s.x, height: 2 * s.y),
            )
            path.addPath(lens(s))
            path.addPath(slash(s))
            return path
        }
    }

    /// 통화 종료 — 내려놓은 수화기. 통화 글리프를 돌린 모양이 관습이다.
    struct PhoneOff: Shape {
        func path(in rect: CGRect) -> Path {
            var path = Path()
            let s = scale(in: rect)
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: x * s.x, y: y * s.y)
            }
            path.move(to: point(3.5, 14.5))
            // 두 기기 사이를 잇는 활 — 위로 볼록한 호 하나로 수화기의 등을 만든다.
            path.addQuadCurve(to: point(20.5, 14.5), control: point(12, 8.5))
            path.addLine(to: point(19.9, 17.1))
            path.addQuadCurve(to: point(18, 18.3), control: point(19.6, 18.5))
            path.addLine(to: point(15.4, 17.7))
            path.addQuadCurve(to: point(14.2, 16.3), control: point(14.4, 17.5))
            path.addLine(to: point(14, 14.7))
            path.addQuadCurve(to: point(10, 14.7), control: point(12, 14.3))
            path.addLine(to: point(9.8, 16.3))
            path.addQuadCurve(to: point(8.6, 17.7), control: point(9.6, 17.5))
            path.addLine(to: point(6, 18.3))
            path.addQuadCurve(to: point(4.1, 17.1), control: point(4.4, 18.5))
            path.closeSubpath()
            path.addPath(slash(s))
            return path
        }
    }

    /// 셰브런은 **펴지는 방향**을 가리킨다(plan/webrtc.md §4) — 접혀 있으면 아래,
    /// 펴져 있으면 위. 접이식의 유일한 시각 신호라 방향이 곧 뜻이다.
    struct Chevron: Shape {
        let up: Bool

        func path(in rect: CGRect) -> Path {
            var path = Path()
            let s = scale(in: rect)
            let middle: CGFloat = up ? 9 : 15
            let ends: CGFloat = up ? 15 : 9
            path.move(to: CGPoint(x: 6 * s.x, y: ends * s.y))
            path.addLine(to: CGPoint(x: 12 * s.x, y: middle * s.y))
            path.addLine(to: CGPoint(x: 18 * s.x, y: ends * s.y))
            return path
        }
    }

    /// 마이크를 받치는 반원(5,11)→(19,11). 켜짐·꺼짐이 같은 획을 쓴다.
    private static func cradle(_ s: CGPoint) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 5 * s.x, y: 11 * s.y))
        path.addArc(
            center: CGPoint(x: 12 * s.x, y: 11 * s.y),
            radius: 7 * s.x,
            startAngle: .radians(.pi),
            endAngle: .zero,
            clockwise: true,
        )
        return path
    }

    /// 카메라의 렌즈 쐐기(16,11)→(22,8)→(22,16).
    private static func lens(_ s: CGPoint) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 16 * s.x, y: 11 * s.y))
        path.addLine(to: CGPoint(x: 22 * s.x, y: 8 * s.y))
        path.addLine(to: CGPoint(x: 22 * s.x, y: 16 * s.y))
        path.addLine(to: CGPoint(x: 16 * s.x, y: 13 * s.y))
        path.closeSubpath()
        return path
    }

    /// 꺼짐을 말하는 사선. 세 글리프가 **같은 획**을 나눠 쓴다.
    private static func slash(_ s: CGPoint) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 3 * s.x, y: 3 * s.y))
        path.addLine(to: CGPoint(x: 21 * s.x, y: 21 * s.y))
        return path
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
