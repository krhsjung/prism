//
//  NetworkManager.swift
//  prism
//
//  Path: Core/Networking/NetworkManager.swift
//

import Foundation
import UIKit

/// HTTP 호출 한 겹.
///
/// 자격증명을 다루는 방식이 웹과 다르다는 점이 이 타입의 핵심이다:
/// **쿠키를 쓰지 않는다.** 서버의 웹 흐름은 세션을 HttpOnly 쿠키로 심는데, URLSession은
/// 기본적으로 그 쿠키를 자동 저장·자동 전송한다. 그대로 두면 네이티브가 Bearer 토큰
/// 없이도 "어쩌다" 인증되는 경로가 생기고, 그 경로는 Keychain을 거치지 않는다 —
/// plan/auth.md §6이 네이티브에 요구하는 저장 위치를 조용히 우회하는 셈이다.
/// 그래서 쿠키 항아리를 아예 끈다: 네이티브의 인증 경로는 Bearer 하나뿐이다.
/// 401을 만난 요청을 위해 세션을 한 번 갱신해 주는 것.
///
/// `NetworkManager`가 `AuthManager`를 직접 알면 고리가 된다(NetworkManager → AuthService →
/// AuthManager → NetworkManager). 그래서 좁은 구멍 하나만 두고, 조립하는 곳에서 **만든
/// 뒤에** 꽂는다.
@MainActor
protocol SessionAuthority: AnyObject, Sendable {
    /// **이 토큰으로** 나가는 요청에 찍을 세션 표식. 지금 세션이 발급한 토큰이 아니면 nil.
    ///
    /// 요청을 **보내는 시점**에 찍어 두고 401의 뒷일까지 그대로 들고 간다. 응답이 돌아오기
    /// 전에 로그아웃하고 다시 로그인하면 그 401은 **끝난 세션**의 것인데, 토큰만 비교해서는
    /// 회전과 구분되지 않는다 — 옛 요청이 새 세션의 토큰으로 재생되거나, 새 세션을 끊는다.
    ///
    /// 토큰을 함께 받는 이유도 같다. 부르는 쪽이 토큰을 읽은 시점과 요청이 실제로 나가는
    /// 시점 사이에는 회전·재로그인이 끼어들 수 있어, 표식만 새로 찍으면 **옛 토큰이 새
    /// 세션의 이름표를 달고** 나간다.
    func sessionMark(usedAccessToken: String) -> Int?

    /// 액세스 토큰이 곧 만료되는가 — 요청을 **보내기 전에** 회전할지 가른다.
    ///
    /// 타이머로 미리 돌지 않는 이유는 idle 타임아웃 때문이다: 요청이 없는 동안에도
    /// 세션을 밀면 화면만 열어두면 세션이 영영 살아 있게 된다. 요청이 있을 때만 보면
    /// 유휴 상태의 트래픽이 0이면서도 만료된 요청의 왕복을 아낀다.
    func isNearExpiry() -> Bool

    /// 만료된 세션을 갱신한다.
    ///
    /// - Parameters:
    ///   - mark: 요청을 보낼 때 찍은 세션 표식. 그 세션이 아직 살아 있을 때만 손댄다.
    ///   - usedAccessToken: 401을 받은 그 토큰. 이미 다른 요청이 갱신했는지 가린다.
    /// - Returns: 재시도에 쓸 새 액세스 토큰. 갱신하지 못했으면 nil.
    func refreshForRetry(mark: Int, usedAccessToken: String) async -> String?

    /// 서버가 **확정한** 인증 실패(폐기·변조)를 알린다 — 갱신으로는 살아나지 않는다.
    ///
    /// 다른 기기에서 이 세션을 해제하면 여기로 온다. 화면이 "불러오지 못했습니다"를 띄우고
    /// 마는 대신, 세션의 주인이 자격증명을 지우고 로그인 화면으로 보낸다.
    ///
    /// - Parameters:
    ///   - mark: 요청을 보낼 때 찍은 세션 표식. 그사이 세션이 갈렸다면 낡은 응답이 새
    ///     세션을 끊어서는 안 된다.
    ///   - usedAccessToken: 401을 받은 그 토큰. 아직 현재값일 때만 정리한다.
    func endSession(mark: Int, usedAccessToken: String) async
}

final class NetworkManager: Sendable {
    /// 이 요청을 **사용자가 시켰다**는 표시(서버의 ACTIVITY_HEADER).
    ///
    /// 서버는 이 표시가 붙은 요청에만 세션의 유휴 창을 민다 — 없으면 밀지 않는다
    /// (plan/auth.md §6). 소켓이 시킨 재조회만 표시를 달지 않는다.
    static let activityHeader = "X-Prism-Activity"

