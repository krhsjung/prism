import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../lib/i18n/i18n-context';
import { LOCALES, LOCALE_META, type Locale } from '../lib/i18n/messages.gen';

// 메뉴가 트리거의 어느 쪽에 정렬될지. 화면 가장자리에 붙는 자리(대시보드 헤더)에서
// 가운데 정렬을 쓰면 메뉴가 화면 밖으로 밀린다.
type Align = 'center' | 'end';

// 아이콘은 currentColor를 따라 색이 바뀐다 — 상태별 색을 CSS 한 곳에서만 정한다.
function GlobeIcon() {
  return (
    <svg className="locale__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20" />
      <path d="M2 12h20" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="locale__icon locale__icon--bold" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="locale__icon locale__icon--bold locale__check"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// 언어 선택. 브라우저 설정과 다른 언어를 보고 싶은 경우를 위한 탈출구이며,
// 고른 값은 저장되어 다음 방문에도 유지된다(locale.ts).
//
// 각 언어 이름은 그 언어로 적는다 — 지금 화면 언어를 못 읽는 사용자가 쓰는 장치라
// 현재 언어로 번역해 두면(예: 영어 화면에 "Korean") 정작 필요한 사람이 찾지 못한다.
export function LocaleSwitcher({ align = 'center' }: { align?: Align }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 닫을 때는 초점을 트리거로 되돌린다 — 메뉴가 사라지면 초점을 잃은 채로 남아
  // 키보드 사용자가 문서 처음부터 다시 훑어야 한다.
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // 열리면 지금 언어에 초점을 준다 — 키보드로 열었을 때 바로 위아래로 고를 수 있게.
  useEffect(() => {
    if (!open) return;
    const current = LOCALES.indexOf(locale);
    optionRefs.current[current < 0 ? 0 : current]?.focus();
  }, [open, locale]);

  // 바깥을 누르면 닫는다. 이때는 초점을 되돌리지 않는다 — 사용자가 이미 다른 곳을
  // 가리켰는데 트리거로 초점을 끌어오면 방금 누른 곳을 빼앗는다.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function select(next: Locale) {
    setLocale(next);
    close();
  }

  function focusOption(index: number) {
    optionRefs.current[index]?.focus();
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    // 위/아래로도 열린다(메뉴 위젯의 관례). 열림 후 초점 이동은 위 effect가 맡는다.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onOptionKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = LOCALES.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusOption(index === last ? 0 : index + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusOption(index === 0 ? last : index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusOption(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusOption(last);
    } else if (e.key === 'Tab') {
      // 초점이 메뉴 밖으로 나가는 중이다 — 초점을 되돌리지 않고 닫기만 한다.
      setOpen(false);
    }
  }

  return (
    <div
      className="locale"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        close();
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className="locale__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={onTriggerKeyDown}
      >
        <GlobeIcon />
        {/* 눈에 보이는 것은 언어 이름뿐이지만, 이름만으로는 이 버튼이 무엇을 하는지
            알 수 없다 — 화면에 없는 설명을 접근성 이름 앞에 붙인다. */}
        <span className="sr-only">{t('common.language')}</span>
        <span>{LOCALE_META[locale].label}</span>
        <ChevronIcon />
      </button>

      {open && (
        <div
          className={`locale__menu locale__menu--${align}`}
          id={menuId}
          role="menu"
          aria-label={t('common.language')}
        >
          {LOCALES.map((code, index) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={code === locale}
              className="locale__option"
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              onClick={() => select(code)}
              onKeyDown={(e) => onOptionKeyDown(e, index)}
            >
              <span className="locale__option-label">{LOCALE_META[code].label}</span>
              {code === locale && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
