import type { SocialProvider } from '@app/common';
import type { OAuthProfile } from './oauth-profile';

// 소셜 provider 공통 계약(웹 redirect 흐름) — 시작 URL 발급 + code 교환.
// 새 provider 추가 = ① 이 인터페이스 구현 ② auth.module의 OAUTH_CLIENTS 레지스트리 등록.
// (콜백 라우트는 provider별 프로토콜이 달라 — Google=GET 쿼리, Apple=form_post POST — 통합하지 않는다)
export interface OAuthClient {
  generateAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<OAuthProfile>;
}

// DI 토큰: provider → 클라이언트 레지스트리.
export const OAUTH_CLIENTS = Symbol('OAUTH_CLIENTS');
export type OAuthClientRegistry = ReadonlyMap<SocialProvider, OAuthClient>;
