import type { CookiePolicy } from '@app/session';
import { oauthNonceCookieName, oauthNonceCookieOptions } from './oauth-cookie';

const PROD: CookiePolicy = { isProduction: true, namespace: '' };
const LOCAL: CookiePolicy = { isProduction: false, namespace: '' };

// OAuth 흐름 nonce 쿠키도 세션 쿠키와 같은 이유로 접두어가 필요하다 —
// 이쪽이 뚫리면 세션 쿠키를 __Host-로 바꿔도 login-CSRF가 되살아난다.
describe('oauth nonce cookie', () => {
  it('운영에서는 __Host- 접두어를 붙인다', () => {
    expect(oauthNonceCookieName('n-1', PROD)).toBe('__Host-prism_oauth_n-1');
  });

  it('로컬에서는 접두어 없는 이름을 쓴다', () => {
    expect(oauthNonceCookieName('n-1', LOCAL)).toBe('prism_oauth_n-1');
  });

  // 흐름마다 이름이 갈려야 병행 탭이 서로를 소진하지 않는다.
  it('nonce가 다르면 쿠키 이름도 다르다', () => {
    expect(oauthNonceCookieName('a', PROD)).not.toBe(
      oauthNonceCookieName('b', PROD),
    );
  });

  // __Host-는 Path=/를 강제하므로 운영에서 Path=/auth를 쓸 수 없다.
  // Apple form_post(교차 사이트 POST)에는 SameSite=None이 필요하고 None은 Secure를 요구한다.
  it('운영 옵션이 __Host- 요건과 Apple form_post 요구를 함께 만족한다', () => {
    const options = oauthNonceCookieOptions(true);
    expect(options.secure).toBe(true);
    expect(options.path).toBe('/');
    expect(options.domain).toBeUndefined();
    expect(options.sameSite).toBe('none');
    expect(options.httpOnly).toBe(true);
  });

  // 로컬은 http라 Secure 쿠키가 저장되지 않으므로 None을 쓸 수 없다.
  it('로컬 옵션은 Lax + Path=/auth를 유지한다', () => {
    const options = oauthNonceCookieOptions(false);
    expect(options.secure).toBeUndefined();
    expect(options.path).toBe('/auth');
    expect(options.sameSite).toBe('lax');
  });
});
