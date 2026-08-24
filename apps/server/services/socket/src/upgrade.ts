import { SOCKET_PATH } from '@app/common';

// 업그레이드를 받아들일지 **101 이전에** 정한다.
//
// 순수 함수인 이유는 이것이 이 서비스에서 보안상 가장 중요한 판단이고, 서버를 띄우지
// 않고 못 박아 두고 싶기 때문이다(services/auth의 device.ts와 같은 결).
export type UpgradeDecision =
  | { allow: true }
  // 거절은 HTTP 상태로 답한다 — 소켓을 일단 받아 놓고 close 코드로 끊는 것보다
  // 진단이 쉽고(curl·접근 로그에 그대로 남는다), 허용되지 않은 출처와 101을 주고받는
  // 일 자체가 없어진다.
  | { allow: false; status: 403 | 404; reason: string };

export interface UpgradeHeaders {
  origin?: string;
}

// WebSocket은 **CORS의 보호를 받지 않는다.** 브라우저는 교차 출처 핸드셰이크를 그냥
// 성사시키고 소켓을 그 페이지에 넘긴다 — 거절할 수 있는 것은 서버뿐이다.
//
// SameSite도 여기서는 못 막는다. 우리 도메인의 등록 가능 도메인이 Public Suffix List에
// 없어서 형제 서브도메인이 전부 우리와 same-site이고(웹 쿠키 정책 주석 참고),
// 그들의 wss:// 핸드셰이크는 __Host- 세션 쿠키를 **싣고 온다**.
// 그래서 HTTP 상태 변경에 WebOriginGuard가 하는 일을 여기서 똑같이 한다.
export function authorizeUpgrade(
  url: string | undefined,
  headers: UpgradeHeaders,
  isAllowedOrigin: (origin: string) => boolean,
): UpgradeDecision {
  // 이 http.Server는 /healthz와 공유된다 — 우리 경로가 아닌 업그레이드는 우리 것이 아니다.
  // 쿼리스트링은 떼고 본다(경로만이 판단 대상이다).
  const path = (url ?? '').split('?')[0];
  if (path !== SOCKET_PATH) {
    return { allow: false, status: 404, reason: 'path' };
  }

  const origin = headers.origin;
  // Origin이 없는 것은 브라우저가 아니라는 뜻이다(네이티브 앱·CLI).
  // 그쪽은 ambient 쿠키를 싣는 주체가 아니라 Bearer로 스스로 인증하므로 CSRF 대상이 아니다.
  if (origin === undefined || origin === '') return { allow: true };

  if (!isAllowedOrigin(origin)) {
    return { allow: false, status: 403, reason: 'origin' };
  }
  return { allow: true };
}
