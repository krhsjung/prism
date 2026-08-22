//
//  prismUITests.swift
//  prismUITests
//
//  Created by Hee Seok Jung on 8/5/26.
//

import XCTest

final class prismUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }


    /// 로그인 화면의 테마·언어 메뉴가 **열리는지**.
    ///
    /// 이 스위처들은 화면 **맨 아래**에 앉아 있다. 그래서 팝오버에 "아래로 열라"고 못 박으면
    /// 열 자리가 없어 아무 일도 일어나지 않는다 — 실제로 그렇게 죽은 적이 있다. 드로어
    /// 메뉴만 테스트하고 있어서 몰랐다.
    @MainActor
    func testLoginPreferenceMenusOpen() throws {
        let app = XCUIApplication()
        app.launch()

        let demo = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '데모' OR label CONTAINS[c] 'demo'"),
        ).firstMatch
        guard demo.waitForExistence(timeout: 15) else {
            throw XCTSkip("로그인 화면이 아니다 — 이미 로그인된 상태")
        }

        // 트리거의 접근성 이름은 "테마" 고정이다(무엇을 고르는 버튼인지 알리는 이름).
        // 지금 고른 값은 그 안의 **글자**로 보이므로, 바뀌었는지는 그쪽으로 본다.
        let trigger = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '테마' OR label CONTAINS[c] 'Theme'"),
        ).firstMatch
        XCTAssertTrue(trigger.waitForExistence(timeout: 5), "테마 스위처가 없다")
        XCTAssertTrue(app.staticTexts["시스템"].exists, "시작값이 시스템이 아니다")

        trigger.tap()

        let dark = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '다크'"),
        ).firstMatch
        XCTAssertTrue(dark.waitForExistence(timeout: 5), "메뉴가 열리지 않았다")

        let opened = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        opened.name = "login-theme-menu"
        opened.lifetime = .keepAlways
        add(opened)

        dark.tap()

        // 열리는 것만으로는 모자라다 — **고른 값이 반영돼야** 선택이 된 것이다.
        XCTAssertTrue(
            app.staticTexts["다크"].waitForExistence(timeout: 10),
            "다크를 골랐는데 트리거가 그대로다",
        )

        let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        after.name = "login-theme-applied"
        after.lifetime = .keepAlways
        add(after)
    }

    func testExample() throws {
        // UI tests must launch the application that they test.
        let app = XCUIApplication()
        app.launch()

        // Use XCTAssert and related functions to verify your tests produce the correct results.
        // XCUIAutomation Documentation
        // https://developer.apple.com/documentation/xcuiautomation
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            XCUIApplication().launch()
        }
    }
}