    /// 화면이 지금 쓰고 있는 언어를 읽는 법.
    ///
    /// **값이 아니라 읽는 법인 이유는 값이 바뀌기 때문이다** — 언어 스위처로 고르면
    /// 다음 요청부터 새 값이 실려야 한다. 서버는 이것을 `Accept-Language`로 받아
    /// **세션의 언어**로 담아 두고, 나중에 그 기기로 보내는 알림 문구를 그 언어로
    /// 그린다(plan/push.md D4). 기기 설정이 아니라 앱에서 고른 언어다.
    ///
    /// 컨테이너가 꽂기 전(초기화 중·테스트)에는 기본 언어다.
    nonisolated(unsafe) var languageTag: @Sendable () -> String = { "en" }

    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    /// 401의 뒷일을 맡을 것. 조립이 끝난 뒤 한 번 꽂히고, 그다음부터는 읽기만 한다 —
    /// 그 한 번의 쓰기와 이후의 읽기가 다른 스레드일 수 있어 잠금으로 감싼다.
    private let refresherLock = NSLock()
    nonisolated(unsafe) private var refresher: (any SessionAuthority)?

    func use(authority: any SessionAuthority) {
        refresherLock.withLock { self.refresher = authority }
    }

    private var currentAuthority: (any SessionAuthority)? {
        refresherLock.withLock { refresher }
    }

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = APIConfiguration.requestTimeout
        configuration.timeoutIntervalForResource = APIConfiguration.resourceTimeout
        // 위 주석 참고 — 세션 쿠키가 끼어들 자리를 만들지 않는다.
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        session = URLSession(configuration: configuration)
    }

    /// 응답 body가 있는 요청.
    func send<Response: Decodable, Body: Encodable>(
        _ endpoint: APIEndpoint,
        body: Body,
        accessToken: String? = nil,
        background: Bool = false,
    ) async throws -> Response {
        let data = try await perform(
            endpoint, body: try encode(body), accessToken: accessToken, background: background,
        )
        return try decode(data, as: Response.self)
    }

    /// body 없이 보내고 응답만 받는 요청.
    func send<Response: Decodable>(
        _ endpoint: APIEndpoint,
        accessToken: String? = nil,
        // 이 요청이 **서버가 밀어 준 신호 때문에** 나가는가. 그때의 회전은 세션의
        // 유휴 창을 밀지 않는다(plan/auth.md §6).
        background: Bool = false,
    ) async throws -> Response {
        let data = try await perform(
            endpoint, body: nil, accessToken: accessToken, background: background,
        )
        return try decode(data, as: Response.self)
    }

    /// 응답 body를 쓰지 않는 요청(예: 204 로그아웃).
    func sendIgnoringResponse(
        _ endpoint: APIEndpoint,
        accessToken: String? = nil,
    ) async throws {
        _ = try await perform(endpoint, body: nil, accessToken: accessToken)
    }

    // MARK: - Private

    /// 이 앱이 자기를 소개하는 문자열.
    ///
    /// URLSession 기본값(`prism/1 CFNetwork/… Darwin/…`)에는 기기 단서가 없어 서버가
    /// 세션 목록에 "알 수 없는 기기"로만 그린다. 브라우저와 **같은 토큰**(`iPhone`/`iPad`)을
    /// 써서, 서버가 UA를 네 갈래로 접는 규칙 하나만 갖게 한다(plan/dashboard.md §5).
    /// 서버는 이 문자열을 저장하지 않고 접은 결과만 남긴다.
    private static let userAgent: String = {
        let idiom = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        return "Prism (\(idiom))"
    }()

    private func perform(
        _ endpoint: APIEndpoint,
        body: Data?,
        accessToken: String?,
        background: Bool = false,
    ) async throws -> Data {
        // 토큰 없이 보낸 요청이나, 뒷일을 스스로 쥔 인증 자신의 호출은 손대지 않는다.
        // 표식은 **보내기 전에** 찍는다 — 응답이 돌아왔을 때 그사이 세션이 갈렸는지는
        // 이 값으로만 알 수 있다.
        var mark: Int?
        var accessToken = accessToken
        let authority = currentAuthority
        if endpoint.recoversSession, let token = accessToken, let authority {
            mark = authority.sessionMark(usedAccessToken: token)
            // 만료가 임박했으면 **보내기 전에** 회전한다. 반응형 경로와 같은 문을 쓰므로
            // 그사이 다른 요청이 이미 회전시켰다면 여기서는 아무 요청도 나가지 않는다.
            //
            // 실패해도 그대로 보낸다 — 정말 만료였다면 아래 catch가 받아 낸다.
            // 여기는 정확성이 아니라 최적화다.
            if let mark, authority.isNearExpiry() {
                if let rotated = await authority.refreshForRetry(
                    mark: mark, usedAccessToken: token,
                ) {
                    accessToken = rotated
                }
            }
        }

        do {
            return try await send(
                endpoint, body: body, accessToken: accessToken, background: background,
            )
        } catch let error as APIError {
            guard let authority, let mark, let accessToken else { throw error }

            // 갱신하면 살아나는 401인지는 **서버만** 안다 — 코드로 받아 본다.
            if error.isSessionExpired {
                guard let rotated = await authority.refreshForRetry(
                    mark: mark, usedAccessToken: accessToken,
                ) else { throw error }
                Log.network("session rotated — retrying \(endpoint.path) once")
                return try await sendOrEndSession(
                    endpoint, body: body, accessToken: rotated,
                    authority: authority, mark: mark, background: background,
                )
            }
            if error.isDefinitiveAuthFailure {
                await authority.endSession(mark: mark, usedAccessToken: accessToken)
            }
            throw error
        }
    }

    /// 재시도 한 번. 그 응답까지 확정 실패면 세션을 끝낸다 — 방금 회전한 토큰까지 거부됐다면
    /// 되살릴 수 있는 세션이 아니다.
    private func sendOrEndSession(
        _ endpoint: APIEndpoint,
        body: Data?,
        accessToken: String,
        authority: any SessionAuthority,
        mark: Int,
        background: Bool = false,
    ) async throws -> Data {
        do {
            return try await send(
                endpoint, body: body, accessToken: accessToken, background: background,
            )
        } catch let error as APIError where error.isDefinitiveAuthFailure {
            await authority.endSession(mark: mark, usedAccessToken: accessToken)
            throw error
        }
    }

    /// 한 번 보낸다. 재시도는 [perform]이 정하고 여기서는 하지 않는다.
    private func send(
        _ endpoint: APIEndpoint,
        body: Data?,
        accessToken: String?,
        background: Bool = false,
    ) async throws -> Data {
        var request = URLRequest(url: endpoint.url)
        request.httpMethod = endpoint.method
        request.setValue(NetworkManager.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(languageTag(), forHTTPHeaderField: "Accept-Language")
        // 소켓이 시킨 재조회만 표시를 달지 않는다 — 나머지는 사용자가 시킨 것이다.
        if !background {
            request.setValue("1", forHTTPHeaderField: NetworkManager.activityHeader)
        }
        request.httpBody = body
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if endpoint.requiresAuth, let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        Log.network("\(endpoint.method) \(endpoint.path)")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            // 취소는 실패가 아니다 — 화면에 오류로 띄우지 않도록 호출부가 구분할 수 있게 한다.
            throw CancellationError()
        } catch {
            // 오프라인·타임아웃·DNS 실패를 하나로 묶는다. 사용자가 할 수 있는 일이 같다.
            Log.network("\(endpoint.path) failed")
            throw APIError.network
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw errorOf(status: http.statusCode, data: data)
        }
        return data
    }

    /// 오류 응답에서 계약 코드를 꺼낸다. 코드가 없으면(프록시·게이트웨이가 만든 응답 등)
    /// 기본값으로 떨어뜨린다 — 상태 코드만으로도 화면은 일반 메시지를 그릴 수 있다.
    private func errorOf(status: Int, data: Data) -> APIError {
        let code = (try? decoder.decode(ErrorResponse.self, from: data))?.error
        Log.network("HTTP \(status) — \(code ?? "no error code")")
        return APIError(status: status, code: code ?? ClientErrorCode.requestFailed)
    }

    private func encode(_ body: some Encodable) throws -> Data {
        do {
            return try encoder.encode(body)
        } catch {
            // 우리가 만든 값을 우리가 못 싣는 상황이라 서버까지 갈 일이 아니다.
            Log.error("request encoding failed")
            throw APIError.invalidResponse
        }
    }

    private func decode<T: Decodable>(_ data: Data, as type: T.Type) throws -> T {
        do {
            return try decoder.decode(type, from: data)
        } catch {
            // 성공 응답인데 계약과 형식이 다르다 — 서버 배포가 앞서갔거나 계약 사본이 낡았다.
            Log.error("response did not match \(String(describing: type))")
            throw APIError.invalidResponse
        }
    }
}
