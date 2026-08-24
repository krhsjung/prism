import { authorizeUpgrade } from './upgrade';

// 허용 목록은 설정이 쥔다(PrismConfigService.isAllowedOrigin) — 여기서는 그 판단을 주입한다.
const allow = (origin: string) => origin === 'https://prism.example';

describe('authorizeUpgrade', () => {
  it('우리 경로 + 허용된 Origin이면 통과한다', () => {
    expect(
      authorizeUpgrade('/socket', { origin: 'https://prism.example' }, allow),
    ).toEqual({ allow: true });
  });

  it('쿼리스트링이 붙어도 경로로만 판단한다', () => {
    expect(authorizeUpgrade('/socket?v=1', {}, allow)).toEqual({ allow: true });
  });

  // 이 http.Server는 /healthz와 공유된다 — 우리 것이 아닌 업그레이드는 받지 않는다.
  it('다른 경로의 업그레이드는 404로 거절한다', () => {
    expect(authorizeUpgrade('/healthz', {}, allow)).toMatchObject({
      allow: false,
      status: 404,
    });
    expect(authorizeUpgrade(undefined, {}, allow)).toMatchObject({
      allow: false,
      status: 404,
    });
  });

  // 형제 서브도메인은 우리와 same-site라 __Host- 쿠키를 싣고 온다.
  // WebSocket은 CORS의 보호를 받지 않으므로 여기서 막지 않으면 아무도 못 막는다.
  it('허용되지 않은 Origin은 403으로 거절한다', () => {
    expect(
      authorizeUpgrade('/socket', { origin: 'https://evil.example' }, allow),
    ).toMatchObject({ allow: false, status: 403 });
  });

  // Origin이 없으면 브라우저가 아니다(네이티브·CLI). ambient 쿠키의 주체가 아니라
  // Bearer로 스스로 인증하므로 CSRF 대상이 아니다 — 인증은 101 이후에 따로 한다.
  it('Origin이 없는 네이티브 연결은 통과시킨다', () => {
    expect(authorizeUpgrade('/socket', {}, allow)).toEqual({ allow: true });
    expect(authorizeUpgrade('/socket', { origin: '' }, allow)).toEqual({
      allow: true,
    });
  });
});
