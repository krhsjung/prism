import { decodeObject, decodeString, jsonBodyOf } from '@app/common';
import type { KakaoOAuthOptions } from '@app/config';
import { fetchWithTimeout } from './fetch-with-timeout';
import type { OAuthClient } from './oauth-client';
import type { OAuthProfile } from './oauth-profile';

const KAKAO_AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';
const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const KAKAO_USER_URL = 'https://kapi.kakao.com/v2/user/me';
const KAKAO_TOKEN_INFO_URL = 'https://kapi.kakao.com/v1/user/access_token_info';

// Kakao 토큰 응답에서 실제로 쓰는 필드만(access_token). 나머지는 무시한다.
interface KakaoTokenResponse {
  access_token: string;
}

// Kakao 사용자 응답. id가 안정적 식별자(sub)이며 숫자로 온다 — 문자열로 정규화한다.
// 표시 이름은 properties.nickname에 있을 수 있으나 동의 항목이라 없을 수 있다.
interface KakaoUserInfo {
  sub: string;
  nickname?: string;
}

// Kakao OAuth 2.0 authorization-code 흐름(웹 redirect).
// Google과 같은 code→access_token 교환 후 user/me로 프로필을 조회하는 구조지만,
// 토큰 교환이 x-www-form-urlencoded POST라 별도 클라이언트로 둔다.
export class KakaoOAuthClient implements OAuthClient {
  constructor(private readonly options: KakaoOAuthOptions) {}

  // 사용자를 Kakao 로그인 페이지로 보낼 authorization URL. state는 CSRF 방어용.
  generateAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      state,
      // 이전에 로그인한 계정을 조용히 재선택하지 않고 매번 계정 선택을 띄운다
      // (Google의 prompt=select_account와 같은 의도).
      prompt: 'select_account',
    });
    return `${KAKAO_AUTHORIZE_URL}?${params.toString()}`;
  }

  // authorization code → access_token 교환 → user/me 조회 → 프로필 추출.
  // 저장은 sub(=user id)만, 이름은 세션 표시용으로만 쓴다(PII 미저장).
  async exchangeCode(code: string): Promise<OAuthProfile> {
    const token = await this.fetchToken(code);
    const info = await this.fetchUserInfo(token.access_token);
    return { sub: info.sub, displayName: info.nickname };
  }

  // 네이티브 SDK(kakao_flutter_sdk 등)가 받은 access token을 직접 검증한다.
  // Google/Apple의 id_token(JWS 서명)과 달리 Kakao access token은 불투명(opaque) 문자열이라
  // 로컬 서명 검증이 없다 — 대신 access_token_info로 이 토큰이 **우리 앱** 발급인지
  // (app_id 대조) 확인하고, 그 뒤 user/me로 프로필을 읽는다. app_id 대조가 다른 앱에
  // 발급된 토큰의 재사용을 막는 유일한 방어라, appId 미설정 시 네이티브 경로를 막는다.
  async verifyAccessToken(accessToken: string): Promise<OAuthProfile> {
    const token = accessToken?.trim();
    if (!token) {
      throw new Error('Kakao accessToken is required');
    }
    if (!this.options.appId) {
      throw new Error(
        'Kakao native login requires PRISM_KAKAO_APP_ID to be configured',
      );
    }
    await this.assertTokenAppId(token, this.options.appId);
    const info = await this.fetchUserInfo(token);
    return { sub: info.sub, displayName: info.nickname };
  }

  // access_token_info로 토큰의 발급 앱(app_id)이 우리 앱과 일치하는지 확인한다.
  // 만료·무효 토큰은 여기서 non-2xx로 걸러진다(user/me까지 가지 않는다).
  private async assertTokenAppId(
    accessToken: string,
    expectedAppId: string,
  ): Promise<void> {
    const res = await fetchWithTimeout(KAKAO_TOKEN_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Kakao access_token_info failed (${res.status})`);
    }
    const obj = decodeObject(await jsonBodyOf(res), 'Kakao access_token_info');
    if (
      typeof obj.app_id !== 'number' ||
      String(obj.app_id) !== expectedAppId
    ) {
      throw new Error('Kakao access token app_id mismatch');
    }
  }

  private async fetchToken(code: string): Promise<KakaoTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      code,
    });
    // client secret은 콘솔에서 켠 경우에만 붙인다(꺼져 있으면 빈 문자열).
    if (this.options.clientSecret) {
      body.set('client_secret', this.options.clientSecret);
    }

    const res = await fetchWithTimeout(KAKAO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Kakao token exchange failed (${res.status})`);
    }
    const obj = decodeObject(await jsonBodyOf(res), 'Kakao token');
    return {
      access_token: decodeString(obj.access_token, 'Kakao token.access_token'),
    };
  }

  // 외부 응답은 단언 없이 경계에서 디코딩한다(형식이 어긋나면 여기서 throw).
  // id는 숫자로 오므로 문자열로 정규화하고, nickname은 있을 때만 채운다.
  private async fetchUserInfo(accessToken: string): Promise<KakaoUserInfo> {
    const res = await fetchWithTimeout(KAKAO_USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Kakao user/me failed (${res.status})`);
    }
    const obj = decodeObject(await jsonBodyOf(res), 'Kakao user/me');
    // id는 숫자로 온다 — 문자열 sub로 정규화하되, 부재/형식 오류는 여기서 걸러낸다
    // ("undefined" 문자열이 유효한 식별자로 새는 것을 막는다).
    if (typeof obj.id !== 'number' || !Number.isFinite(obj.id)) {
      throw new Error('Kakao user/me.id: expected number');
    }
    const props =
      typeof obj.properties === 'object' &&
      obj.properties !== null &&
      !Array.isArray(obj.properties)
        ? obj.properties
        : {};
    return {
      sub: String(obj.id),
      nickname: typeof props.nickname === 'string' ? props.nickname : undefined,
    };
  }
}
