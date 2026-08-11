import { KakaoOAuthClient } from './kakao-oauth.client';

// generateAuthUrl은 순수 URL 조립이라 네트워크 없이 검증한다.
describe('KakaoOAuthClient', () => {
  const client = new KakaoOAuthClient({
    clientId: 'rest-api-key-1',
    clientSecret: '',
    redirectUri: 'https://example.test/auth/kakao/callback',
  });

  const paramsOf = (state: string): URLSearchParams =>
    new URL(client.generateAuthUrl(state)).searchParams;

  it('authorization URL에 인증에 필요한 파라미터가 담긴다', () => {
    const url = new URL(client.generateAuthUrl('state-1'));

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://kauth.kakao.com/oauth/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('rest-api-key-1');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://example.test/auth/kakao/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  // Google과 동일한 의도: 직전 계정을 조용히 재선택하지 않고 매번 선택을 띄운다.
  it('매번 계정 선택 화면을 요구한다', () => {
    expect(paramsOf('s').get('prompt')).toBe('select_account');
  });

  it('state는 그대로 전달된다(서명된 값이 훼손되지 않아야 한다)', () => {
    const state = 'eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJvYXV0aF9zdGF0ZSJ9.sig-abc';
    expect(paramsOf(state).get('state')).toBe(state);
  });
});
