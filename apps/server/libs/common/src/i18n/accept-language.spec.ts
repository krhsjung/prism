import { localeFrom, parseAcceptLanguage, toLocale } from './accept-language';

// 서버가 직접 그리는 화면(OAuth 콜백 페이지)의 언어는 Accept-Language로만 정해진다 —
// 웹이 고른 언어는 localStorage에 있어 다른 출처인 서버가 읽을 수 없다.
describe('parseAcceptLanguage', () => {
  it('q 값이 큰 순서로 정렬한다', () => {
    expect(parseAcceptLanguage('en;q=0.7,ko-KR,ja;q=0.9')).toEqual([
      'ko-KR', // q 생략 = 1
      'ja',
      'en',
    ]);
  });

  it('q가 같으면 헤더에 적힌 순서를 지킨다', () => {
    expect(parseAcceptLanguage('ja;q=0.8,ko;q=0.8')).toEqual(['ja', 'ko']);
  });

  it('q=0은 "원하지 않는다"는 뜻이라 제외한다', () => {
    expect(parseAcceptLanguage('ko;q=0,ja;q=0.5')).toEqual(['ja']);
  });

  it('와일드카드는 고를 근거가 없어 버린다', () => {
    expect(parseAcceptLanguage('*')).toEqual([]);
  });

  it('헤더가 없거나 비어 있으면 빈 목록이다', () => {
    expect(parseAcceptLanguage()).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
  });

  // 헤더는 클라이언트가 주는 값이라 형식을 신뢰하지 않는다 — 요청 하나가 여기서 죽으면 안 된다.
  it('망가진 조각이 섞여도 읽을 수 있는 것만 남긴다', () => {
    expect(parseAcceptLanguage('ko;q=abc,,;q=0.5,  ja  ;q=0.4')).toEqual([
      'ko', // 읽을 수 없는 q는 기본값 1
      'ja',
    ]);
  });
});

describe('toLocale', () => {
  it('지역이 붙은 태그를 지원 언어로 좁힌다', () => {
    expect(toLocale('ko-KR')).toBe('ko');
    expect(toLocale('EN-US')).toBe('en');
  });

  it('지원하지 않는 언어는 null이다', () => {
    expect(toLocale('fr-FR')).toBeNull();
  });
});

describe('localeFrom', () => {
  it('선호 순서에서 처음 지원되는 언어를 고른다', () => {
    expect(localeFrom('fr-FR,ko-KR;q=0.9,en;q=0.8')).toBe('ko');
  });

  it('지원하는 언어가 없으면 기본 언어로 응답한다', () => {
    expect(localeFrom('fr-FR,de;q=0.9')).toBe('en');
    expect(localeFrom()).toBe('en');
  });
});
