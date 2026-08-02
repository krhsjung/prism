# web

Prism 웹 클라이언트 — React + Vite + TypeScript.

## 실행

```bash
npm install
npm run dev       # 개발 서버 (HMR)
npm run build     # 타입체크 + 프로덕션 빌드
npm run preview   # 빌드 산출물 미리보기
```

## 다국어

화면 문구는 전부 번역 마스터([../../i18n/](../../i18n/))에서 생성됩니다. 문구를
바꾸려면 `i18n/client.csv`를 고치고 `node scripts/generate.js`를 실행하세요 —
`src/lib/i18n/`의 `*.gen.ts`는 직접 수정하지 않습니다.

```tsx
const { t } = useI18n();
<h1>{t('auth.welcome_back')}</h1>
<p>{t('dashboard.signed_in_as', { name: user.displayName })}</p>
```

- 키는 생성된 유니온(`MessageKey`)이라 오타·삭제된 키가 컴파일 단계에서 걸립니다.
- 표시 언어는 저장된 선택 > 브라우저 선호 순서 > 기본 언어(en) 순으로 정해집니다
  (`src/lib/i18n/locale.ts`). 사용자는 로그인 화면·대시보드의 `LocaleSwitcher`로
  바꿀 수 있고 선택은 `localStorage`에 남습니다. 디자인은 Figma의
  `Molecule/LanguageSelector` · `Molecule/LanguageMenu` · `Atom/LanguageOption`,
  화면 배치는 `Screens / Login — Language closed·open` 프레임을 따릅니다.
- 메뉴는 `role="menu"` + `menuitemradio`로, 위/아래·Home/End 이동, Escape 닫기(초점은
  트리거로 복귀), 바깥 클릭 닫기를 지원합니다. 화면 가장자리에 놓을 때는
  `align="end"`로 메뉴를 오른쪽 끝에 맞춥니다.
- 기본 언어만 번들에 정적으로 들어가고 나머지는 동적 import로 분리됩니다.
- 화면 문구를 새로 넣을 때는 리터럴 대신 마스터에 키를 추가하세요. 예외는 로고
  워드마크("Prism")뿐입니다.

## 테마

라이트 · 다크를 고를 수 있고, 고르기 전에는 기기 설정(`prefers-color-scheme`)을
따릅니다. 한 번 고르면 그 값이 `localStorage`에 남아 다음 방문에도 유지됩니다
(`src/lib/theme/theme.ts`).

- 실제로 칠할 테마는 `<html data-theme="light|dark">` **하나로만** 알립니다. CSS
  토큰이 이 속성에서 갈리므로 색을 바꾸는 경로가 하나뿐입니다.
- 첫 페인트는 `index.html`의 부트 스크립트가 칠합니다 — React가 붙기를 기다리면
  다크를 고른 사용자가 매번 흰 화면을 한 번 보게 됩니다. 그래서 저장 키·속성 이름을
  손으로 한 번 더 적으며, 어긋나면 `theme.test.ts`가 `index.html`을 읽어 잡아냅니다.
- `system`은 "고르지 않음"이 아니라 기기를 따르겠다는 선택입니다. 그동안에는
  `matchMedia`를 구독해 OS 야간 모드 전환을 새로고침 없이 따라갑니다.
- 트리거에는 **고른 값**을 보여줍니다(칠해진 색이 아니라) — `system`일 때 "Light"라고
  적으면 무엇을 골랐는지 알 수 없습니다.
- 디자인은 Figma의 `Molecule/ThemeSelector` · `Molecule/ThemeMenu` ·
  `Atom/ThemeOption` · `Atom/Icon`을 따릅니다.

언어·테마 선택은 팝오버 메뉴 하나를 공유합니다(`src/components/SelectMenu.tsx`) —
생김새뿐 아니라 키보드·초점 규칙까지 같아야 하기 때문입니다. 각자 구현하면 한쪽만
고쳐지고 다른 쪽이 뒤처집니다.

## 관련 문서

- 번역 마스터 / 생성기: [../../i18n/README.md](../../i18n/README.md)
- 디자인 시스템 / 토큰: [../../design/README.md](../../design/README.md)
- 인증 화면 기획: [../../plan/auth.md](../../plan/auth.md)
