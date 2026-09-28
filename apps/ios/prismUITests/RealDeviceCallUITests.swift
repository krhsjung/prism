//
//  RealDeviceCallUITests.swift
//  prismUITests
//
//  **실기기에서만 뜻이 있는 테스트.** 시뮬레이터에는 카메라가 없어 통화가 서지 않고,
//  여기서 보려는 것은 통화가 선 **뒤에** 경로가 무너졌다 돌아오는 길이다(§8-11·§8-12).
//
//  밖에서 손이 하나 더 필요하다 — 같은 데모 계정으로 붙은 상대(웹)가 받아 줘야 하고,
//  경로를 끊는 것도 밖에서 한다(`docker pause coturn`). 그래서 테스트는 **상태를 계속
//  찍어 주는 관찰자**로 짰다: 붙은 뒤 정해진 시간 동안 배지를 초 단위로 남기고, 그 사이에
//  밖에서 길을 끊는다. 판정은 로그를 보고 한다.
//
//  ⚠️ **기기 잠금이 풀려 있어야 한다.** 잠겨 있으면 `Timed out while enabling automation
//  mode`로 막히는데, 메시지가 개발자 설정을 가리키는 것처럼 읽힌다 — 원인은 잠금뿐이고
//  풀면 그대로 통과한다.
//
//  기본 계획에 넣지 않는다:
//  `-only-testing:prismUITests/RealDeviceCallUITests/<이름>`으로 필요할 때만 돌린다.
//

import XCTest

final class RealDeviceCallUITests: XCTestCase {

    /// 붙은 뒤 배지를 지켜보는 시간. 밖에서 길을 끊고 되돌릴 여유다.
    private let watchSeconds = 100

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: - 길

    @MainActor
    @discardableResult
    private func openDashboard(_ app: XCUIApplication) -> XCUIElement {
        let menuButton = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '메뉴 열기' OR label CONTAINS[c] 'Open menu'"),
        ).firstMatch
        if menuButton.waitForExistence(timeout: 15) { return menuButton }

