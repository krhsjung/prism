import { buildFcmMessage, CHANNEL_CALLS, CHANNEL_GENERAL } from './fcm-message';

// 페이로드는 순수 함수 하나가 만든다 — 그래서 "무엇이 알림에 실리는가"를 여기서
// 통째로 못박을 수 있다(plan/webrtc.md §7).
describe('buildFcmMessage', () => {
  const text = { title: 'Incoming call', body: 'Open Prism to answer.' };
  const link = 'https://prism.example/webrtc?callId=c-1';

  const callMessage = () =>
    buildFcmMessage(
      'tok-1',
      text,
      { kind: 'call', callId: 'c-1', device: 'iphone' },
      link,
    ).message;

  // 통화를 가리키는 값은 `callId`뿐이고, 그것만으로는 아무것도 할 수 없다 —
  // 앱이 소켓을 붙여 `resume`을 물어야 한다. `link`·`actions`는 모든 알림이 갖는다.
  it('통화 알림은 callId와 기기 종류만 나른다', () => {
    expect(callMessage().data).toEqual({
      kind: 'call',
      callId: 'c-1',
      device: 'iphone',
      link,
      actions: 'none',
    });
  });

  // 알림은 잠금화면에 뜨고 OS 로그에 남는다. 세션 id·SDP·사용자 정보가 실리면
  // 그 사실이 기기 밖으로 나간다.
  it('세션 id·SDP·사용자 정보는 어디에도 실리지 않는다', () => {
    const serialized = JSON.stringify(callMessage());
    for (const forbidden of ['sdp', 'sessionId', 'userId', 'displayName']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  // FCM v1은 data 값이 전부 문자열이 아니면 400으로 거절한다.
  it('data 값은 전부 문자열이다', () => {
    for (const value of Object.values(callMessage().data)) {
      expect(typeof value).toBe('string');
    }
  });

  it('없는 값은 data에 키조차 만들지 않는다', () => {
    const message = buildFcmMessage(
      'tok-1',
      text,
      { kind: 'demo' },
      link,
    ).message;
    // callId·device는 통화 알림만 갖는다. link·actions는 언제나 값이 있다
    // (없으면 기본 주소와 `none`).
    expect(message.data).toEqual({ kind: 'demo', link, actions: 'none' });
  });

  // 통화는 사람을 기다리게 하므로 Doze에서도 지금 떠야 하고, 데모 알림은 그럴 이유가
  // 없다 — 채널도 갈라 둔다(하나를 끄면 둘 다 꺼지지 않게).
  it('통화만 높은 우선순위와 통화 채널을 쓴다', () => {
    const call = callMessage();
    expect(call.android.priority).toBe('high');
    expect(call.android.notification.channel_id).toBe(CHANNEL_CALLS);
    expect(call.apns.headers['apns-priority']).toBe('10');

    const demo = buildFcmMessage('tok-1', text, { kind: 'demo' }, link).message;
    expect(demo.android.priority).toBe('normal');
    expect(demo.android.notification.channel_id).toBe(CHANNEL_GENERAL);
  });

  // 무음 푸시는 저전력 모드·강제 종료에서 조용히 사라진다 — 알림으로 보낸다.
  it('iOS는 alert 푸시이고 content-available을 쓰지 않는다', () => {
    const message = callMessage();
    expect(message.apns.headers['apns-push-type']).toBe('alert');
    expect(JSON.stringify(message.apns)).not.toContain('content-available');
    expect(message.notification).toEqual(text);
  });

  it('웹은 알림을 누르면 열 주소를 함께 받는다', () => {
    expect(callMessage().webpush.fcm_options.link).toBe(link);
  });

  // ── 이미지 · 링크 · 액션 (plan/push.md §5-11 ~ §5-13) ──

  const rich = () =>
    buildFcmMessage(
      'tok-1',
      text,
      {
        kind: 'demo',
        imageUrl: 'https://cdn.example/cat.png',
        link: 'https://example.com/thing',
        actions: 'open-dismiss',
      },
      'https://prism.example/push',
    ).message;

  it('이미지는 한 자리에 두고 FCM이 세 플랫폼으로 펼친다', () => {
    expect(rich().notification.image).toBe('https://cdn.example/cat.png');
  });

  // **이 한 줄이 없으면 확장이 있어도 이미지가 빠진 채 뜬다.**
  it('iOS는 mutable-content와 확장용 주소를 함께 받는다', () => {
    const message = rich();
    expect(message.apns.payload.aps['mutable-content']).toBe(1);
    expect(message.apns.fcm_options?.image).toBe('https://cdn.example/cat.png');
  });

  it('이미지가 없으면 그 셋 중 아무것도 싣지 않는다', () => {
    const message = buildFcmMessage(
      'tok-1',
      text,
      { kind: 'demo' },
      link,
    ).message;
    expect(message.notification.image).toBeUndefined();
    expect(message.apns.payload.aps['mutable-content']).toBeUndefined();
    expect(message.apns.fcm_options).toBeUndefined();
  });

  // 웹은 `fcm_options.link`로, 네이티브는 `data`로 같은 주소를 받는다 —
  // 네이티브는 webpush 설정을 보지 못한다.
  it('링크는 웹과 네이티브 두 자리로 같이 간다', () => {
    const message = rich();
    expect(message.webpush.fcm_options.link).toBe('https://example.com/thing');
    expect(message.data.link).toBe('https://example.com/thing');
  });

  it('링크가 없으면 기본 주소가 그 자리를 채운다', () => {
    const message = buildFcmMessage(
      'tok-1',
      text,
      { kind: 'demo' },
      link,
    ).message;
    expect(message.webpush.fcm_options.link).toBe(link);
    expect(message.data.link).toBe(link);
  });

  // iOS는 **미리 등록된 카테고리**만 쓸 수 있다 — 서버가 버튼 목록을 만들어 보낼
  // 방법이 없어 조합 자체를 계약이 정한다.
  it.each([
    ['none', undefined],
    ['open', 'prism.open'],
    ['open-dismiss', 'prism.open_dismiss'],
  ] as const)('액션 %s는 iOS 카테고리 %s로 간다', (actions, category) => {
    const message = buildFcmMessage(
      'tok-1',
      text,
      { kind: 'demo', actions },
      link,
    ).message;
    expect(message.apns.payload.aps.category).toBe(category);
    expect(message.data.actions).toBe(actions);
  });

  // 누를 것이 있는데 알림이 스스로 지나가 버리면 버튼을 둔 의미가 없다.
  it('버튼이 있는 웹 알림만 스스로 사라지지 않는다', () => {
    expect(rich().webpush.notification?.requireInteraction).toBe(true);
    const plain = buildFcmMessage(
      'tok-1',
      text,
      { kind: 'demo' },
      link,
    ).message;
    expect(plain.webpush.notification).toBeUndefined();
  });

  // **버튼 문구는 서버가 보내지 않는다** — 클라이언트가 자기 언어로 그린다(§5-13).
  it('버튼 문구는 페이로드 어디에도 없다', () => {
    // 본문에 'Open'이 들어 있는 통화 문구를 쓰면 이 단언이 그것과 부딪힌다 —
    // 버튼 문구가 없다는 것만 보게 문구를 갈아 끼운다.
    const serialized = JSON.stringify(
      buildFcmMessage(
        'tok-1',
        { title: 'Prism', body: 'hello' },
        { kind: 'demo', actions: 'open-dismiss' },
        link,
      ),
    );
    for (const word of ['Open', 'Dismiss', '열기', '닫기']) {
      expect(serialized).not.toContain(word);
    }
  });
});
