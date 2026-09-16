//
//  PushUITests.swift
//  prismUITests
//
//  푸시 화면이 **실제로 어떻게 그려지는지** 눈으로 확인하는 연기 테스트.
//  단언은 "도달했다"까지만 하고, 나머지는 스크린샷으로 남긴다 — 레이아웃이 시안과
//  맞는지는 사람이 봐야 하고, 그때 필요한 것은 통과/실패가 아니라 그림이다.
//
//  서버(`PRISM_API_URL`, 기본값은 개발 주소)가 떠 있어야 통과한다 — DashboardUITests와
//  같은 조건이라 기본 테스트 계획에 넣지 않고 필요할 때만 돌린다:
//  `-only-testing:prismUITests/PushUITests`
//

import XCTest

final class PushUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// 푸시 화면까지 **도달한다.** DashboardUITests와 같은 이유로 "데모를 누른다"가 아니다 —
    /// 앞 실행의 세션이 살아 있으면 로그인 화면이 아예 나오지 않는다.
    @MainActor
    private func openPush(_ app: XCUIApplication) {
        let menuButton = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '메뉴 열기' OR label CONTAINS[c] 'Open menu'"),
        ).firstMatch

        if !menuButton.waitForExistence(timeout: 15) {
            let demo = app.buttons.matching(
                NSPredicate(format: "label CONTAINS[c] '데모' OR label CONTAINS[c] 'demo'"),
            ).firstMatch
            XCTAssertTrue(demo.waitForExistence(timeout: 10), "로그인 화면도 대시보드도 아니다")
            demo.tap()
            XCTAssertTrue(menuButton.waitForExistence(timeout: 15), "대시보드가 그려지지 않았다")
        }

        menuButton.tap()
        let pushItem = app.buttons.matching(
            NSPredicate(format: "label == '푸시' OR label == 'Push' OR label == 'プッシュ'"),
        ).firstMatch
        XCTAssertTrue(pushItem.waitForExistence(timeout: 5), "드로어에 푸시 항목이 없다")
        pushItem.tap()
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// 화면을 **위에서 아래까지** 훑어 담는다. 푸시 화면은 한 화면에 들어가지 않으므로
    /// 한 장만 찍으면 시안과 견줄 수 없다.
    @MainActor
    func testPushScreenLooksLikeThis() throws {
        let app = XCUIApplication()
        app.launch()
        openPush(app)

        // 화면이 실제로 바뀌었는지는 보내기 버튼으로 확인한다 — 이 화면에만 있다.
        let send = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '보내기' OR label CONTAINS[c] 'Send'"),
        ).firstMatch
        XCTAssertTrue(send.waitForExistence(timeout: 10), "푸시 화면이 그려지지 않았다")

        attach("push-1-top")
        for index in 2...5 {
            app.swipeUp(velocity: .slow)
            attach("push-\(index)-scrolled")
        }
    }

    /// `알림 켜기`를 누르면 **시스템 권한 창이 뜨는가.**
    ///
    /// 창은 앱이 아니라 springboard가 그리므로 `app`의 쿼리로는 보이지 않는다 —
    /// 화면 전체를 찍어 확인한다. 권한이 이미 정해진 기기에서는 창이 뜨지 않는 것이
    /// 정상이라(iOS는 한 번만 묻는다), 이 테스트는 **막 설치한 상태**를 전제한다.
    @MainActor
    func testAllowButtonOpensSystemPrompt() throws {
        let app = XCUIApplication()
        app.launch()
        openPush(app)

        let allow = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '알림 켜기' OR label CONTAINS[c] 'Turn on'"),
        ).firstMatch
        guard allow.waitForExistence(timeout: 10) else {
            // **실패가 아니라 건너뜀이다.** iOS는 한 번만 묻고, 그 뒤로는 이 버튼 대신
            // 끄기·차단 안내가 선다. 앱을 지웠다 깔면 다시 물을 수 있는 상태가 된다:
            // `xcrun simctl uninstall <device> kr.hs.jung.prism`
            attach("no-allow-button")
            throw XCTSkip("권한이 이미 정해진 기기다 — 지웠다 깔아야 물어볼 수 있다")
        }
        attach("prompt-1-before")
        allow.tap()

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        let appeared = alert.waitForExistence(timeout: 10)
        attach("prompt-2-after")
        XCTAssertTrue(appeared, "시스템 권한 창이 뜨지 않았다")
    }
}
