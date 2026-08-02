import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCALE_STORAGE_KEY,
  detectLocale,
  negotiateLocale,
  readStoredLocale,
  storeLocale,
  toLocale,
} from './locale';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('toLocale', () => {
  it('지역이 붙은 태그를 지원 언어로 좁힌다', () => {
    // 브라우저가 주는 값은 거의 항상 지역까지 붙어 있다 — 정확히 일치하는 쪽이 드물다.
    expect(toLocale('ko-KR')).toBe('ko');
    expect(toLocale('ja-JP')).toBe('ja');
    expect(toLocale('en-US')).toBe('en');
  });

  it('대소문자를 가리지 않는다', () => {
    expect(toLocale('KO')).toBe('ko');
    expect(toLocale('en-GB')).toBe('en');
  });

  it('지원하지 않는 언어는 null이다', () => {
    expect(toLocale('fr')).toBeNull();
    expect(toLocale('')).toBeNull();
    expect(toLocale('-')).toBeNull();
  });
});

describe('negotiateLocale', () => {
  it('선호 순서에서 처음 지원되는 언어를 고른다', () => {
    expect(negotiateLocale(['fr-FR', 'de', 'ja-JP', 'ko'])).toBe('ja');
  });

  it('지원하는 언어가 하나도 없으면 기본 언어로 떨어진다', () => {
    expect(negotiateLocale(['fr', 'de'])).toBe('en');
    expect(negotiateLocale([])).toBe('en');
  });
});

describe('저장된 선택', () => {
  it('저장한 언어를 다시 읽는다', () => {
    storeLocale('ja');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
    expect(readStoredLocale()).toBe('ja');
  });

  // 지원 목록에서 빠진 언어가 저장돼 있을 수 있다(언어를 줄인 배포 이후).
  it('저장된 값이 지원 목록에 없으면 무시한다', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    expect(readStoredLocale()).toBeNull();
  });

  // 사파리 프라이빗 모드 등에서 localStorage 접근 자체가 던진다 —
  // 언어 설정 하나 때문에 앱이 죽으면 안 된다.
  it('localStorage가 막혀 있어도 죽지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(readStoredLocale()).toBeNull();
    expect(() => storeLocale('ko')).not.toThrow();
  });
});

describe('detectLocale', () => {
  it('사용자가 고른 언어가 브라우저 설정보다 우선한다', () => {
    vi.stubGlobal('navigator', { languages: ['ja-JP'], language: 'ja-JP' });
    storeLocale('ko');
    expect(detectLocale()).toBe('ko');
  });

  it('고른 적이 없으면 브라우저 선호 순서를 따른다', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'ko-KR'], language: 'fr-FR' });
    expect(detectLocale()).toBe('ko');
  });

  it('languages가 비어 있으면 language 하나로 판단한다', () => {
    vi.stubGlobal('navigator', { languages: [], language: 'ja' });
    expect(detectLocale()).toBe('ja');
  });
});
