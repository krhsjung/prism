import { createHmac } from 'crypto';
import { PrismConfigService } from './config.service';

// TURN 자격증명은 **통화마다 새로 만들고 시한부다**(plan/webrtc.md §7).
//
// 정적 사용자명·비밀번호를 내려보내던 시절의 실패 모양이 이 파일의 존재 이유다:
// 통화를 한 번 성사시킨 사람이 그 값을 영구히 쥐고 릴레이를 마음대로 쓸 수 있었고,
// 세션을 폐기해도 로그아웃해도 그대로였다. 아래 세 가지가 그걸 막는다 —
// 공유 비밀은 나가지 않고, 사용자명에 만료가 실리고, 비밀번호가 그 사용자명에 묶인다.
describe('PrismConfigService.iceServersFor', () => {
  const env = { ...process.env };
  const secret = 'shared-turn-secret';

  beforeEach(() => {
    process.env.PRISM_TURN_URLS = 'turn:turn.example:3478';
    process.env.PRISM_TURN_SECRET = secret;
    delete process.env.PRISM_TURN_TTL;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  const turnOf = (servers: { urls: string[]; username?: string }[]) =>
    servers.find((server) => server.urls[0]?.startsWith('turn'));

  it('사용자명은 `<만료 unix>:<식별자>`이고 비밀번호는 그 HMAC이다', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const turn = turnOf(new PrismConfigService().iceServersFor('u-1', now));

    expect(turn?.username).toBe(`${now.getTime() / 1000 + 12 * 3600}:u-1`);
    expect(turn).toMatchObject({
      credential: createHmac('sha1', secret)
        .update(turn?.username ?? '')
        .digest('base64'),
    });
  });

  // 공유 비밀이 나가면 시한부로 만든 의미가 없다 — 그 값 하나로 아무 자격증명이나
  // 만들 수 있기 때문이다.
  it('공유 비밀 자체는 절대 내려가지 않는다', () => {
    const servers = new PrismConfigService().iceServersFor('u-1');
    expect(JSON.stringify(servers)).not.toContain(secret);
  });

  it('통화마다 다른 값이 나간다', () => {
    const config = new PrismConfigService();
    const first = turnOf(config.iceServersFor('u-1', new Date(1_000_000)));
    const later = turnOf(config.iceServersFor('u-1', new Date(2_000_000)));
    expect(first?.username).not.toBe(later?.username);
  });

  // coturn이 사용자명을 `:`로 쪼개 만료를 읽는다 — 식별자에 `:`가 섞이면 검증이 어긋난다.
  it('식별자의 `:`는 지운다 — 구분자를 흉내 낼 수 없다', () => {
    const turn = turnOf(new PrismConfigService().iceServersFor('u:1'));
    expect(turn?.username?.split(':')).toHaveLength(2);
  });

  it('TURN이 설정되지 않으면 STUN만 내려간다(자격증명 없음)', () => {
    delete process.env.PRISM_TURN_URLS;
    delete process.env.PRISM_TURN_SECRET;
    const servers = new PrismConfigService().iceServersFor('u-1');
    expect(servers).toHaveLength(1);
    expect(servers[0]?.username).toBeUndefined();
  });
});
