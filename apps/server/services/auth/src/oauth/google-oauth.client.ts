import { OAuth2Client } from 'google-auth-library';
import { decodeObject, decodeString, jsonBodyOf } from '@app/common';
import type { GoogleOAuthOptions } from '@app/config';
import { fetchWithTimeout } from './fetch-with-timeout';
import type { OAuthClient } from './oauth-client';
import type { OAuthProfile } from './oauth-profile';

const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Google OAuth2 userinfo 응답에서 실제로 쓰는 필드만. id가 안정적 식별자(sub).
interface GoogleUserInfo {
  id: string;
  name?: string;
}

// Google OAuth 2.0 authorization-code 흐름(웹 redirect).
// example-nestjs와 동일하게 code→access_token 교환 후 userinfo로 사용자를 조회한다.
export class GoogleOAuthClient implements OAuthClient {
  private readonly client: OAuth2Client;

  constructor(private readonly options: GoogleOAuthOptions) {
    this.client = new OAuth2Client({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectUri: options.redirectUri,
    });
  }

  // 사용자를 Google 로그인 페이지로 보낼 authorization URL. state는 CSRF 방어용.
  generateAuthUrl(state: string): string {
    return this.client.generateAuthUrl({
      scope: ['email', 'profile'],
      state,
      response_type: 'code',
      // refresh token을 쓰지 않으므로 online 접근으로 둔다.
      access_type: 'online',
      // 로그아웃은 우리 토큰만 폐기할 뿐 브라우저의 Google 세션은 남는다 —
      // 지정하지 않으면 Google이 직전 계정을 조용히 재선택(prompt=none)해
      // 다른 계정으로 로그인할 방법이 없어진다. 매번 계정 선택 화면을 띄운다.
      prompt: 'select_account',
    });
  }

  // authorization code → access_token 교환 → userinfo 조회 → 프로필 추출.
  // 저장은 sub(=userinfo.id)만, 이름은 세션 표시용으로만 쓴다(PII 미저장).
  async exchangeCode(code: string): Promise<OAuthProfile> {
    const { tokens } = await this.client.getToken(code);
    if (!tokens.access_token) {
      throw new Error('Google token response missing access_token');
    }

    const info = await this.fetchUserInfo(tokens.access_token);
    return { sub: info.id, displayName: info.name };
  }

  // 외부 응답은 단언 없이 경계에서 디코딩한다(형식이 어긋나면 여기서 throw).
  private async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const res = await fetchWithTimeout(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Google userinfo failed (${res.status})`);
    }
    const obj = decodeObject(await jsonBodyOf(res), 'Google userinfo');
    return {
      id: decodeString(obj.id, 'Google userinfo.id'),
      name: typeof obj.name === 'string' ? obj.name : undefined,
    };
  }
}
