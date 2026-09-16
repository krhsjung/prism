import { buildFcmMessage, deliveredBytes } from './fcm-message';

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
      // Android가 알림을 그리는 재료 — 그쪽에는 `notification` 블록이 없다(§5-20).
      title: text.title,
      body: text.body,
      callId: 'c-1',
      device: 'iphone',
      link,
      actions: 'none',
    });
  });

  // 기본 주소도 data에 싣는다 — 세 플랫폼이 같은 곳으로 간다(웹은 `/push`를 열고, 네이티브는
  // 우리 주소를 앱 안의 그 화면으로 연다 — 딥링크). 잠깐(7차 검토) 웹에만 실었다가 실기기에서
  // 네이티브가 갈 곳을 잃어 되돌렸다.
  it('링크가 없으면 기본 주소가 data에도 실린다', () => {
    const message = callMessage();
    expect(message.data.link).toBe(link);
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
    // callId·device는 통화 알림만 갖는다. title·body·link·actions는 언제나 값이 있다
    // (없으면 기본 주소와 `none`).
    expect(message.data).toEqual({
      kind: 'demo',
      title: text.title,
      body: text.body,
      link,
      actions: 'none',
    });
  });

  // ⚠️ **Android에는 `notification` 블록을 보내지 않는다**(§5-20). 보내면 앱이 뒤에
  // 있을 때 FCM SDK가 대신 그려, 버튼·아이콘·이미지가 앞에서 받은 알림과 달라진다.
  it('Android는 data 메시지다 — 그리는 것은 앱이다', () => {
    const message = callMessage();
    expect(JSON.stringify(message.android)).not.toContain('notification');
    expect(message).not.toHaveProperty('notification');
  });

  // 보통 우선순위의 data 메시지는 Doze에서 미뤄진다 — 지금은 앱이 그리는 알림이 곧
  // 도착이라, 미뤄지면 알림 자체가 늦는다. 매번 보이는 알림이라 FCM 조건 안이다.
  it('Android는 알림 종류와 무관하게 높은 우선순위다', () => {
    expect(callMessage().android.priority).toBe('high');
    const demo = buildFcmMessage('tok-1', text, { kind: 'demo' }, link).message;
    expect(demo.android.priority).toBe('high');
  });

  // iOS는 여전히 OS가 그리므로 통화와 데모의 우선순위를 가른다 — 데모는 전력을 아낀다.
  it('iOS는 통화만 즉시 우선순위다', () => {
    expect(callMessage().apns.headers['apns-priority']).toBe('10');
    const demo = buildFcmMessage('tok-1', text, { kind: 'demo' }, link).message;
    expect(demo.apns.headers['apns-priority']).toBe('5');
  });

  // 무음 푸시는 저전력 모드·강제 종료에서 조용히 사라진다 — 알림으로 보낸다.
  it('iOS는 alert 푸시이고 content-available을 쓰지 않는다', () => {
    const message = callMessage();
    expect(message.apns.headers['apns-push-type']).toBe('alert');
    expect(JSON.stringify(message.apns)).not.toContain('content-available');
    // 최상위 `notification`이 없으므로 **보일 문구는 aps.alert에 있어야 한다** —
    // 없으면 alert 푸시가 아니라 조용히 사라지는 푸시가 된다.
    expect(message.apns.payload.aps.alert).toEqual(text);
  });

  it('웹은 서비스 워커가 그릴 문구를 webpush.notification으로 받는다', () => {
    const { title, body } = callMessage().webpush.notification;
    expect({ title, body }).toEqual(text);
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

  // Android와 웹은 **직접 그린다** — FCM이 공통 필드를 플랫폼 페이로드로 어떻게
  // 펼치는지에 기대지 않고, 링크처럼 data에서 꺼낸다. 웹은 webpush에도 받는다.
  it('이미지 주소는 data에 실린다 — Android와 웹이 읽는 자리다', () => {
    const message = rich();
    expect(message.data.image).toBe('https://cdn.example/cat.png');
    expect(message.webpush.notification.image).toBe(
      'https://cdn.example/cat.png',
    );
  });

  // **이 한 줄이 없으면 확장이 있어도 이미지가 빠진 채 뜬다.**
  it('iOS는 mutable-content와 확장용 주소를 함께 받는다', () => {
    const message = rich();
    expect(message.apns.payload.aps['mutable-content']).toBe(1);
    expect(message.apns.fcm_options?.image).toBe('https://cdn.example/cat.png');
  });

  it('이미지가 없으면 어느 자리에도 싣지 않는다', () => {
    const message = buildFcmMessage(
      'tok-1',
      text,
      { kind: 'demo' },
      link,
    ).message;
    expect(message.webpush.notification.image).toBeUndefined();
    expect(message.data.image).toBeUndefined();
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
    expect(rich().webpush.notification.requireInteraction).toBe(true);
    const plain = buildFcmMessage(
      'tok-1',
      text,
      { kind: 'demo' },
      link,
    ).message;
    expect(plain.webpush.notification.requireInteraction).toBeUndefined();
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

  // 한도는 기기 하나가 받는 몫에 걸린다 — 메시지 전체를 재면 세 플랫폼 몫을 다 더해 세 배쯤
  // 보수적이 되고, 한 플랫폼 몫만 재면 웹의 기본 주소(data에 없고 webpush.data에 있다)를
  // 빠뜨린다. 가장 큰 몫이 답이다.
  it('deliveredBytes는 가장 큰 플랫폼 몫이고 메시지 전체보다 작다', () => {
    const longLink = `https://prism.example/${'p'.repeat(500)}`;
    const size = deliveredBytes(text, { kind: 'demo' }, longLink);
    const whole = Buffer.byteLength(
      JSON.stringify(buildFcmMessage('', text, { kind: 'demo' }, longLink)),
    );
    expect(size).toBeLessThan(whole);
    // 웹 몫은 기본 주소를 두 번 싣는다(data · fcm_options) — 그것이 가장 크다.
    expect(size).toBeGreaterThan(longLink.length * 2);
  });
});
