import { SelectMenu, type Align, type SelectOption } from './SelectMenu';
import { useI18n } from '../lib/i18n/i18n-context';
import { LOCALES, LOCALE_META, type Locale } from '../lib/i18n/messages.gen';

// 아이콘은 currentColor를 따라 색이 바뀐다 — 상태별 색을 CSS 한 곳에서만 정한다.
function GlobeIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20" />
      <path d="M2 12h20" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    </svg>
  );
}

// 각 언어 이름은 그 언어로 적는다 — 지금 화면 언어를 못 읽는 사용자가 쓰는 장치라
// 현재 언어로 번역해 두면(예: 영어 화면에 "Korean") 정작 필요한 사람이 찾지 못한다.
// 목록이 화면 언어와 무관하니 모듈 로드 때 한 번만 만든다.
const OPTIONS: readonly SelectOption<Locale>[] = LOCALES.map((code) => ({
  value: code,
  label: LOCALE_META[code].label,
}));

// 언어 선택. 브라우저 설정과 다른 언어를 보고 싶은 경우를 위한 탈출구이며,
// 고른 값은 저장되어 다음 방문에도 유지된다(locale.ts).
export function LocaleSwitcher({ align = 'center' }: { align?: Align }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <SelectMenu
      label={t('common.language')}
      value={locale}
      options={OPTIONS}
      onChange={setLocale}
      icon={<GlobeIcon />}
      align={align}
    />
  );
}
