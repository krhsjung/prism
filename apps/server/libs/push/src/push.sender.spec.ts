import { JWT } from 'google-auth-library';
import { PrismConfigService } from '@app/config';
import { PushSender } from './push.sender';

// 전송기는 **절대 던지지 않는다** — 푸시 실패가 통화나 HTTP 요청을 무너뜨리면 안 된다.
// 그래서 이 스위트는 결말이 세 갈래로만 나오는지를 본다.
describe('PushSender', () => {
  const FCM = {
    projectId: 'prism-test',
    clientEmail: 'sender@prism-test.iam.gserviceaccount.com',
    // 실제로 서명하지 않는다(getAccessToken을 가로챈다) — 형식만 갖춘 값이다.
    privateKey: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n',
  };

  const configWith = (fcm: typeof FCM | null): PrismConfigService =>
    ({ fcmConfig: fcm }) as PrismConfigService;

  const send = (sender: PushSender) =>
    sender.send(
      'tok-1',
      { title: 't', body: 'b' },
      { kind: 'call', callId: 'c-1', device: 'mac' },
      'https://prism.example/webrtc?callId=c-1',
    );

  let fetchMock: jest.Mock;
  let accessToken: jest.SpyInstance<Promise<{ token?: string | null }>>;

  beforeEach(() => {
    // getAccessToken은 콜백 오버로드를 함께 갖고 있어 추론이 never로 좁혀진다 —
    // 우리가 쓰는 Promise 쪽만 골라 준다.
    accessToken = jest.spyOn(
      JWT.prototype,
      'getAccessToken',
    ) as object as jest.SpyInstance<Promise<{ token?: string | null }>>;
    accessToken.mockResolvedValue({ token: 'access-1' });
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  // 자격증명이 없는 로컬·CI에서도 서버는 뜬다 — 전송만 조용히 실패한다.
  it('설정이 없으면 네트워크를 건드리지 않고 failed다', async () => {
    const sender = new PushSender(configWith(null));

    expect(sender.enabled).toBe(false);
    await expect(send(sender)).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('FCM이 받아들이면 accepted다', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(send(new PushSender(configWith(FCM)))).resolves.toBe(
      'accepted',
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://fcm.googleapis.com/v1/projects/prism-test/messages:send',
    );
    expect(init.headers).toMatchObject({ authorization: 'Bearer access-1' });
  });

  // 죽은 토큰은 **다시 보내도 소용없다** — 화면이 "다시 로그인하세요"라고 말할 수 있는
  // 유일한 갈래라 확실할 때만 이 값을 준다.
  it.each([
    ['details의 errorCode', 404, { errorCode: 'UNREGISTERED' }],
    ['error.status', 400, { errorCode: 'INVALID_ARGUMENT' }],
  ])('토큰이 죽었으면 rejected다 (%s)', async (_label, status, detail) => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { status: 'NOT_FOUND', details: [detail] } }),
        { status },
      ),
    );

    await expect(send(new PushSender(configWith(FCM)))).resolves.toBe(
      'rejected',
    );
  });

  // 확실하지 않은 실패를 '토큰이 죽었다'로 읽으면 화면이 없는 사실을 말하게 된다.
  it.each([
    ['서버 오류', 503, '{}'],
    [
      '할당량',
      429,
      JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }),
    ],
    ['형식을 모르는 본문', 400, 'not json'],
  ])('일시적 실패는 failed다 (%s)', async (_label, status, body) => {
    fetchMock.mockResolvedValue(new Response(body, { status }));

    await expect(send(new PushSender(configWith(FCM)))).resolves.toBe('failed');
  });

  it('네트워크가 던져도 던지지 않고 failed로 접는다', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));

    await expect(send(new PushSender(configWith(FCM)))).resolves.toBe('failed');
  });

  it('액세스 토큰을 못 받으면 보내지 않는다', async () => {
    accessToken.mockResolvedValue({});

    await expect(send(new PushSender(configWith(FCM)))).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