        let demo = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '데모' OR label CONTAINS[c] 'demo'"),
        ).firstMatch
        XCTAssertTrue(demo.waitForExistence(timeout: 10), "로그인 화면도 대시보드도 아니다")
        demo.tap()
        XCTAssertTrue(menuButton.waitForExistence(timeout: 20), "대시보드가 그려지지 않았다")
        return menuButton
    }

    @MainActor
    private func openWebRtc(_ app: XCUIApplication) {
        let menuButton = openDashboard(app)
        menuButton.tap()
        let navItem = app.buttons["WebRTC"].firstMatch
        XCTAssertTrue(navItem.waitForExistence(timeout: 5), "드로어에 WebRTC 항목이 없다")
        navItem.tap()
    }

    /// 권한 창이 떠 있으면 허용한다.
    @MainActor
    private func allowPermissionIfAsked() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(
            NSPredicate(format: "label == '허용' OR label == 'OK' OR label CONTAINS[c] 'Allow'"),
        ).firstMatch
        if allow.waitForExistence(timeout: 6) { allow.tap() }
    }

    /// 이름표 옆의 `걸기`를 고른다 — 버튼 라벨만으로는 어느 기기인지 알 수 없어
    /// **세로 위치가 가장 가까운 이름표**로 묶는다(Android에서 쓴 것과 같은 방법).
    @MainActor
    private func callButton(near name: String, in app: XCUIApplication) -> XCUIElement? {
        let calls = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '걸기' OR label CONTAINS[c] 'Call'"),
        )
        guard calls.firstMatch.waitForExistence(timeout: 20) else { return nil }

        let labels = app.staticTexts.matching(
            NSPredicate(format: "label ==[c] %@", name),
        )
        var anchors: [CGFloat] = []
        for i in 0..<labels.count { anchors.append(labels.element(boundBy: i).frame.midY) }
        guard !anchors.isEmpty else { return nil }

        var best: (element: XCUIElement, distance: CGFloat)?
        for i in 0..<calls.count {
            let button = calls.element(boundBy: i)
            guard button.exists else { continue }
            let y = button.frame.midY
            for anchor in anchors where abs(y - anchor) < 80 {
                let d = abs(y - anchor)
                if best == nil || d < best!.distance { best = (button, d) }
            }
        }
        return best?.element
    }

    /// 화면이 말하는 상태 한 줄.
    @MainActor
    private func badge(_ app: XCUIApplication) -> String {
        // **순서가 곧 판별이다.** `연결 중`은 `재연결 중`의 부분 문자열이고, 화면에
        // `연결됨`이 남아 있는 동안에도 배지는 이미 바뀌어 있을 수 있다 — 좁은 것부터 본다.
        let words = ["재연결 중", "연결 중", "연결 실패", "연결이 끊겨",
                     "통화가 끝났습니다", "호출 중", "연결됨"]
        for word in words {
            let hit = app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS %@", word),
            ).firstMatch
            if hit.exists { return word }
        }
        return "(없음)"
    }

    @MainActor
    private func shoot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: - 시험

    /// **TURN만 쓰는 통화를 세우고, 경로가 끊겼다 돌아오는 것을 지켜본다.**
    ///
    /// 로비에서 `TURN만 사용`을 고르면 미디어가 coturn을 지난다. 밖에서 그 컨테이너를
    /// 얼리면 **소켓은 살아 있고 미디어 길만 죽는다** — §8-11이 다루는 바로 그 경우다.
    @MainActor
    func testRelayCallWatchesPathLoss() throws {
        let app = XCUIApplication()
        app.launch()
        openWebRtc(app)

        let relay = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'TURN만' OR label CONTAINS[c] 'TURN only'"),
        ).firstMatch
        XCTAssertTrue(relay.waitForExistence(timeout: 15), "ICE 정책 라디오가 없다")
        relay.tap()

        guard let call = callButton(near: "Mac", in: app) else {
            throw XCTSkip("`Mac` 이름표 옆의 `걸기`가 없다 — 웹 피어가 붙어 있어야 한다")
        }
        call.tap()
        allowPermissionIfAsked()
        allowPermissionIfAsked()

        let connected = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '연결됨' OR label ==[c] 'Connected'"),
        ).firstMatch
        XCTAssertTrue(connected.waitForExistence(timeout: 45), "상대가 받았는데 붙지 않았다")
        print("PRISM-WATCH t=0 붙었다 epoch=\(Date().timeIntervalSince1970)")
        shoot("in-call")

        for i in 1...(watchSeconds / 2) {
            Thread.sleep(forTimeInterval: 2)
            print("PRISM-WATCH t=\(i * 2) \(badge(app)) epoch=\(Date().timeIntervalSince1970)")
            // 밖에서 길을 끊는 구간을 눈으로도 남긴다.
            if [20, 24, 28, 32].contains(i * 2) { shoot("outage-t\(i * 2)") }
        }
        shoot("after-watch")
        print("PRISM-WATCH 끝 \(badge(app))")
    }

    /// **그냥 붙는지만 본다** — 실기기 카메라로 웹과 실제 통화가 서는가.
    @MainActor
    func testCallsTheWebPeer() throws {
        let app = XCUIApplication()
        app.launch()
        openWebRtc(app)

        guard let call = callButton(near: "Mac", in: app) else {
            throw XCTSkip("`Mac` 이름표 옆의 `걸기`가 없다 — 웹 피어가 붙어 있어야 한다")
        }
        call.tap()
        allowPermissionIfAsked()
        allowPermissionIfAsked()

        let connected = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '연결됨' OR label ==[c] 'Connected'"),
        ).firstMatch
        XCTAssertTrue(connected.waitForExistence(timeout: 45), "상대가 받았는데 붙지 않았다")
        Thread.sleep(forTimeInterval: 8)
        print("PRISM-WATCH 붙었다 \(badge(app))")
        shoot("call-connected")
        Thread.sleep(forTimeInterval: 20)
    }
}
