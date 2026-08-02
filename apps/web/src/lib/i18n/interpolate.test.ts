import { describe, expect, it } from 'vitest';
import { interpolate } from './interpolate';
import { messages as en } from './locales/en.gen';
import { messages as ko } from './locales/ko.gen';

describe('interpolate', () => {
  it('자리표시자를 값으로 바꾼다', () => {
    expect(interpolate('Signed in as {name}', { name: 'Alice' })).toBe(
      'Signed in as Alice',
    );
  });

  it('같은 값이 여러 번 나와도 모두 바꾼다', () => {
    expect(interpolate('{n} / {n}', { n: 2 })).toBe('2 / 2');
  });

  it('값이 없으면 자리표시자를 그대로 남긴다', () => {
    // 빈칸으로 삼키면 번역 실수가 화면에서 조용히 사라진다 — 눈에 띄게 둔다.
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    expect(interpolate('Hello {name}')).toBe('Hello {name}');
  });

  it('빌드 시점 변수({{platform}})는 건드리지 않는다', () => {
    // 생성기가 이미 치환한 뒤라 남아 있을 리 없지만, 두 문법이 겹치지 않음을 못박는다.
    expect(interpolate('Prism {{platform}}', { platform: 'X' })).toBe(
      'Prism {{platform}}',
    );
  });

  // 회귀 방지: 어순이 다른 언어에서 이름 자리가 사라지면 문장이 깨진다.
  it('언어가 달라도 자리표시자는 유지된다', () => {
    const name = 'Alice';
    expect(interpolate(en['dashboard.signed_in_as'], { name })).toContain(name);
    expect(interpolate(ko['dashboard.signed_in_as'], { name })).toContain(name);
  });
});
