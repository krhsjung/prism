import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

// 메뉴가 트리거의 어느 쪽에 정렬될지. 화면 가장자리에 붙는 자리(대시보드 헤더)에서
// 가운데 정렬을 쓰면 메뉴가 화면 밖으로 밀린다.
export type Align = 'center' | 'end';

export interface SelectOption<T extends string> {
  value: T;
  // 목록에 그대로 보이는 이름 — 번역이 필요하면 부르는 쪽에서 이미 번역해 넘긴다.
  label: string;
  icon?: ReactNode;
}

interface SelectMenuProps<T extends string> {
  // 무엇을 고르는 목록인지(예: Language · Theme). 화면에는 보이지 않고 접근성
  // 이름으로만 쓰인다 — 트리거에 보이는 것은 지금 고른 값뿐이라 이 설명이 없으면
  // 스크린 리더로는 그 버튼이 무엇을 하는지 알 수 없다.
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange(value: T): void;
  // 트리거 앞에 붙는 아이콘. 무엇을 고르는 메뉴인지 한눈에 보이게 한다.
  icon: ReactNode;
  align?: Align;
}

function ChevronIcon() {
  return (
    <svg className="icon icon--bold" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="icon icon--bold icon--check" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// 값 하나를 고르는 팝오버 메뉴 — 언어·테마 선택이 공유한다.
//
// 두 선택은 생김새뿐 아니라 키보드·초점 규칙까지 같아야 한다. 각자 구현하면 한쪽만
// 고쳐지고 다른 쪽이 뒤처지므로, 동작은 여기 한 곳에만 둔다.
export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  align = 'center',
}: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.find((option) => option.value === value);

  // 닫을 때는 초점을 트리거로 되돌린다 — 메뉴가 사라지면 초점을 잃은 채로 남아
  // 키보드 사용자가 문서 처음부터 다시 훑어야 한다.
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // 열리면 지금 고른 값에 초점을 준다 — 키보드로 열었을 때 바로 위아래로 고를 수 있게.
  useEffect(() => {
    if (!open) return;
    const current = options.findIndex((option) => option.value === value);
    optionRefs.current[current < 0 ? 0 : current]?.focus();
  }, [open, options, value]);

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

  function select(next: T) {
    onChange(next);
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
    const last = options.length - 1;
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
      className="select"
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
        className="select__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={onTriggerKeyDown}
      >
        {icon}
        <span className="sr-only">{label}</span>
        <span>{selected?.label}</span>
        <ChevronIcon />
      </button>

      {open && (
        <div
          className={`select__menu select__menu--${align}`}
          id={menuId}
          role="menu"
          aria-label={label}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              className="select__option"
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              onClick={() => select(option.value)}
              onKeyDown={(e) => onOptionKeyDown(e, index)}
            >
              {option.icon}
              <span className="select__option-label">{option.label}</span>
              {option.value === value && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
