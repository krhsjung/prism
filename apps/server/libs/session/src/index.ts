// @app/session — 세션 인증의 공유 계층.
//
// auth 서비스가 세션을 **발급**하고, 모든 서비스가 그 세션을 **검증**한다.
// 검증 로직(토큰 서명 규칙 · 쿠키 이름 · 가드)이 서비스마다 따로 있으면 인증의 원천이
// 둘이 되고, 한쪽만 고쳐지는 순간 구멍이 된다 — 그래서 여기 한 곳에 둔다.
// (OAuth 흐름처럼 auth 서비스에만 있는 것은 services/auth에 남는다)
export * from './session-cookie';
export * from './session-token.service';
export * from './jwt-auth.guard';
export * from './public.decorator';
export * from './session.module';
