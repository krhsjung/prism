// 외부 IdP(Google/Apple)로 나가는 모든 fetch의 공통 데드라인.
// 상대가 응답을 안 주면 요청이 무한 대기로 쌓이므로 AbortSignal로 상한을 강제한다.
// (AbortSignal.timeout은 응답 본문 스트리밍까지 포함해 중단한다)
const DEFAULT_TIMEOUT_MS = 10_000;

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
