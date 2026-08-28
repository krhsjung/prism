import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { AuthSession } from '@app/common';
import { REDIS, type RedisClient } from '@app/redis';

// 네이티브 웹-redirect 로그인의 **일회용 인가 코드** 저장소.
//
// flow=native 콜백은 세션을 발급한 뒤, 토큰을 URL에 싣지 않고(로그·유출 위험) 짧은 수명의
// 코드만 커스텀 스킴으로 앱에 돌려준다. 앱은 그 코드를 POST /auth/native/exchange로 보내
// 토큰(AuthSession)을 받는다 — OAuth authorization-code 교환과 같은 모양이다.
//
// 두 성질이 본질이다:
//  - 짧은 수명: 콜백 직후 교환에 쓰이고 끝나므로 2분이면 충분하다(캡처돼도 곧 만료).
//  - 1회용: 소비는 GETDEL로 **원자적**이라, 같은 코드를 두 번 교환할 수 없다.
@Injectable()
export class NativeAuthCodeStore {
  // 코드는 콜백→교환 사이 아주 짧게만 산다.
  private static readonly TTL_SECONDS = 120;

  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  // 세션에 대한 일회용 코드를 만들어 저장하고 그 코드를 돌려준다.
  async issue(session: AuthSession): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    await this.redis.setEx(
      this.key(code),
      JSON.stringify(session),
      NativeAuthCodeStore.TTL_SECONDS,
    );
    return code;
  }

  // 코드를 소비(원자적 GETDEL)하고 세션을 돌려준다. 없거나 이미 쓰였으면 null.
  async redeem(code: string): Promise<AuthSession | null> {
    if (!code) return null;
    const raw = await this.redis.getDel(this.key(code));
    if (raw === null) return null;
    return this.parse(raw);
  }

  // 앱 Redis 유저의 ACL은 키를 prism:* 로 제한한다 — 세션 저장소와 같은 프리픽스를 쓴다.
  private key(code: string): string {
    return `prism:native_auth_code:${code}`;
  }

  // 우리가 저장한 값이지만, 저장소가 예기치 않은 값을 주면 세션으로 오인하지 않도록
  // 최소 형태(토큰·사용자)만 확인한다.
  //
  // `JSON.parse`는 any를 주므로 **받는 자리에서** 형태를 정해 좁힌다(프로젝트 방침:
  // unknown/any 키워드 대신 구체 타입 + `as object as`). 필드가 전부 optional이라
  // 아래 확인을 통과하기 전까지는 무엇도 있다고 가정하지 않는다.
  private parse(raw: string): AuthSession | null {
    type Stored = {
      accessToken?: string;
      refreshToken?: string;
      user?: AuthSession['user'];
    };
    try {
      const v = JSON.parse(raw) as object as Stored | null;
      if (
        v !== null &&
        typeof v.accessToken === 'string' &&
        typeof v.refreshToken === 'string' &&
        v.user !== undefined
      ) {
        return v as object as AuthSession;
      }
    } catch {
      /* 손상된 값 — 아래에서 null */
    }
    return null;
  }
}
