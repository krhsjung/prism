package kr.hs.jung.prism.feature.auth

import kr.hs.jung.prism.domain.model.AuthProvider

/**
 * 소셜 로그인 **방식** — 같은 provider라도 앱은 두 경로로 로그인할 수 있다(iOS와 동일).
 *  - NATIVE: provider 네이티브 SDK로 앱 안에서 토큰을 받는다(Google/Kakao).
 *  - REDIRECT: 시스템 브라우저 탭(Custom Tabs)으로 서버 웹 OAuth(flow=native)를 열고
 *    콜백의 일회용 코드를 토큰과 교환한다. 네이티브 SDK가 없는 provider(Apple)도 이 경로로는
 *    로그인할 수 있다.
 */
enum class AuthMethod { NATIVE, REDIRECT }

/**
 * 로그인 버튼 하나의 정체 — provider와 방식의 조합. 같은 provider가 두 방식으로 두 번
 * 나오므로, 어느 버튼이 눌렸는지(진행 중인지)를 이걸로 구분한다.
 */
data class AuthOption(val provider: AuthProvider, val method: AuthMethod)
