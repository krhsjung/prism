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

## 관련 문서

- 번역 마스터 / 생성기: [../../i18n/README.md](../../i18n/README.md)
- 디자인 시스템 / 토큰: [../../design/README.md](../../design/README.md)
- 인증 화면 기획: [../../plan/auth.md](../../plan/auth.md)
