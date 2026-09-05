//
//  WebRtcUITests.swift
//  prismUITests
//
//  통화 화면이 **실제로 그려지는지** 보는 연기 테스트. 시안 네 프레임(로비 · 호출 중 ·
//  통화 중 · 진단 펼침)이 화면 안에서 도달 가능한지가 여기서 갈린다.
//
//  ⚠️ **시뮬레이터에는 카메라가 없다.** `RTCCameraVideoCapturer.captureDevices()`가 비어
//  돌아오므로 통화는 `not-found`로 막히고, 이 테스트가 확인할 수 있는 것은 로비까지다 —
//  그 사실 자체가 확인 대상이기도 하다(권한·장치 실패가 화면에서 어떻게 보이는가).
//  통화 중 레이아웃은 카메라가 있는 Android 에뮬레이터와 실기기가 맡는다.
//
//  서버(`PRISM_API_URL`)가 떠 있어야 통과한다 — 기본 테스트 계획에 넣지 않고 필요할 때
//  `-only-testing:prismUITests/WebRtcUITests`로 돌린다.
//

import XCTest

final class WebRtcUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// 대시보드까지 **도달한다**(DashboardUITests와 같은 이유로 "데모를 누른다"가 아니다 —
    /// 앞 실행의 세션이 살아 있으면 로그인 화면이 아예 나오지 않는다).
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

    /// 드로어의 `WebRTC`로 옮겨 간다 — 통화 화면이 **셸 안에** 있다는 것이 이 경로다(§4).
    @MainActor
    private func openWebRtc(_ app: XCUIApplication) {
        let menuButton = openDashboard(app)
        menuButton.tap()
        let navItem = app.buttons["WebRTC"].firstMatch
        XCTAssertTrue(navItem.waitForExistence(timeout: 5), "드로어에 WebRTC 항목이 없다")
        navItem.tap()
    }

    /// 로비가 시안대로 그려지는가 — 제목 · 기기 목록 · P2P 한 줄.
    @MainActor
    func testLobbyIsReachableAndDrawn() throws {
        let app = XCUIApplication()
        app.launch()
        openWebRtc(app)

        // 카드 머리. 로비의 제목은 통화 중과 다르다.
        let title = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '통화 시작' OR label CONTAINS[c] 'Start a call'"),
        ).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 10), "로비 제목이 없다")

        // 기기 목록 — 현재 세션 줄은 지우지 않고 **루프백 시험**으로 쓴다(§4).
        let test = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '시험' OR label CONTAINS[c] 'Test'"),
        ).firstMatch
        XCTAssertTrue(test.waitForExistence(timeout: 10), "루프백 시험 버튼이 없다")

        // **로비에서는 카메라를 열지 않는다** — 아직 허용 전이면 타일에 버튼 하나뿐이다.
        let preview = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '카메라 켜기' OR label CONTAINS[c] 'Turn on camera'"),
        ).firstMatch
        XCTAssertTrue(preview.exists, "카메라를 켜는 유일한 문이 없다")

        save(name: "lobby")
    }

    /// 컨트롤 바에 **종료가 없다.** 로비는 아직 통화가 아니므로 빨간 원을 그리지 않는다
    /// (`Molecule/CallControls` `End=false`) — 끄는 것이 아니라 없애는 것이 결정이다(§4).
    @MainActor
    func testLobbyHasNoEndButton() throws {
        let app = XCUIApplication()
        app.launch()
        openWebRtc(app)

        // 라벨은 켜짐/꺼짐에 따라 갈리므로(`마이크 끄기` ↔ `마이크 켜기`) 공통 낱말로 찾는다.
        let mute = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '마이크' OR label CONTAINS[c] 'microphone'"),
        ).firstMatch
        XCTAssertTrue(mute.waitForExistence(timeout: 10), "음소거 컨트롤이 없다")

        let end = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '통화 종료' OR label CONTAINS[c] 'End call'"),
        ).firstMatch
        XCTAssertFalse(end.exists, "로비에 종료 버튼이 그려졌다")
    }

    /// `카메라 켜기`를 누르면 **그때** 권한을 묻고, 그 뒤 결과가 화면에 나타난다.
    ///
    /// 확인하는 것이 둘이다: (1) 로비에 들어온 것만으로는 묻지 않는다 — 프롬프트가 이
    /// 탭 뒤에 처음 뜬다(§7). (2) 카메라를 얻지 못하면 **이유가 화면에 남는다** —
    /// 시뮬레이터에는 캡처 장치가 없어 `not-found`로 끝나고, 실기기의 거부와 같은 자리를 쓴다.
    @MainActor
    func testCameraIsAskedOnGestureThenResolved() throws {
        let app = XCUIApplication()
        app.launch()
        openWebRtc(app)

        let preview = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '카메라 켜기' OR label CONTAINS[c] 'Turn on camera'"),
        ).firstMatch
        XCTAssertTrue(preview.waitForExistence(timeout: 10), "카메라를 켜는 문이 없다")
        preview.tap()

        // 권한 창은 앱이 아니라 springboard가 그린다 — 앱 안에서는 찾을 수 없다.
        allowPermissionIfAsked()
        allowPermissionIfAsked() // 카메라 다음에 마이크를 한 번 더 묻는다.

        // 얻었으면 타일이 영상으로 바뀌고, 못 얻었으면 이유가 알림으로 뜬다 — **어느
        // 쪽이든 "아직 묻지 않았다"는 안내 문구는 사라진다.** 그것 하나만 확인한다:
        // 시뮬레이터에 캡처 장치가 있는지 없는지는 실행 환경마다 다르고, 이 테스트가
        // 지키려는 것은 "누른 뒤에 화면이 답한다"이지 어느 답인지가 아니다.
        let idle = app.staticTexts.matching(
            NSPredicate(format:
                "label CONTAINS[c] '통화가 시작되면' OR label CONTAINS[c] 'turns on when'"),
        ).firstMatch
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: idle)
        waitForExpectations(timeout: 15)
        save(name: "camera-result")
    }

    /// 권한 창이 떠 있으면 허용한다. 안 떠 있으면(이미 답한 실행) 아무 일도 하지 않는다.
    @MainActor
    private func allowPermissionIfAsked() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(
            NSPredicate(format: "label == '허용' OR label == 'OK' OR label CONTAINS[c] 'Allow'"),
        ).firstMatch
        if allow.waitForExistence(timeout: 5) { allow.tap() }
    }

    /// **루프백이 실제로 붙는다.** 한 화면 안의 두 `RTCPeerConnection`이 서로 offer/answer를
    /// 넘기고, 지표가 흐르고, 두 타일이 그려지는지 — 시안 `In call`·`In call (diagnostics
    /// open)`이 도달 가능한지를 여기서 본다.
    ///
    /// 시뮬레이터에는 캡처 장치가 없어 합성 프레임이 대신 들어간다(`SimulatorVideoCapturer`).
    /// 프레임의 출처만 다르고 협상·인코딩·지표는 실제 통화와 같은 길을 지난다.
    @MainActor
    func testLoopbackConnectsAndShowsDiagnostics() throws {
        let app = XCUIApplication()
        app.launch()
        openWebRtc(app)

        let test = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '시험' OR label CONTAINS[c] 'Test'"),
        ).firstMatch
        XCTAssertTrue(test.waitForExistence(timeout: 10), "루프백 시험 버튼이 없다")
        test.tap()
        allowPermissionIfAsked()
        allowPermissionIfAsked()

        // 붙으면 카드 머리의 배지가 `연결됨`이 된다 — 통화의 상태는 배지가 말한다(§4).
        let connected = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '연결됨' OR label ==[c] 'Connected'"),
        ).firstMatch
        XCTAssertTrue(connected.waitForExistence(timeout: 25), "루프백이 붙지 않았다")
        save(name: "loopback-in-call")

        // 진단을 편다 — 접힌 요약은 `Loopback`을 말해야 한다(후보 쌍이 아니라 사실이다).
        let diagnostics = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '진단' OR label CONTAINS[c] 'diagnostics'"),
        ).firstMatch
        XCTAssertTrue(diagnostics.waitForExistence(timeout: 5), "진단 행이 없다")
        diagnostics.tap()

        // 로그는 **비어 있는 것이 정상이다** — 루프백은 시그널링을 타지 않는다(§4).
        let empty = app.staticTexts.matching(
            NSPredicate(format:
                "label CONTAINS[c] '시그널링 서버를' OR label CONTAINS[c] 'signaling server'"),
        ).firstMatch
        XCTAssertTrue(empty.waitForExistence(timeout: 10), "루프백 로그 안내가 없다")
        save(name: "loopback-diagnostics")

        // 장치 설정은 **합친 라벨 하나**를 갖는다(`카메라 · 마이크`). 셀렉트가 제 라벨을
        // 다시 그리면 그 밑에 `카메라`·`마이크`가 한 번 더 나온다 — 시안에서 라벨은
        // 별도 노드이고 컨트롤은 값만 보인다 — 웹 `SelectMenu`가 `label`을 `sr-only`와
        // `aria-label`로만 쓰는 것과 같은 소유권이다.
        let combined = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS '·' AND (label CONTAINS[c] '마이크' "
                + "OR label CONTAINS[c] 'Microphone')"),
        ).firstMatch
        XCTAssertTrue(combined.waitForExistence(timeout: 5), "합친 장치 라벨이 없다")
        let standalone = app.staticTexts.matching(
            NSPredicate(format: "label ==[c] '마이크' OR label ==[c] 'Microphone' "
                + "OR label ==[c] '카메라' OR label ==[c] 'Camera'"),
        ).count
        XCTAssertEqual(standalone, 0, "진단에서 장치 라벨이 두 번 나온다")
        save(name: "loopback-diagnostics-devices")
    }

    /// **다른 기기와 실제로 붙는다.** 로비의 기기 목록에서 상대를 골라 걸고, 상대가
    /// 받으면 `연결됨`까지 간다 — 소켓 시그널링 · offer/answer · ICE · 두 타일이 한 번에
    /// 지나는 유일한 경로다.
    ///
    /// 같은 데모 사용자로 **다른 기기가 하나 더 붙어 있어야** 하고(그 기기가 받아 줘야
    /// 한다), 서버도 떠 있어야 한다. 그래서 기본 계획에 넣지 않고 필요할 때만 돌린다:
    /// `-only-testing:prismUITests/WebRtcUITests/testCallsAnotherDevice`
    @MainActor
    func testCallsAnotherDevice() throws {
        let app = XCUIApplication()
        app.launch()
        openWebRtc(app)

        // 목록에서 **닿을 수 있는 줄**만 `걸기`를 갖는다 — 없으면 상대가 안 붙어 있는 것이다.
        let call = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '걸기' OR label CONTAINS[c] 'Call'"),
        ).firstMatch
        guard call.waitForExistence(timeout: 15) else {
            throw XCTSkip("걸 수 있는 다른 기기가 없다 — 같은 계정으로 하나 더 붙여야 한다")
        }
        call.tap()
        allowPermissionIfAsked()
        allowPermissionIfAsked()

        // **`호출 중`은 단언하지 않는다.** 상대가 곧바로 받으면 그 상태가 1초도 안 가고,
        // 위의 권한 창 대기가 그 사이를 먹는다 — 없는 것을 실패로 읽게 된다. 벨 화면 자체는
        // 상대가 받지 않는 경우로 이미 확인했고, 여기서 지켜야 할 것은 **붙는 것**이다.
        let connected = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '연결됨' OR label ==[c] 'Connected'"),
        ).firstMatch
        XCTAssertTrue(connected.waitForExistence(timeout: 40), "상대가 받았는데 붙지 않았다")
        // 붙은 직후는 아직 첫 프레임 전일 수 있다 — 지표가 도는 것까지 보고 찍는다.
        Thread.sleep(forTimeInterval: 6)
        save(name: "call-connected")
    }

    /// **백그라운드로 내리면 통화가 끝난다.** 소켓만 닫고 통화를 남기면, 서버는 소켓이
    /// 사라진 것을 보고 상대에게 `peer-gone`을 보내 끝내지만 이쪽은 그 사실을 받을 통로가
    /// 없어 — 돌아왔을 때 끊을 수도 없는 통화가 화면에 남는다.
    @MainActor
    func testBackgroundEndsTheCall() throws {
        let app = XCUIApplication()
        app.launch()
        openWebRtc(app)

        let test = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] '시험' OR label CONTAINS[c] 'Test'"),
        ).firstMatch
        XCTAssertTrue(test.waitForExistence(timeout: 10), "루프백 시험 버튼이 없다")
        test.tap()
        allowPermissionIfAsked()
        allowPermissionIfAsked()

        let connected = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '연결됨' OR label ==[c] 'Connected'"),
        ).firstMatch
        XCTAssertTrue(connected.waitForExistence(timeout: 25), "루프백이 붙지 않았다")

        // 홈으로 내렸다가 돌아온다.
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 3)
        app.activate()

        // 통화는 없어야 하고 로비가 그 자리에 있어야 한다.
        let lobby = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] '통화 시작' OR label CONTAINS[c] 'Start a call'"),
        ).firstMatch
        XCTAssertTrue(lobby.waitForExistence(timeout: 15), "돌아왔는데 로비가 아니다")
        XCTAssertFalse(connected.exists, "백그라운드를 다녀왔는데 통화가 그대로 남아 있다")
        save(name: "after-background")
    }

    /// **홈으로 나갔다 돌아오면 presence가 되돌아온다.**
    ///
    /// 소켓을 백그라운드에서 닫는 것은 의도다(OS가 앱을 재우므로 유지할 수 없고, 스스로
    /// 닫아야 다른 기기의 목록에서 이 기기가 곧바로 사라진다). 문제는 **돌아왔을 때 다시
    /// 붙는가**였다: iOS는 복귀를 `.background → .inactive → .active` 두 단계로 알려 주는데
    /// 직전 단계만 보고 있어 다시 붙이는 분기가 한 번도 돌지 않았다.
    ///
    /// 이 테스트는 대시보드에 머무르며 홈 왕복만 한다 — **판정은 다른 기기가 한다**
    /// (같은 계정의 두 번째 기기에서 이 세션이 비활성 → 활성으로 돌아오는지 본다).
    /// 그래서 단계마다 넉넉히 멈춰, 밖에서 목록을 훑을 시간을 준다.
    @MainActor
    func testPresenceReturnsAfterBackground() throws {
        let app = XCUIApplication()
        app.launch()
        openDashboard(app)

        // 1단계: 붙어 있다.
        Thread.sleep(forTimeInterval: 10)

        // 2단계: 홈으로 내린다 — 소켓이 닫히고 다른 기기에서 비활성이 되어야 한다.
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 14)

        // 3단계: 돌아온다 — **여기서 다시 붙어야 한다.**
        app.activate()
        XCTAssertTrue(
            openDashboard(app).waitForExistence(timeout: 20),
            "복귀했는데 대시보드가 아니다",
        )
        Thread.sleep(forTimeInterval: 16)
        save(name: "after-return")
    }

    /// 화면을 찍어 둔다. 시안과 나란히 놓고 보는 것이 이 슬라이스의 검증 방법이라
    /// (한 폭에서만 확인해 배치가 접힌 적이 있다) 결과물을 파일로 남긴다.
    @MainActor
    private func save(name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        // 시뮬레이터의 `/tmp`는 호스트에서 그대로 읽힌다 — 첨부만 두면 xcresult를
        // 풀어야 볼 수 있어, 눈으로 확인하는 경로를 하나 더 둔다.
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/prism-ios-\(name).png"))
    }
}
