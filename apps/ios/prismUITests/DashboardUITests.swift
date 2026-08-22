//
//  DashboardUITests.swift
//  prismUITests
//
//  데모 로그인으로 대시보드까지 실제로 그려지는지 확인하는 연기 테스트.
//  유닛 테스트는 상태 전이만 보므로, 셸·카드가 화면에 실제로 나오는지는 여기서 본다.
//  서버(`PRISM_API_URL`)가 떠 있어야 통과한다 — 그래서 기본 테스트 계획에는 넣지 않고
//  필요할 때 `-only-testing:prismUITests/DashboardUITests`로 돌린다.
//

import XCTest

final class DashboardUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// 대시보드까지 **도달한다.** "데모를 누른다"가 아닌 이유는, 앞 테스트가 로그인해 둔
    /// 세션이 다음 실행에도 살아 있어 로그인 화면이 아예 나오지 않기 때문이다. 둘 중 어느
    /// 화면에서 시작하든 같은 자리에서 끝나야 한다.
    ///
    /// - Returns: 대시보드에 있음을 확인해 주는 햄버거 버튼.
    @MainActor
    @discardableResult
    private func openDashboard(_ app: XCUIApplication) -> XCUIElement {
        let menuButton = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '메뉴 열기' OR label CONTAINS[c] 'Open menu'"),
        ).firstMatch
        // 이미 로그인돼 있다면 대시보드가 그려질 때까지가 전부다. 넉넉히 기다린다 —
        // 짧게 잡으면 느린 실행에서 "로그인 화면인가?"로 잘못 넘어간다.
        if menuButton.waitForExistence(timeout: 15) { return menuButton }

        let demo = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '데모' OR label CONTAINS[c] 'demo'"),
        ).firstMatch
        XCTAssertTrue(demo.waitForExistence(timeout: 10), "로그인 화면도 대시보드도 아니다")
        demo.tap()
        XCTAssertTrue(menuButton.waitForExistence(timeout: 15), "대시보드가 그려지지 않았다")
        return menuButton
    }

    @MainActor
    func testDemoLoginShowsDashboard() throws {
        let app = XCUIApplication()
        app.launch()

        // 로그인 화면의 데모 버튼. 문구는 언어를 따르므로 한국어·영어 둘 다 받는다.
        let demo = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '데모' OR label CONTAINS[c] 'demo'"),
        ).firstMatch
        XCTAssertTrue(demo.waitForExistence(timeout: 10), "데모 로그인 버튼이 없다")
        demo.tap()

        // 대시보드는 활성 세션 카드 하나로 확인한다.
        let card = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '활성 세션' OR label CONTAINS[c] 'Active sessions'"),
        ).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 15), "대시보드가 그려지지 않았다")

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "dashboard"
        shot.lifetime = .keepAlways
        add(shot)

    }


    /// 데모 세션을 하나 더 만든다 — 화면을 거치지 않고 서버에 직접 요청한다.
    ///
    /// 데모 로그인은 계정이 하나라, 어디서 들어오든 같은 사용자의 세션 목록에 쌓인다.
    /// 그래서 이 한 번의 요청이 "다른 기기에서도 로그인돼 있음"을 만들어 준다.
    @MainActor
    @discardableResult
    private func mintExtraDemoSession() throws -> String {
        // 앱과 같은 주소를 본다. 시뮬레이터에서 앱이 읽는 값과 어긋나지 않게, 기본값도
        // `APIEndpoint`와 같은 것을 쓴다.
        let base = ProcessInfo.processInfo.environment["PRISM_API_URL"]
            ?? "https://hsjung.asuscomm.com"
        guard let url = URL(string: base + "/auth/demo/native") else {
            throw XCTSkip("PRISM_API_URL이 주소로 읽히지 않는다: \(base)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15

        let done = expectation(description: "extra demo session")
        var status = 0
        var accessToken: String?
        URLSession.shared.dataTask(with: request) { data, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let data,
               let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                accessToken = body["accessToken"] as? String
            }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 20)

        // 서버가 없으면 이 테스트는 애초에 돌 수 없다 — 실패가 아니라 전제 미충족이다.
        guard (200..<300).contains(status), let token = accessToken else {
            throw XCTSkip("데모 세션을 만들지 못했다(HTTP \(status)) — 서버가 떠 있는지 확인")
        }

        // 방금 만든 세션이 목록에서 어느 것인지 알아 둔다 — 화면에 그것이 나타나는지로
        // 확인하면, 그사이 다른 세션이 만료돼 개수가 흔들려도 흔들리지 않는다.
        guard let listURL = URL(string: base + "/auth/sessions") else {
            throw XCTSkip("PRISM_API_URL이 주소로 읽히지 않는다: \(base)")
        }
        var listRequest = URLRequest(url: listURL)
        listRequest.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        listRequest.timeoutInterval = 15

        let listed = expectation(description: "sessions of the new token")
        var mintedID: String?
        URLSession.shared.dataTask(with: listRequest) { data, _, _ in
            defer { listed.fulfill() }
            guard let data,
                  let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else { return }
            // 그 토큰으로 물으면 방금 만든 세션이 `isCurrent`다.
            mintedID = rows.first { $0["isCurrent"] as? Bool == true }?["id"] as? String
        }.resume()
        wait(for: [listed], timeout: 20)

        guard let mintedID else { throw XCTSkip("만든 세션을 목록에서 찾지 못했다") }
        return String(mintedID.prefix(8))
    }



    /// 데모 계정의 **모든 세션을 폐기한다** — 다른 기기에서 이 앱의 세션을 해제한 상황을
    /// 만든다. 서버는 그런 토큰에 `401 UNAUTHORIZED`를 준다(갱신으로 살아나지 않는다).
    @MainActor
    private func revokeEveryDemoSession() throws {
        // 기본값을 두지 않는다. 이 함수는 데모 계정의 **모든 세션을 폐기**하므로, 주소를
        // 빠뜨린 채 돌리면 배포된 서버의 세션을 통째로 끊는다 — 실수의 대가가 너무 크다.
        guard let base = ProcessInfo.processInfo.environment["PRISM_API_URL"], !base.isEmpty
        else { throw XCTSkip("PRISM_API_URL을 지정해야 하는 테스트다(모든 세션을 폐기한다)") }
        guard let mintURL = URL(string: base + "/auth/demo/native"),
              let revokeURL = URL(string: base + "/auth/sessions/revoke-all")
        else { throw XCTSkip("PRISM_API_URL이 주소로 읽히지 않는다: \(base)") }

        var mint = URLRequest(url: mintURL)
        mint.httpMethod = "POST"
        mint.timeoutInterval = 15
        let minted = expectation(description: "token to revoke with")
        var token: String?
        URLSession.shared.dataTask(with: mint) { data, _, _ in
            if let data,
               let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                token = body["accessToken"] as? String
            }
            minted.fulfill()
        }.resume()
        wait(for: [minted], timeout: 20)
        guard let token else { throw XCTSkip("세션을 만들지 못했다 — 서버가 떠 있는지 확인") }

        var revoke = URLRequest(url: revokeURL)
        revoke.httpMethod = "POST"
        revoke.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        revoke.timeoutInterval = 15
        let done = expectation(description: "revoke all")
        var status = 0
        URLSession.shared.dataTask(with: revoke) { _, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 20)
        guard (200..<300).contains(status) else {
            throw XCTSkip("세션을 폐기하지 못했다(HTTP \(status))")
        }
    }

    /// 다른 기기에서 이 세션을 해제하면 갱신으로는 살아나지 않는다. 그때 화면이 오류만
    /// 띄우고 대시보드에 머물면, 사용자는 **이미 끝난 세션의 목록**을 보며 아무것도 할 수
    /// 없다 — 로그인 화면으로 돌아가야 한다.
    @MainActor
    func testRevokedSessionSendsUserBackToLogin() throws {
        let app = XCUIApplication()
        app.launch()
        openDashboard(app)

        try revokeEveryDemoSession()

        // 당겨서 새로고침 — 여기서 401 UNAUTHORIZED를 받는다.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
            .press(
                forDuration: 0.1,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)),
            )

        let demo = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '데모' OR label CONTAINS[c] 'demo'"),
        ).firstMatch
        XCTAssertTrue(
            demo.waitForExistence(timeout: 20),
            "폐기된 세션인데 대시보드에 남아 있다",
        )

        // 이유 없이 튕기면 무슨 일이 일어난 건지 알 수 없다 — 안내가 함께 떠야 한다.
        let notice = app.staticTexts.matching(
            NSPredicate(
                format: "label CONTAINS[c] '세션이 종료' OR label CONTAINS[c] 'session has ended'",
            ),
        ).firstMatch
        XCTAssertTrue(notice.waitForExistence(timeout: 5), "왜 로그아웃됐는지 알려 주지 않는다")

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "signed-out-notice"
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// 당겨서 새로고침. 세션 목록은 이 앱 밖에서도 바뀌므로(다른 기기 로그인·만료),
    /// 사용자가 스스로 맞출 손잡이가 있어야 한다.
    ///
    /// 카드 하나뿐이라 **내용이 화면보다 짧다** — 그 상태에서도 당겨지는지가 이 테스트의
    /// 핵심이다(`.scrollBounceBehavior(.always)`가 없으면 제스처 자체가 일어나지 않는다).
    @MainActor
    func testPullToRefreshPicksUpSessionsMadeElsewhere() throws {
        let app = XCUIApplication()
        app.launch()
        openDashboard(app)

        let anyCode = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '#'")).firstMatch
        XCTAssertTrue(anyCode.waitForExistence(timeout: 10), "세션 목록이 없다")

        // 화면 밖에서 세션을 하나 만든다. 개수가 아니라 **이 id**가 나타나는지로 본다 —
        // 그사이 다른 세션이 만료돼 개수가 흔들려도 이 확인은 흔들리지 않는다.
        let minted = app.staticTexts["#" + (try mintExtraDemoSession())]
        XCTAssertFalse(minted.exists, "당기기도 전에 목록이 갱신됐다")

        // `swipeDown()`은 당겨서 새로고침을 깨우기에 모자란다 — 위쪽에서 눌러 끌어내린다.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
            .press(
                forDuration: 0.1,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)),
            )

        XCTAssertTrue(minted.waitForExistence(timeout: 15), "당겼는데 목록이 갱신되지 않았다")
    }

    /// "모두 로그아웃"은 **바로 실행되지 않는다.** 되돌릴 수 없는 동작인데다 목록 아래,
    /// 행마다 있는 "해제" 바로 밑에 앉아 있어 오탭이 곧 전체 세션 폐기가 된다.
    /// 이 테스트가 지키는 것은 배치가 아니라 그 안전장치다.
    @MainActor
    func testSignOutAllAsksBeforeItRuns() throws {
        // 이 앱의 세션 하나뿐이면 버튼 자체가 나오지 않는다 — 그러면 테스트가 조용히
        // 건너뛰어 아무것도 지키지 못한다. 조건을 기다리지 말고 **직접 만든다.**
        try mintExtraDemoSession()

        let app = XCUIApplication()
        app.launch()

        let menuButton = openDashboard(app)

        let signOutAll = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '모두 로그아웃' OR label CONTAINS[c] 'Sign out all'"),
        ).firstMatch
        app.swipeUp()
        XCTAssertTrue(signOutAll.waitForExistence(timeout: 10), "전체 로그아웃 버튼이 없다")
        signOutAll.tap()

        let confirm = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '모든 기기에서' OR label CONTAINS[c] 'Sign out of all'"),
        ).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "확인 없이 바로 실행됐다")

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "sign-out-all-confirm"
        shot.lifetime = .keepAlways
        add(shot)

        // 취소하면 아무 일도 없어야 한다 — 대시보드에 그대로 남는다.
        app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '취소' OR label CONTAINS[c] 'Cancel'"),
        ).firstMatch.tap()
        XCTAssertTrue(menuButton.waitForExistence(timeout: 5), "취소했는데 화면을 잃었다")
    }

    /// 드로어의 테마·언어 메뉴는 트리거 **오른쪽**으로 열려야 한다 — 드로어는 좁고 길어
    /// 스위처가 바닥 가까이 앉고, 아래로 열면 자리가 없어 위로 뒤집힌다. 웹·Android도
    /// 같은 규칙이라, 여는 방향이 갈리면 셋을 나란히 놓았을 때 그대로 드러난다.
    /// (`.popover`의 `arrowEdge`는 화살표가 붙는 팝오버 쪽 변이라 뜻이 뒤집혀 읽힌다 —
    ///  `.leading`이 왼쪽이 아니라 **오른쪽으로 여는 값**이다)
    @MainActor
    func testDrawerPreferenceMenuOpensBesideItsTrigger() throws {
        let app = XCUIApplication()
        app.launch()

        let menuButton = openDashboard(app)
        menuButton.tap()

        // 드로어의 테마 스위처. 이 조회는 방향만이 아니라 **이름**도 지킨다 — 드로어
        // 전체에 `.accessibilityLabel`을 걸면 자식 레이블이 모두 덮여 여기서 걸린다.
        let trigger = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '테마' OR label CONTAINS[c] 'Theme'"),
        ).firstMatch
        XCTAssertTrue(trigger.waitForExistence(timeout: 5), "테마 스위처가 없다")
        let triggerFrame = trigger.frame
        trigger.tap()

        let option = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '라이트' OR label CONTAINS[c] 'Light'"),
        ).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 5), "메뉴가 열리지 않았다")

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "theme-menu"
        shot.lifetime = .keepAlways
        add(shot)

        // 트리거의 **오른쪽 변**과 견준다. minX끼리 견주면 겹쳐 뜬 메뉴도 통과한다.
        XCTAssertGreaterThan(
            option.frame.minX, triggerFrame.maxX,
            "메뉴가 옆이 아닌 곳으로 열렸다 — 웹·Android는 트리거 오른쪽으로 편다",
        )
        // 위아래로도 트리거에 걸려 있어야 한다 — 화면 반대편에 떠 있으면 어느 트리거가
        // 연 메뉴인지 알 수 없다.
        XCTAssertLessThan(
            abs(option.frame.minY - triggerFrame.minY), triggerFrame.height * 2,
            "메뉴가 트리거에서 위아래로 떨어져 열렸다",
        )
    }
}
