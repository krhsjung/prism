import type { AuthSession } from '@app/common';
import type { RedisClient } from '@app/redis';
import { NativeAuthCodeStore } from './native-auth-code.service';

// 일회용 코드의 핵심 성질(발급→소비, 1회용, 손상값 방어)을 인메모리 fake로 결정적으로 본다.
describe('NativeAuthCodeStore', () => {
  const session: AuthSession = {
    accessToken: 'access-1',
    refreshToken: 'sess-1.secret-1',
    user: {
      id: 'u-1',
      provider: 'google',
      displayName: 'Alice',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };

  function fakeRedis() {
    const map = new Map<string, string>();
    const client = {
      setEx: (k: string, v: string) => {
        map.set(k, v);
        return Promise.resolve();
      },
      // GETDEL 시맨틱: 읽으면서 원자적으로 지운다.
      getDel: (k: string) => {
        const v = map.get(k) ?? null;
        map.delete(k);
        return Promise.resolve(v);
      },
    } as object as RedisClient;
    return { map, client };
  }

  it('issue한 코드로 redeem하면 세션을 돌려주고, 두 번째 redeem은 null(1회용)', async () => {
    const store = new NativeAuthCodeStore(fakeRedis().client);
    const code = await store.issue(session);

    await expect(store.redeem(code)).resolves.toEqual(session);
    // GETDEL로 이미 소진됐다 — 같은 코드는 두 번 통하지 않는다.
    await expect(store.redeem(code)).resolves.toBeNull();
  });

  it('없는 코드는 null', async () => {
    const store = new NativeAuthCodeStore(fakeRedis().client);
    await expect(store.redeem('does-not-exist')).resolves.toBeNull();
    await expect(store.redeem('')).resolves.toBeNull();
  });

  it('손상된 값은 세션으로 오인하지 않고 null', async () => {
    const { map, client } = fakeRedis();
    const store = new NativeAuthCodeStore(client);
    // 토큰이 문자열이 아닌 등 형태가 어긋난 값.
    map.set('prism:native_auth_code:bad', JSON.stringify({ accessToken: 123 }));
    await expect(store.redeem('bad')).resolves.toBeNull();
  });
});
