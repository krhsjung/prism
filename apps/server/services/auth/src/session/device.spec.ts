import { classifyDevice } from './device';

// UA를 네 갈래로 접는 규칙. 여기서 확인하는 것은 "정확히 맞히는가"가 아니라
// **좁히지 못할 때 넓게 두는가**다 — 없는 정보를 지어내지 않는 것이 이 분류기의 목적이다.
describe('classifyDevice', () => {
  it('폰을 알아본다', () => {
    expect(
      classifyDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('phone');
    expect(
      classifyDevice(
        'Mozilla/5.0 (Linux; Android 16; SM-G988N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('phone');
  });

  it('태블릿을 폰으로 접지 않는다', () => {
    // iPad·Android 태블릿의 UA에도 `Mobile`이 들어 있어, 폰을 먼저 보면 전부 폰이 된다.
    expect(
      classifyDevice(
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('tablet');
    // Android 태블릿은 `Mobile` 토큰이 **빠지는** 것으로 구분된다.
    expect(
      classifyDevice(
        'Mozilla/5.0 (Linux; Android 16; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe('tablet');
  });

  it('데스크톱을 알아본다', () => {
    expect(
      classifyDevice(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe('desktop');
    expect(
      classifyDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe('desktop');
    expect(
      classifyDevice('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0'),
    ).toBe('desktop');
  });

  it('모르면 unknown으로 둔다', () => {
    // UA가 없거나(네이티브 클라이언트 일부·프록시) 알아볼 수 없으면 좁히지 않는다.
    expect(classifyDevice(undefined)).toBe('unknown');
    expect(classifyDevice('')).toBe('unknown');
    expect(classifyDevice('   ')).toBe('unknown');
    expect(classifyDevice('curl/8.4.0')).toBe('unknown');
    expect(classifyDevice('okhttp/4.12.0')).toBe('unknown');
  });
});
