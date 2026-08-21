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
final class NetworkManager: Sendable {
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

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
    ) async throws -> Response {
        let data = try await perform(endpoint, body: try encode(body), accessToken: accessToken)
        return try decode(data, as: Response.self)
    }

    /// body 없이 보내고 응답만 받는 요청.
    func send<Response: Decodable>(
        _ endpoint: APIEndpoint,
        accessToken: String? = nil,
    ) async throws -> Response {
        let data = try await perform(endpoint, body: nil, accessToken: accessToken)
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
    ) async throws -> Data {
        var request = URLRequest(url: endpoint.url)
        request.httpMethod = endpoint.method
        request.setValue(NetworkManager.userAgent, forHTTPHeaderField: "User-Agent")
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
