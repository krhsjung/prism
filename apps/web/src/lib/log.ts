// 개발 전용 구조화 로깅.
//
// 인증 흐름을 다루는 앱이라 "무엇을 남기지 않는가"가 규칙의 절반이다 — 토큰·쿠키·사용자
// 정보(User·displayName)·원시 경로·전체 URL·쿼리스트링은 인자로 넘기지 않는다
// (plan/auth.md §7). 여기 들어온 값은 콘솔에 평문으로 남는다고 보면 된다.
//
// **프로덕션 빌드에는 아무것도 남기지 않는다.** `import.meta.env.DEV`로 게이트해, 배포된
// 웹이 콘솔에 흐름/타이밍을 흘리지 않게 한다(포트폴리오 리뷰어의 활동이 로그로 재구성되지
// 않도록). 필드는 provider·outcome·status 같은 **안전한 원시값**만 담는다.
//
// iOS `Log`·Android `AppLog`와 같은 역할이며, 카테고리(auth/net/ui/error)도 맞춘다.

const enabled = import.meta.env.DEV;

/** 로그 필드 — 안전한 원시값만. id·토큰·PII는 절대 넣지 않는다(호출부 규칙). */
export type LogFields = Record<string, string | number | boolean>;

function emit(category: string, event: string, fields?: LogFields): void {
  if (!enabled) return;
  // 개발 전용 콘솔 — 프로덕션에서는 위 게이트로 도달하지 않는다.
  // eslint-disable-next-line no-console
  console.debug(`[prism:${category}] ${event}`, fields ?? {});
}

export const log = {
  auth: (event: string, fields?: LogFields) => emit('auth', event, fields),
  net: (event: string, fields?: LogFields) => emit('net', event, fields),
  ui: (event: string, fields?: LogFields) => emit('ui', event, fields),
  error: (event: string, fields?: LogFields) => {
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.error(`[prism:error] ${event}`, fields ?? {});
  },
};

/**
 * 경로를 **라우트 템플릿**으로 바꾼다 — 원시 경로에는 세션 id 같은 식별자가 섞일 수 있어
 * 그대로 남기지 않는다(`/auth/sessions/<id>/revoke` → `/auth/sessions/:id/revoke`).
 * 쿼리스트링(`?code=`·`?error=`)은 없는 경로만 들어오지만, 혹시 몰라 잘라 낸다.
 */
export function routeTemplate(path: string): string {
  const noQuery = path.split('?')[0] ?? path;
  return noQuery.replace(
    /\/auth\/sessions\/[^/]+\/revoke/,
    '/auth/sessions/:id/revoke',
  );
}
