# web

Prism 웹 클라이언트 — React + Vite + TypeScript.

## 실행

```bash
pnpm install
pnpm dev       # 개발 서버 (HMR)
pnpm build     # 타입체크 + 프로덕션 빌드
pnpm preview   # 빌드 산출물 미리보기
pnpm test      # vitest (93개)
```

## 지원 브라우저 하한

`vite.config.ts`의 `BROWSER_FLOOR`가 지원 하한을 **명시합니다**(`build.target`·`cssTarget`
둘 다 같은 값). 값 자체보다 명시했다는 것이 중요합니다 — 기본값에 맡기면 최소화기가 최신
문법으로 줄여도 알 길이 없습니다. 실제로 `@media (max-width: 720px)`가 range 문법
(`@media (width<=720px)`)으로 나가, 그 문법을 모르는 브라우저에서는 규칙이 **통째로 무시돼**
모바일 배치가 죽었습니다(Safari는 16.4부터 지원).

CSS만 정하면 "스타일은 무시되는데 스크립트는 도는" 어긋난 조합이 나오므로 JS도 같은 값을 씁니다.
빌드 뒤 확인하려면:

```bash
grep -o '@media[^{]*' dist/assets/*.css   # (max-width:720px)여야 한다
```

## API 주소

API 주소는 소스에 박지 않고 `VITE_API_URL`에서 옵니다(iOS·Android의 `PRISM_API_URL`과
같은 역할). 비어 있으면 `http://localhost:3000`으로 떨어집니다.

## 인증 · 세션

로그인은 소셜(Google · Apple · Kakao)과 **원클릭 데모** 넷입니다. 웹에서 중요한 것은
**클라이언트가 토큰을 들고 다니지 않는다**는 점입니다 — 세션은 `HttpOnly` 쿠키에 있고
JS는 읽을 수도 지울 수도 없습니다. 그래서 "로그인 상태인가"는 저장소를 보고 판단하지
않고 서버(`GET /auth/me`)에 묻습니다(초기 상태가 항상 `loading`인 이유).

- **흐름은 화면 크기가 아니라 창이 정합니다** — 데스크톱은 popup(로그인 화면의 상태가
  보존되고 뒤로 가기 복원 문제가 생기지 않음), 모바일 브라우저는 redirect입니다
  (`src/lib/oauth-popup.ts`). popup 결과는 `postMessage`로 오고, **origin과 메시지
  type을 함께 확인한 뒤에만** 수용합니다.
- **선제 갱신** — 액세스 토큰이 `HttpOnly`라 만료 시각을 읽을 수 없으므로, 서버가
  응답에 담아주는 `accessTokenTtlMs`의 75% 지점에 세션을 회전시킵니다. 이렇게 해야
  요청 없이 열어둔 탭도 idle 창에서 죽지 않고 absolute 상한까지 세션이 밀립니다.
  백그라운드 탭에서 타이머가 억제됐을 경우를 위해 탭 복귀·포커스·온라인 복귀 시에도
  한 번 보정합니다(`src/lib/AuthProvider.tsx`).
- **경합 방어** — 모든 전이가 세대(generation)를 올리고, 늦게 도착한 이전 확인 응답은
  버립니다. 그러지 않으면 로그아웃 직후 도착한 예전 `/auth/me` 응답이 로그인 상태를
  되살립니다.
- **로그아웃은 서버가 합니다** — JS가 `HttpOnly` 쿠키를 지울 수 없기 때문입니다.
  실패하면 "로그아웃됐다"고 표시하지 않습니다(새로고침에서 되살아나면 더 혼란스럽습니다).

정책 전반은 [../../plan/auth.md](../../plan/auth.md) §6.

## 대시보드 — 활성 세션 관리

로그인 이후의 화면입니다. 앱 셸(사이드바 + 상단 바)과 **활성 세션 카드**로 이뤄지고,
모바일(≤720px)에서는 사이드바가 드로어로 열립니다(Esc·스크림·닫기 버튼, 열림 시 포커스
이동 + 배경 스크롤 잠금).

- `GET /auth/sessions`로 내 세션을 보고, 개별(`POST /auth/sessions/:id/revoke`)·전체
  (`.../revoke-all`)로 원격 폐기합니다. 현재 세션을 지우면 이 브라우저의 쿠키도 함께
  정리됩니다.
- **기기 종류만 보여줍니다.** 계약의 `device`는 정해진 목록(iPhone·iPad·Galaxy·Pixel·
  Android·Mac·Windows·데스크톱·모름)뿐입니다 —
  서버가 로그인 요청의 User-Agent를 그 자리에서 접고 원문은 버리며, IP는 읽지 않습니다.
  기기명·브라우저·위치를 그리려면 그것들을 저장해야 하고, 그러면 개인정보 미저장 원칙이
  깨집니다. 각 행은 "기기 종류 + 현재/로그인된 세션 + 짧은 세션 id + 시작·만료 시각"입니다.
- 세션 id는 `HttpOnly` 쿠키 안의 토큰에만 있어 클라이언트가 알 수 없으므로, **서버가**
  지금 요청의 세션을 `isCurrent`로 표시해 줍니다.

기획은 [../../plan/dashboard.md](../../plan/dashboard.md).

## 계약

서버·웹이 공유하는 타입과 디코더는 서버가 소유합니다. `src/lib/contracts.gen.ts`는
`apps/server/libs/common/src/types/contracts.ts`에서 **생성**된 사본이라 직접 고치지
않습니다(`apps/server`에서 `pnpm sync:contracts`). 어긋나면 drift 테스트가 실패합니다.

외부에서 온 JSON은 전부 디코더를 거칩니다 — `unknown`/`any` 없이 경계에서 형태를
확인하고 넘깁니다.

## 로깅

`src/lib/log.ts`는 **개발 전용**입니다(`import.meta.env.DEV` 게이트). 배포된 웹은
콘솔에 아무것도 남기지 않습니다 — 리뷰어의 활동이 로그로 재구성되지 않게 하기
위해서입니다. 남기는 값은 provider·outcome·status 같은 안전한 원시값뿐이고, 토큰·쿠키·
사용자 정보·원시 경로·쿼리스트링은 넘기지 않습니다. 카테고리(`auth`/`net`/`ui`/`error`)는
iOS `Log`·Android `AppLog`와 맞춥니다.

## 다국어

화면 문구는 전부 번역 마스터([../../i18n/](../../i18n/))에서 생성됩니다. 문구를
바꾸려면 `i18n/client.csv`를 고치고 `i18n/`에서 `node scripts/generate.js`를 실행하세요 —
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

메뉴는 기본적으로 트리거 아래로 펴지지만, **모바일 드로어 안에서는 오른쪽으로 폅니다**
(`.sidebar__footer .select__menu`). 드로어 바닥에 붙은 트리거에는 아래로 열 자리가 없기
때문이고, 셰브런도 CSS로 90도 돌려 `>`로 만들어 가리키는 쪽과 펴지는 쪽을 맞춥니다. 화면을
넘길 때는 `min()`으로 안쪽으로 당깁니다 — iOS·Android에서는 시스템이 해주는 일입니다.

## 관련 문서

- 번역 마스터 / 생성기: [../../i18n/README.md](../../i18n/README.md)
- 디자인 시스템 / 토큰: [../../design/README.md](../../design/README.md)
- 인증 화면 기획: [../../plan/auth.md](../../plan/auth.md)
- 대시보드 기획: [../../plan/dashboard.md](../../plan/dashboard.md)
