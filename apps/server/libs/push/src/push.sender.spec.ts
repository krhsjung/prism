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

  const FCM_ERROR = 'type.googleapis.com/google.firebase.fcm.v1.FcmError';
  const BAD_REQUEST = 'type.googleapis.com/google.rpc.BadRequest';

  // 죽은 토큰은 **다시 보내도 소용없다** — 그리고 이 값은 저장소의 토큰을 지우게
  // 하므로, 확실할 때만 준다.
  it.each([
    [
      '등록 해지',
      404,
      {
        status: 'NOT_FOUND',
        details: [{ '@type': FCM_ERROR, errorCode: 'UNREGISTERED' }],
      },
    ],
    [
      '다른 프로젝트의 토큰',
      403,
      {
        status: 'PERMISSION_DENIED',
        details: [{ '@type': FCM_ERROR, errorCode: 'SENDER_ID_MISMATCH' }],
      },
    ],
    [
      '토큰 자리를 지목한 INVALID_ARGUMENT',
      400,
      {
        status: 'INVALID_ARGUMENT',
        details: [
          { '@type': FCM_ERROR, errorCode: 'INVALID_ARGUMENT' },
          {
            '@type': BAD_REQUEST,
            fieldViolations: [{ field: 'message.token', description: 'bad' }],
          },
        ],
      },
    ],
  ])('토큰이 죽었으면 rejected다 (%s)', async (_label, status, error) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error }), { status }),
    );

    await expect(send(new PushSender(configWith(FCM)))).resolves.toBe(
      'rejected',
    );
  });

  // 확실하지 않은 실패를 '토큰이 죽었다'로 읽으면 화면이 없는 사실을 말하고, 서버는
  // **산 토큰을 세션에서 떼어 낸다.** INVALID_ARGUMENT는 우리 페이로드의 문제일 수도
  // 있고, 404는 프로젝트 경로가 틀린 배포에서 모든 전송의 답이다.
  it.each([
    ['서버 오류', 503, '{}'],
    [
      '할당량',
      429,
      JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }),
    ],
    ['형식을 모르는 본문', 400, 'not json'],
    ['본문 없는 404', 404, ''],
    [
      '다른 필드를 지목한 INVALID_ARGUMENT',
      400,
      JSON.stringify({
        error: {
          status: 'INVALID_ARGUMENT',
          details: [
            { '@type': FCM_ERROR, errorCode: 'INVALID_ARGUMENT' },
            {
              '@type': BAD_REQUEST,
              fieldViolations: [{ field: 'message.data', description: 'x' }],
            },
          ],
        },
      }),
    ],
    [
      '자리를 지목하지 않은 INVALID_ARGUMENT',
      400,
      JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }),
    ],
    // 종류를 밝히지 않은 detail의 필드는 읽지 않는다 — 다른 종류에 우연히 같은 이름의
    // 필드가 있어도 토큰의 문제로 읽지 않는다.
    [
      '종류 없는 detail의 UNREGISTERED',
      404,
      JSON.stringify({
        error: {
          status: 'NOT_FOUND',
          details: [{ errorCode: 'UNREGISTERED' }],
        },
      }),
    ],
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

  // 상한은 **자격증명 교환부터** 잰다. FCM 왕복만 재면 교환이 느린 날 그 시간이 밖으로
  // 새어 클라이언트의 요청 타임아웃을 넘긴다.
  it('자격증명 교환이 늦어도 상한 안에 failed로 접는다', async () => {
    jest.useFakeTimers();
    try {
      accessToken.mockReturnValue(new Promise(() => {}));
      const pending = send(new PushSender(configWith(FCM)));

      jest.advanceTimersByTime(8_000);

      await expect(pending).resolves.toBe('failed');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
