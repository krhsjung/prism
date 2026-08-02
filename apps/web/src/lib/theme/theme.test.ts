import { afterEach, describe, expect, it, vi } from 'vitest';
// 부트 스크립트 대조용 — 문서를 문자열 그대로 읽는다(브라우저 앱이라 fs를 쓰지 않는다).
import indexHtml from '../../../index.html?raw';
import {
  DARK_QUERY,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  applyTheme,
  detectTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  subscribeSystemTheme,
  systemTheme,
  toTheme,
} from './theme';

// matchMedia는 jsdom에 없다 — 기기 설정을 흉내 내는 최소 스텁을 심는다.
function stubSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === DARK_QUERY && dark,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  );
  return listeners;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('toTheme', () => {
  it('아는 값만 통과시킨다', () => {
    expect(toTheme('system')).toBe('system');
    expect(toTheme('light')).toBe('light');
    expect(toTheme('dark')).toBe('dark');
  });

  it('모르는 값과 빈 값은 null이다', () => {
    expect(toTheme('sepia')).toBeNull();
    expect(toTheme('')).toBeNull();
    expect(toTheme(null)).toBeNull();
  });
});

describe('resolveTheme', () => {
  it('system은 기기 설정으로 풀린다', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  // 고른 뒤에는 기기 설정이 어떻든 그 값이다 — 이게 선택의 의미다.
  it('직접 고른 값은 기기 설정을 무시한다', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });
});

describe('systemTheme', () => {
  it('기기 설정을 읽는다', () => {
    stubSystem(true);
    expect(systemTheme()).toBe('dark');
    stubSystem(false);
    expect(systemTheme()).toBe('light');
  });

  // matchMedia가 없는 환경에서도 앱은 떠야 한다.
  it('matchMedia가 없으면 라이트로 본다', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(systemTheme()).toBe('light');
    expect(subscribeSystemTheme(() => undefined)).toBeTypeOf('function');
  });
});

describe('저장된 선택', () => {
  it('저장한 테마를 다시 읽는다', () => {
    storeTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('저장된 값이 아는 값이 아니면 무시한다', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readStoredTheme()).toBeNull();
  });

  // 사파리 프라이빗 모드 등에서 localStorage 접근 자체가 던진다.
  it('localStorage가 막혀 있어도 죽지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(readStoredTheme()).toBeNull();
    expect(() => storeTheme('dark')).not.toThrow();
  });
});

describe('detectTheme', () => {
  it('고른 적이 없으면 기기 설정을 따른다(system)', () => {
    expect(detectTheme()).toBe('system');
  });

  it('고른 값이 있으면 그 값이다', () => {
    storeTheme('light');
    expect(detectTheme()).toBe('light');
  });
});

describe('applyTheme', () => {
  it('실제로 칠할 테마를 html 속성 하나로 알린다', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light');
  });
});

// index.html의 부트 스크립트는 첫 페인트 깜빡임을 없애려고 같은 규칙을 손으로 한 번 더
// 적는다 — 여기 상수가 바뀌면 그 스크립트도 함께 바뀌어야 한다(안 그러면 저장된 선택을
// 못 읽고 첫 화면만 다른 테마로 번쩍인다). 어긋남을 이 테스트가 잡는다.
describe('부트 스크립트', () => {
  it('theme.ts와 같은 저장 키·속성·질의를 쓴다', () => {
    expect(indexHtml).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(indexHtml).toContain(`'${THEME_ATTRIBUTE}'`);
    expect(indexHtml).toContain(`'${DARK_QUERY}'`);
  });
});
