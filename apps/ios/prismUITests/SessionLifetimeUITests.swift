//
//  SessionLifetimeUITests.swift
//  prismUITests
//
//  "무엇이 유휴 창을 미는가"를 **실제 앱 + 실제 서버**로 확인한다.
//
//  유닛 테스트는 "이 요청에 활동 표식이 붙는가"까지만 본다. 그런데 이 기능이 실제로
//  지키려는 것은 그보다 한 겹 뒤에 있다 — 소켓이 시킨 재조회가 회전을 태우고, 그 회전이
//  유휴 창을 다시 채워, 기기 둘이 서로의 세션을 영원히 살려내던 문제다. 표식을 붙이는
//  코드가 맞아도 프록시가 헤더를 떨구거나 서버가 회전에서 밀어 버리면 그대로 되살아나는데,
//  그건 앱과 서버를 함께 세워 보기 전에는 드러나지 않는다.
//
//  서버(`PRISM_API_URL`)가 떠 있어야 하고 한 번에 1~2분이 걸린다 — 기본 테스트 계획에
//  넣지 않고 `-only-testing:prismUITests/SessionLifetimeUITests`로 필요할 때 돌린다.
//

import XCTest

final class SessionLifetimeUITests: XCTestCase {

    /// 액세스 토큰 수명(배포값 60초)보다 길게 기다린다 — 그래야 소켓이 깨운 재조회가
    /// **실제로 회전을 탄다**. 60초 안에 끝내면 회전이 아예 일어나지 않아, 밀지 않는지를
    /// 확인한 것이 아니라 아무 일도 일어나지 않은 것을 확인하게 된다.
    private static let idleWatch: TimeInterval = 80

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: - 서버 쪽 손잡이 (앱을 건드리지 않고 밖에서 세션을 다룬다)

    private var base: String {
        ProcessInfo.processInfo.environment["PRISM_API_URL"] ?? "https://hsjung.asuscomm.com"
    }

    /// 밖에서 서버를 보는 눈. 데모 로그인은 계정이 하나라 이 세션의 목록에 **앱의 세션도**
    /// 함께 보인다 — 앱을 조작하지 않고 앱의 유휴 창을 관측할 수 있는 이유다.
    private struct Observer {
        let token: String
        let sessionID: String
    }

