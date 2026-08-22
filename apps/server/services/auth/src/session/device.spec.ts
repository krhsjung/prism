import { classifyDevice } from './device';

// UA를 정해진 갈래로 접는 규칙. 여기서 확인하는 것은 "정확히 맞히는가"만이 아니라
// **좁히지 못할 때 넓게 두는가**다 — 없는 정보를 지어내지 않는 것이 이 분류기의 목적이다.
describe('classifyDevice', () => {
  it('Apple 기기를 브랜드로 알아본다', () => {
    expect(
      classifyDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iphone');
    // iPad의 UA에도 `Mobile`이 들어 있다 — 폰 규칙을 먼저 두면 전부 iPhone이 된다.
    expect(
      classifyDevice(
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('ipad');
  });

  it('Android 브랜드를 모델 코드로 알아본다', () => {
    expect(
      classifyDevice(
        'Mozilla/5.0 (Linux; Android 16; SM-G988N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('galaxy');
    // 태블릿(SM-X…)도 같은 브랜드로 묶는다 — 모델 자리를 더 파면 좁은 값이 된다.
    expect(
      classifyDevice(
        'Mozilla/5.0 (Linux; Android 16; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe('galaxy');
    expect(
      classifyDevice(
        'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('pixel');
  });

  it('모델을 지운 Android는 브랜드 없이 android로 둔다', () => {
    // Chrome의 UA 축약은 기기 모델을 `K`로 대체한다 — 실제 접근 로그에서 나오는 형태다.
    // 브랜드를 지어내지 않고 한 단계 넓은 값으로 접는다.
    expect(
      classifyDevice(
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('android');
  });

  it('데스크톱을 OS로 알아본다', () => {
    expect(
      classifyDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
      ),
    ).toBe('mac');
    expect(
      classifyDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe('windows');
    expect(
      classifyDevice('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0'),
    ).toBe('desktop');
  });

  it('데스크톱급 UA를 쓰는 iPad는 mac으로 접힌다', () => {
    // iPadOS Safari의 기본값이다. UA만으로는 구분할 수 없어 넓은 쪽에 둔다 —
    // 앱은 자기가 무엇인지 알기에 `Prism (iPad)`를 보내 정확히 잡힌다(아래).
    expect(
      classifyDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe('mac');
  });

  it('우리 앱이 보내는 UA도 같은 규칙으로 읽힌다', () => {
    // 앱은 브라우저와 같은 토큰을 실어 보낸다 — 서버가 규칙을 하나만 갖게 하려는 것이다.
    expect(classifyDevice('Prism (iPhone)')).toBe('iphone');
    expect(classifyDevice('Prism (iPad)')).toBe('ipad');
    expect(classifyDevice('Prism (Linux; Android 16; SM-G988N; Mobile)')).toBe(
      'galaxy',
    );
  });

  it('모르면 unknown으로 둔다', () => {
    expect(classifyDevice(undefined)).toBe('unknown');
    expect(classifyDevice('')).toBe('unknown');
    expect(classifyDevice('   ')).toBe('unknown');
    expect(classifyDevice('curl/8.4.0')).toBe('unknown');
    expect(classifyDevice('okhttp/4.12.0')).toBe('unknown');
  });
});
