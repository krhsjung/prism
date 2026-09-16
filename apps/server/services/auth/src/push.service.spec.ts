import type { SessionsRepository } from '@app/common';
import type { PrismConfigService } from '@app/config';
import type { PushSender } from '@app/push';
import { PushNotificationService, PushUnavailableError } from './push.service';

// 클라이언트는 **"이 세션들에 보내줘"라고만 한다** — 토큰은 서버가 레코드에서 꺼낸다
// (plan/push.md §5-3). 이 스위트가 보는 것은 그 규칙과, 대상마다 답을 따로 준다는 것,
// 그리고 같은 설치에 두 번 보내지 않는다는 것이다(§5-5).
describe('PushNotificationService', () => {
  const content = { message: 'hello', actions: 'none' as const };

  // 세션 → 조회 결과. `s-mac`과 `s-mac-old`는 **같은 토큰**을 갖는다(재로그인).
  const lookups: {
    [id: string]: Awaited<ReturnType<SessionsRepository['pushTargetFor']>>;
  } = {
    's-mac': { kind: 'ok', target: { token: 'tok-mac', locale: 'ko' } },
    's-mac-old': { kind: 'ok', target: { token: 'tok-mac', locale: 'ko' } },
    's-phone': { kind: 'ok', target: { token: 'tok-phone', locale: 'en' } },
    's-plain': { kind: 'no-token' },
    's-stranger': { kind: 'not-owned' },
  };

  // 전송기가 받는 인자 한 줄. `unknown` 없이 mock 호출을 읽으려고 타입을 세워 둔다.
  type SendCall = [
    token: string,
    text: { title: string; body: string },
    payload: {
      kind: string;
      imageUrl?: string;
      link?: string;
      actions?: string;
    },
    webLink: string,
  ];
  type Outcome = 'accepted' | 'rejected' | 'failed';

  const make = (
    outcome: Outcome | ((token: string) => Outcome) = 'accepted',
    enabled = true,
  ) => {
    const send = jest.fn<Promise<Outcome>, SendCall>((token) =>
      Promise.resolve(typeof outcome === 'function' ? outcome(token) : outcome),
    );
    const clearPushTokenIfMatches = jest.fn(() => Promise.resolve(true));
    const service = new PushNotificationService(
      {
        pushTargetFor: jest.fn((_userId: string, id: string) =>
          Promise.resolve(lookups[id] ?? { kind: 'not-owned' }),
        ),
        clearPushTokenIfMatches,
      } as object as SessionsRepository,
      { send, enabled } as object as PushSender,
      { webAppUrl: 'https://prism.example' } as object as PrismConfigService,
    );
    return { service, send, clearPushTokenIfMatches };
  };

  it('고른 대상마다 결과를 따로 답한다', async () => {
    const { service } = make();

    await expect(
      service.sendToSessions(
        'u-1',
        ['s-mac', 's-plain', 's-stranger'],
        content,
      ),
    ).resolves.toEqual([
      { sessionId: 's-mac', result: 'accepted' },
      { sessionId: 's-plain', result: 'no-token' },
      // 없는 세션과 남의 세션을 **구별해 주지 않는다**.
      { sessionId: 's-stranger', result: 'unknown' },
    ]);
  });

  // 한 대상이 실패해도 나머지는 간다 — 요청 전체를 접으면 "하나가 방금 로그아웃해서
  // 아무에게도 안 갔다"가 된다.
  it('닿지 않는 대상이 섞여도 나머지는 보낸다', async () => {
    const { service, send } = make();

    await service.sendToSessions('u-1', ['s-stranger', 's-phone'], content);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe('tok-phone');
  });

  // **§5-5의 첫 소비자다.** 같은 설치가 여러 세션에 걸리면(로그아웃 후 재로그인)
  // 세션마다 보낼 때 한 기기에 알림이 두 번 뜬다.
  it('같은 토큰에는 한 번만 보내고 나머지는 duplicate다', async () => {
    const { service, send } = make();

    const results = await service.sendToSessions(
      'u-1',
      ['s-mac', 's-mac-old', 's-phone'],
      content,
    );

    expect(results).toEqual([
      { sessionId: 's-mac', result: 'accepted' },
      { sessionId: 's-mac-old', result: 'duplicate' },
      { sessionId: 's-phone', result: 'accepted' },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  // `duplicate`는 "다른 세션이 이미 받았다"는 뜻이다 — 첫 시도가 거부됐다면 아무도
  // 받지 않았으므로, 같은 토큰의 세션 전부가 그 결과를 받는다.
  it('첫 시도가 거부되면 같은 토큰의 세션 전부가 rejected다', async () => {
    const { service } = make((token) =>
      token === 'tok-mac' ? 'rejected' : 'accepted',
    );

    await expect(
      service.sendToSessions('u-1', ['s-mac', 's-mac-old', 's-phone'], content),
    ).resolves.toEqual([
      { sessionId: 's-mac', result: 'rejected' },
      { sessionId: 's-mac-old', result: 'rejected' },
      { sessionId: 's-phone', result: 'accepted' },
    ]);
  });

  it('제목은 세션의 언어로, 본문은 사람이 적은 그대로 간다', async () => {
    const { service, send } = make();

    await service.sendToSessions('u-1', ['s-mac', 's-phone'], content);

    const texts = send.mock.calls.map(
      (call) =>
        (call as object as [string, { title: string; body: string }])[1],
    );
    const [koText, enText] = texts;
    expect(koText).toEqual({ title: '테스트 푸시', body: 'hello' });
    expect(enText).toEqual({ title: 'Test push', body: 'hello' });
  });

  // 사람이 적은 제목은 번역할 수 없다 — 본문과 같은 성질이라 언어와 무관하게 그대로 간다.
  it('제목을 적어 보내면 언어와 무관하게 그 글자가 간다', async () => {
    const { service, send } = make();

    await service.sendToSessions('u-1', ['s-mac', 's-phone'], {
      ...content,
      title: '배포 알림',
    });

    const texts = send.mock.calls.map(
      (call) =>
        (call as object as [string, { title: string; body: string }])[1],
    );
    expect(texts.map((t) => t.title)).toEqual(['배포 알림', '배포 알림']);
  });

  it('이미지·링크·버튼을 페이로드로 넘긴다', async () => {
    const { service, send } = make();

    await service.sendToSessions('u-1', ['s-mac'], {
      message: 'hi',
      imageUrl: 'https://cdn.example/cat.png',
      link: 'https://example.com/thing',
      actions: 'open-dismiss',
    });

    const [, , payload, webLink] = send.mock.calls[0] ?? [];
    expect(payload).toEqual({
      kind: 'demo',
      imageUrl: 'https://cdn.example/cat.png',
      link: 'https://example.com/thing',
      actions: 'open-dismiss',
    });
    // 링크가 있으면 웹의 기본 주소 자리도 그것이 차지한다.
    expect(webLink).toBe('https://example.com/thing');
  });

  it('링크가 없으면 푸시 화면으로 돌아오게 한다', async () => {
    const { service, send } = make();

    await service.sendToSessions('u-1', ['s-mac'], content);

    expect(send.mock.calls[0]?.[3]).toBe('https://prism.example/push');
  });

  // 죽은 토큰은 계약의 결과이고, **세션에서 뗀다** — 두면 목록이 계속 `Will notify`를
  // 그리고 다음 발송도 같은 토큰을 겨눈다. 같은 토큰의 세션 전부가 대상이다.
  it('토큰이 거부되면 그 줄만 rejected이고 세션에서 토큰을 뗀다', async () => {
    const { service, clearPushTokenIfMatches } = make('rejected');

    await expect(
      service.sendToSessions('u-1', ['s-mac', 's-mac-old'], content),
    ).resolves.toEqual([
      { sessionId: 's-mac', result: 'rejected' },
      { sessionId: 's-mac-old', result: 'rejected' },
    ]);
    expect(clearPushTokenIfMatches.mock.calls).toEqual([
      ['u-1', 's-mac', 'tok-mac'],
      ['u-1', 's-mac-old', 'tok-mac'],
    ]);
  });

  // 떼기의 실패가 요청 전체를 접으면 이미 접수된 대상의 결과까지 잃고, 다시 누르면
  // 그쪽에 알림이 두 번 간다.
  it('토큰을 떼지 못해도 결과는 그대로 돌아간다', async () => {
    const { service, clearPushTokenIfMatches } = make((token) =>
      token === 'tok-mac' ? 'rejected' : 'accepted',
    );
    clearPushTokenIfMatches.mockRejectedValue(new Error('redis down'));

    await expect(
      service.sendToSessions('u-1', ['s-mac', 's-phone'], content),
    ).resolves.toEqual([
      { sessionId: 's-mac', result: 'rejected' },
      { sessionId: 's-phone', result: 'accepted' },
    ]);
  });

  it('접수된 토큰은 떼지 않는다', async () => {
    const { service, clearPushTokenIfMatches } = make();

    await service.sendToSessions('u-1', ['s-mac'], content);

    expect(clearPushTokenIfMatches).not.toHaveBeenCalled();
  });

  // FCM의 일시적 실패는 **그 줄의** 결과다. 요청 전체를 접으면 이미 접수된 나머지의
  // 결과를 지우고, 다시 누르면 그쪽에 알림이 두 번 간다.
  it('FCM이 한 대상에 실패해도 나머지 결과는 그대로 돌아간다', async () => {
    const { service, clearPushTokenIfMatches } = make((token) =>
      token === 'tok-mac' ? 'failed' : 'accepted',
    );

    await expect(
      service.sendToSessions('u-1', ['s-mac', 's-phone'], content),
    ).resolves.toEqual([
      { sessionId: 's-mac', result: 'failed' },
      { sessionId: 's-phone', result: 'accepted' },
    ]);
    // 실패는 토큰이 죽었다는 뜻이 아니다 — 떼지 않는다.
    expect(clearPushTokenIfMatches).not.toHaveBeenCalled();
  });

  // 대상을 하나씩 기다리면 대상 수만큼 FCM 왕복이 이어져 클라이언트의 요청 타임아웃을
  // 넘긴다 — 전부 해석한 뒤 한꺼번에 보낸다.
  it('대상들에 한꺼번에 보낸다', async () => {
    let inFlight = 0;
    let peak = 0;
    const send = jest.fn<Promise<Outcome>, SendCall>(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return 'accepted';
    });
    const service = new PushNotificationService(
      {
        pushTargetFor: jest.fn((_userId: string, id: string) =>
          Promise.resolve(lookups[id] ?? { kind: 'not-owned' }),
        ),
      } as object as SessionsRepository,
      { send, enabled: true } as object as PushSender,
      { webAppUrl: 'https://prism.example' } as object as PrismConfigService,
    );

    await service.sendToSessions('u-1', ['s-mac', 's-phone'], content);

    expect(peak).toBe(2);
  });

  // 전송기가 없는 것은 대상별 결과가 아니라 요청의 오류다 — 호출부가 502로 접는다.
  it('전송기가 없으면 결과가 아니라 오류로 올린다', async () => {
    const { service, send } = make('accepted', false);

    await expect(
      service.sendToSessions('u-1', ['s-mac'], content),
    ).rejects.toBeInstanceOf(PushUnavailableError);
    expect(send).not.toHaveBeenCalled();
  });
});