    @discardableResult
    private func call(
        _ path: String,
        method: String = "GET",
        token: String? = nil,
    ) throws -> (status: Int, json: Any?) {
        guard let url = URL(string: base + path) else {
            throw XCTSkip("PRISM_API_URL이 주소로 읽히지 않는다: \(base)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }

        // ⚠️ 관측 요청에는 활동 표식(X-Prism-Activity)을 **절대 붙이지 않는다.**
        // 붙이면 재는 행위가 재려는 값을 밀어 버린다.
        let done = expectation(description: method + " " + path)
        var status = 0
        var json: Any?
        URLSession.shared.dataTask(with: request) { data, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let data, !data.isEmpty { json = try? JSONSerialization.jsonObject(with: data) }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 20)
        return (status, json)
    }

    /// 관측자를 새로 만든다. **매번 새로 만드는 이유**: 액세스 토큰이 60초짜리라, 이 테스트가
    /// 기다리는 동안 처음 받은 토큰은 만료된다(그걸로 읽으면 앱이 아니라 관측자가 고장 난다).
    private func mintObserver() throws -> Observer {
        let created = try call("/auth/demo/native", method: "POST")
        guard (200..<300).contains(created.status),
              let body = created.json as? [String: Any],
              let token = body["accessToken"] as? String
        else {
            throw XCTSkip("데모 세션을 만들지 못했다(HTTP \(created.status)) — 서버가 떠 있는지 확인")
        }
        let mine = try rows(using: token).first { $0["isCurrent"] as? Bool == true }
        guard let id = mine?["id"] as? String else {
            throw XCTSkip("방금 만든 세션을 목록에서 찾지 못했다")
        }
        return Observer(token: token, sessionID: id)
    }

    private func rows(using token: String) throws -> [[String: Any]] {
        let listed = try call("/auth/sessions", token: token)
        guard listed.status == 200, let rows = listed.json as? [[String: Any]] else {
            throw XCTSkip("세션 목록을 읽지 못했다(HTTP \(listed.status))")
        }
        return rows
    }

    /// 관측자의 눈에 비친 **앱의 세션**. 시작 전에 전부 폐기해 두므로 남는 것은 앱의 것과
    /// 관측자들의 것뿐이고, 관측자의 id는 우리가 알고 있다.
    private func appSession(seenBy observers: [Observer]) throws -> [String: Any] {
        let known = Set(observers.map(\.sessionID))
        guard let token = observers.last?.token,
              let app = try rows(using: token).first(where: { row in
                  guard let id = row["id"] as? String else { return false }
                  return !known.contains(id)
              })
        else { throw XCTSkip("앱의 세션을 목록에서 가려내지 못했다") }
        return app
    }

    private func expiry(of session: [String: Any]) throws -> String {
        guard let value = session["expiresAt"] as? String else {
            throw XCTSkip("세션에 만료 시각이 없다")
        }
        return value
    }

    /// 다른 기기가 붙었다 끊긴다. 이것이 서버가 `sessionsChanged`를 뿌리는 유일한 계기이고
    /// (연결·해제), 앱은 그 신호를 받아 목록을 다시 가져온다 — 이번 문제의 출발점이다.
    private func flickerAnotherDevice(_ observer: Observer) {
        var request = URLRequest(url: URL(string: base.replacingOccurrences(of: "https://", with: "wss://") + "/socket")!)
        request.setValue("Bearer " + observer.token, forHTTPHeaderField: "Authorization")
        let socket = URLSession.shared.webSocketTask(with: request)
        socket.resume()

        // 첫 메시지(`ready`)까지 기다린다 — 붙기도 전에 끊으면 신호가 나가지 않는다.
        let ready = expectation(description: "socket ready")
        socket.receive { _ in ready.fulfill() }
        wait(for: [ready], timeout: 20)
        socket.cancel(with: .goingAway, reason: nil)
    }

    /// 앱까지 포함해 이 계정의 모든 세션을 지운다. 목록을 **아는 상태**에서 시작해야
    /// "앱의 세션"을 가려낼 수 있다.
    private func clearEverySession() throws {
        let cleaner = try mintObserver()
        let cleared = try call("/auth/sessions/revoke-all", method: "POST", token: cleaner.token)
        guard (200..<300).contains(cleared.status) else {
            throw XCTSkip("세션을 비우지 못했다(HTTP \(cleared.status))")
        }
    }

    // MARK: - 앱 쪽 손잡이

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
        XCTAssertTrue(menuButton.waitForExistence(timeout: 15), "대시보드가 그려지지 않았다")
        return menuButton
    }

    // MARK: - 테스트

    /// **소켓이 시킨 재조회는 유휴 창을 밀지 않는다.**
    ///
    /// 앱을 열어 둔 채 손을 대지 않고, 밖에서 다른 기기를 붙였다 끊기만 반복한다. 앱은
    /// 그때마다 목록을 다시 가져오고(액세스가 60초라 그 사이 회전도 탄다), 그럼에도
    /// 앱 세션의 만료 시각은 **처음 그대로**여야 한다. 밀린다면 기기 둘이 서로를 영원히
    /// 살려 주던 그 문제가 그대로 살아 있는 것이다.
    @MainActor
    func testSocketDrivenRefetchDoesNotSlideTheIdleWindow() throws {
        try clearEverySession()

        let app = XCUIApplication()
        app.launch()
        openDashboard(app)

        var observers = [try mintObserver()]
        let before = try expiry(of: try appSession(seenBy: observers))

        let deadline = Date().addingTimeInterval(Self.idleWatch)
        while Date() < deadline {
            flickerAnotherDevice(observers[observers.count - 1])
            Thread.sleep(forTimeInterval: 20)
            // 관측자는 60초마다 새로 세운다(위 mintObserver 주석).
            observers.append(try mintObserver())
        }

        let after = try expiry(of: try appSession(seenBy: observers))
        XCTAssertEqual(after, before, "소켓이 깨운 재조회가 유휴 창을 밀었다")

        // 그동안 앱이 죽지 않았음도 함께 본다 — 안 미는 데 성공했는데 화면이 튕겨 있으면
        // 그건 고친 게 아니다.
        XCTAssertTrue(
            app.buttons.matching(
                NSPredicate(format: "label CONTAINS[c] '메뉴 열기' OR label CONTAINS[c] 'Open menu'"),
            ).firstMatch.exists,
            "밀지는 않았지만 앱이 대시보드에 남아 있지 않다",
        )
    }

    /// **다른 기기에서 해제하면 손대지 않아도 로그인 화면으로 돌아온다.**
    ///
    /// 앞 테스트가 "밀지 않음"을 지키는데, 밀지 않는 가장 쉬운 방법은 아무것도 안 하는 것이다 —
    /// 그러면 폐기도 반영되지 않는다. 이 테스트가 그 반대편을 잡는다: 사용자가 당겨서
    /// 새로고침하지 않아도, 소켓이 확정 거절을 받아 재조회를 시키고 그 401이 세션을 끝낸다.
    @MainActor
    func testRemoteRevokeReturnsToLoginWithoutAnyUserAction() throws {
        try clearEverySession()

        let app = XCUIApplication()
        app.launch()
        openDashboard(app)

        let observer = try mintObserver()
        guard let appID = try appSession(seenBy: [observer])["id"] as? String else {
            throw XCTSkip("앱의 세션 id를 읽지 못했다")
        }

        let revoked = try call("/auth/sessions/\(appID)/revoke", method: "POST", token: observer.token)
        XCTAssertTrue((200..<300).contains(revoked.status), "세션을 해제하지 못했다(HTTP \(revoked.status))")

        // 서버 스윕이 20초마다 세션을 다시 확인하므로 그 한 바퀴 + 여유만큼 기다린다.
        let demo = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '데모' OR label CONTAINS[c] 'demo'"),
        ).firstMatch
        XCTAssertTrue(demo.waitForExistence(timeout: 60), "해제됐는데 아무 조작이 없으면 대시보드에 남아 있다")

        let notice = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '세션이 종료' OR label CONTAINS[c] 'session has ended'"),
        ).firstMatch
        XCTAssertTrue(notice.waitForExistence(timeout: 5), "왜 로그아웃됐는지 알려 주지 않는다")
    }
}
