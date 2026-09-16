import { MAX_PUSH_TITLE_LENGTH } from '@app/common';
import { decodePushRequest, type PushSendBody } from './push-request';

// 경계에서 파싱·검증한다(parse, don't validate) — 지나온 값은 형식이 맞다.
// 기본 주소는 보내는 쪽과 같은 값을 넣는다 — 크기 검증이 실제 전송과 같은 것을 잰다.
const DEMO_LINK = 'https://prism.example/push';
const decode = (body: PushSendBody) => decodePushRequest(body, DEMO_LINK);

describe('decodePushRequest', () => {
  const ok = { sessionIds: ['s-1'], message: 'hello' };

  it('대상과 문구만 있으면 통과하고 나머지는 기본값이다', () => {
    expect(decode(ok)).toEqual({
      sessionIds: ['s-1'],
      message: 'hello',
      actions: 'none',
    });
  });

  it('문구의 앞뒤 공백은 벗긴다', () => {
    expect(decode({ ...ok, message: '  hi  ' }).message).toBe('hi');
  });

  it.each([
    ['빈 문구', { ...ok, message: '   ' }],
    ['상한 초과', { ...ok, message: 'x'.repeat(200) }],
    ['대상 없음', { ...ok, sessionIds: [] }],
    [
      '대상 상한 초과',
      { ...ok, sessionIds: Array.from({ length: 21 }, (_, i) => `s-${i}`) },
    ],
    ['배열이 아닌 대상', { ...ok, sessionIds: 's-1' }],
  ])('%s이면 거부한다', (_label, body) => {
    expect(() => decode(body)).toThrow(
      expect.objectContaining({ status: 400 }) as Error,
    );
  });

  // 같은 세션을 두 번 고를 수 있는 화면은 없지만, 그것이 요청까지 오면 대상별 결과가
  // 두 줄이 되어 화면이 같은 줄을 두 번 그린다.
  it('같은 대상이 두 번 오면 하나로 접는다', () => {
    expect(
      decode({ ...ok, sessionIds: ['s-1', 's-1', 's-2'] }).sessionIds,
    ).toEqual(['s-1', 's-2']);
  });

  it('이미지와 링크는 https만 받는다', () => {
    const request = decode({
      ...ok,
      imageUrl: 'https://cdn.example/a.png',
      link: 'https://example.com/x',
    });
    expect(request.imageUrl).toBe('https://cdn.example/a.png');
    expect(request.link).toBe('https://example.com/x');
  });

  // 서버가 이 주소를 가져오지 않으므로 SSRF는 아니지만, `javascript:` 같은 스킴이
  // 기기에서 열리는 길을 열지 않는다 — 알림을 여는 것은 사람이고, 사람은 주소를 보지 않는다.
  it.each([
    ['http', 'http://example.com/x'],
    ['javascript', 'javascript:alert(1)'],
    ['주소가 아님', 'not a url'],
  ])('%s 링크는 거부한다', (_label, link) => {
    expect(() => decode({ ...ok, link })).toThrow(
      expect.objectContaining({ status: 400 }) as Error,
    );
  });

  it('빈 주소는 없는 것으로 다룬다', () => {
    const request = decode({ ...ok, imageUrl: '  ', link: '' });
    expect(request.imageUrl).toBeUndefined();
    expect(request.link).toBeUndefined();
  });

  // 모르는 조합을 접으면 iOS가 등록하지 않은 카테고리를 받게 된다 — 그러면 버튼이
  // 조용히 사라진다. 기본값(`none`)으로 접는 편이 낫다.
  it('모르는 버튼 조합은 none으로 접는다', () => {
    expect(decode({ ...ok, actions: 'explode' }).actions).toBe('none');
    expect(decode({ ...ok, actions: 'open' }).actions).toBe('open');
  });

  // 제목은 선택이다 — 비면 서버가 받는 기기의 언어로 그린다(push.service).
  it('제목을 적어 보내면 그대로 실린다', () => {
    expect(decode({ ...ok, title: '  배포 알림  ' }).title).toBe('배포 알림');
  });

  it('제목이 비면 아예 싣지 않는다 — 빈 문자열과 미지정을 가르지 않는다', () => {
    expect(decode({ ...ok, title: '   ' }).title).toBeUndefined();
    expect(decode(ok).title).toBeUndefined();
  });

  it('제목이 상한을 넘으면 거부한다', () => {
    expect(() =>
      decode({
        ...ok,
        title: 'x'.repeat(MAX_PUSH_TITLE_LENGTH + 1),
      }),
    ).toThrow();
  });

  // 필드마다는 상한 안이어도 합이 FCM의 4 KB를 넘길 수 있다 — 같은 문구·주소를 data와
  // 플랫폼 블록에 두 번 싣기 때문이다. 그 요청은 보내 봐야 대상마다 failed다.
  it('사람이 적은 것의 합이 상한을 넘으면 400이다', () => {
    const long = `https://cdn.example/${'a'.repeat(1000)}`;
    expect(() =>
      decode({
        sessionIds: ['s-1'],
        message: 'hi',
        imageUrl: long,
        link: long,
      }),
    ).toThrow();
    expect(
      decode({ sessionIds: ['s-1'], message: 'hi', imageUrl: long }).imageUrl,
    ).toBe(long);
  });

  // 바이트 합은 상한 안인데 직렬화하면 넘친다 — 따옴표·제어 문자는 JSON에서 글자마다
  // 바이트를 더하고, 문구는 data와 플랫폼 블록에 서너 번 실린다. 같은 길이의 보통 글자는
  // 통과한다 — 합의 규칙은 그대로고, 이스케이프만 서버가 더 잰다.
  it('직렬화하면 FCM 상한을 넘기는 내용은 400이다', () => {
    const escaped = {
      sessionIds: ['s-1'],
      message: '\u0001'.repeat(120),
      title: '\u0001'.repeat(60),
      link: `https://example.com/${'"'.repeat(700)}`,
    };
    expect(() => decode(escaped)).toThrow(
      expect.objectContaining({ status: 400 }) as Error,
    );
    const plain = {
      ...escaped,
      message: 'm'.repeat(120),
      title: 't'.repeat(60),
      link: `https://example.com/${'a'.repeat(700)}`,
    };
    expect(decode(plain).link).toBe(plain.link);
  });

  it('형식 오류의 코드는 토큰 오류와 다르다', () => {
    expect(() => decode({ sessionIds: ['s-1'], message: '' })).toThrow(
      expect.objectContaining({
        response: { error: 'INVALID_PUSH_REQUEST' },
      }) as Error,
    );
  });
});
