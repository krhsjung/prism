import { LOCALES, MESSAGE_KEYS, MESSAGES } from './messages.gen';
import { translate } from './translate';

describe('translate', () => {
  it('요청 언어의 문구를 돌려준다', () => {
    expect(translate('ko', 'page.noscript_continue')).toBe('Prism으로 이동');
    expect(translate('en', 'page.noscript_continue')).toBe('Continue to Prism');
  });

  // 타입이 이미 강제하지만, 생성기가 언어별로 키를 흘리면 런타임에만 드러난다.
  it('모든 언어가 같은 키 집합을 채운다', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort()).toEqual(
        [...MESSAGE_KEYS].sort(),
      );
    }
  });

  it('빈 문구가 남아 있지 않다', () => {
    for (const locale of LOCALES) {
      for (const key of MESSAGE_KEYS) {
        expect(translate(locale, key)).not.toBe('');
      }
    }
  });
});
