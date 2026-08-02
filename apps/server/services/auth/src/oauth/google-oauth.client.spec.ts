import { GoogleOAuthClient } from './google-oauth.client';

// generateAuthUrl은 순수 URL 조립이라 네트워크 없이 검증한다.
describe('GoogleOAuthClient', () => {
  const client = new GoogleOAuthClient({
    clientId: 'client-id-1',
    clientSecret: 'client-secret-1',
    redirectUri: 'https://example.test/auth/google/callback',
  });

  const paramsOf = (state: string): URLSearchParams =>
    new URL(client.generateAuthUrl(state)).searchParams;

  it('authorization URL에 인증에 필요한 파라미터가 담긴다', () => {
    const url = new URL(client.generateAuthUrl('state-1'));

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('client_id')).toBe('client-id-1');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://example.test/auth/google/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('email profile');
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  // refresh token을 쓰지 않으므로 offline 접근을 요구하지 않는다.
  it('online 접근으로 요청한다', () => {
    expect(paramsOf('s').get('access_type')).toBe('online');
  });

  // 회귀 방지: 로그아웃해도 브라우저의 Google 세션은 남아, 이 값이 없으면
  // Google이 직전 계정을 조용히 재선택(prompt=none)해 계정 전환이 불가능해진다.
  it('매번 계정 선택 화면을 요구한다', () => {
    expect(paramsOf('s').get('prompt')).toBe('select_account');
  });

  it('state는 그대로 전달된다(서명된 값이 훼손되지 않아야 한다)', () => {
    const state = 'eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJvYXV0aF9zdGF0ZSJ9.sig-abc';
    expect(paramsOf(state).get('state')).toBe(state);
  });
});
