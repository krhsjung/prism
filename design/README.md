# design

디자인 시스템 — 토큰 + 비주얼 소스 of truth.

## 구조

```text
design/
├── tokens/                     # JSON 토큰 (Figma Variables에서 sync)
│   ├── color/
│   │   ├── light.json
│   │   └── dark.json
│   ├── typography.json
│   ├── radius.json
│   └── spacing.json
├── build/                      # Style Dictionary 산출물 (gitignored)
│   ├── web/{light,dark}/{tokens.css, tokens.ts}
│   ├── ios/{light,dark}/Tokens.swift
│   └── android/{light,dark}/{colors.xml, dimens.xml}
├── build.js                    # Style Dictionary 빌드 스크립트
└── package.json
```

## 워크플로

비주얼 소스: [Figma — `Prism` 파일](https://www.figma.com/design/sTDo6HDslOcRmWL78klk1I/Prism)

1. **편집**: Figma Variables / 컴포넌트 / 비주얼은 Figma에서 수정
2. **Sync**: Figma 변수 → `tokens/color/{light,dark}.json` 수동 sync (Claude가 MCP로 추출 + 매핑)
3. **Build**: `pnpm build` → `build/{platform}/{theme}/`에 플랫폼별 + 테마별 산출물 생성
4. **Use**: 각 앱이 자기 플랫폼/테마 산출물을 import해서 사용

## 사용

```bash
pnpm install
pnpm build
```

## 컴포넌트

Figma 파일은 `Assets`(섹션: `Foundations` · `Atoms` · `Molecules` · `Organisms`)와
화면 페이지(`Auth` · `Dashboard`)로 나뉩니다.

언어 선택은 `Atom/LanguageOption`(메뉴 한 줄) → `Molecule/LanguageMenu`(팝오버) →
`Molecule/LanguageSelector`(트리거)로 조합하고, `Auth`의 로그인 프레임이 배치를
보여줍니다. 웹 구현은 [../apps/web/src/components/LocaleSwitcher.tsx](../apps/web/src/components/LocaleSwitcher.tsx),
문구는 [../i18n/](../i18n/)에서 옵니다.

테마 선택도 같은 골격입니다 — `Atom/ThemeOption` → `Molecule/ThemeMenu` →
`Molecule/ThemeSelector`. 다른 점은 줄마다 아이콘이 붙는다는 것이고, 아이콘은
`Atom/Icon`(Monitor · Sun · Moon)을 바꿔 끼웁니다. 두 선택이 생김새와 키보드 동작을
공유하므로 웹 구현도 하나의 [SelectMenu](../apps/web/src/components/SelectMenu.tsx)를
나눠 씁니다([ThemeSwitcher](../apps/web/src/components/ThemeSwitcher.tsx)).

목록 안의 인라인 액션(`Revoke`)은 **입력 방식에 따라 갈립니다.** 포인터(데스크톱 웹)에서는
`Ghost`(판 없이 글자만) — 표가 가벼워지고, 눌리는 것이라는 신호는 hover가 줍니다.
**터치에는 hover가 없으므로**(앱과 좁은 폭의 웹) `Secondary`(채운 판)를 씁니다. 신호를
hover에 기대는 변형은 손가락 앞에서 그냥 글자가 됩니다.

시안도 같은 규칙입니다 — `Dashboard / Mobile` 두 프레임의 `Revoke`는 `Variant=Secondary`,
`Dashboard / Desktop / Default`는 `Ghost`입니다. 고르는 자리에서 이유가 보이도록
`Atom/Button` 컴포넌트 설명에도 적어 두었습니다.

`Ghost` 변형은 세 플랫폼에 모두 있습니다(웹 `.btn--ghost` · iOS `.ghost` ·
Android `PrismButtonVariant.GHOST`). 확인 창의 `취소`가 그것을 씁니다 — 옆의 채운
확인 버튼과 무게 차이를 만드는 것이 목적입니다.

트리거의 셰브런도 `Atom/Icon`입니다(`Chevron Down` · `Chevron Right`). **가리키는 쪽이 곧
메뉴가 펴지는 쪽**이라, 상단 바에서는 `Down`, 좁고 긴 드로어에서는 `Right`를 씁니다 —
드로어의 스위처는 패널 바닥에 붙어 있어 아래로 펼 자리가 없습니다(plan/dashboard.md §4).

> **아이콘은 SF Symbol을 쓰지 않습니다.** 이름이 같아도 그림이 달라(`desktopcomputer`는
> 면으로 채운 모니터) 세 화면을 나란히 놓으면 그 차이가 그대로 보입니다. iOS도 웹의 SVG
> 패스를 옮긴 [PrismGlyph](../apps/ios/prism/Presentation/Views/Components/PrismGlyph.swift)로
> 그립니다 — Android의 `res/drawable/ic_*.xml`과 같은 24 그리드·stroke 2입니다.
>
> **배지는 높이를 고정합니다**(시안 `Atom/Badge` = 23). 패딩만 주면 플랫폼마다 글자 상자
> 여백이 달라 같은 배지가 서로 다른 높이로 나옵니다(Compose는 폰트 패딩을 더하고 SwiftUI는
> 더하지 않습니다).
>
> **날짜·시각은 CLDR의 medium·short로 씁니다.** 세 플랫폼이 같은 문자열을 내야 하므로
> iOS도 `Date.formatted(date: .abbreviated…)`가 아니라 `DateFormatter`를 씁니다 — 전자는
> 한국어를 `2026년 8월 20일`로 내어 웹·Android의 `2026. 8. 20.`과 갈라집니다. 표기 언어는
> 기기가 아니라 **앱에서 고른 언어**를 따릅니다.

앱도 같은 구성입니다 — [iOS](../apps/ios/prism/Presentation/Views/Components/PreferenceSwitchers.swift) ·
[Android](../apps/android/app/src/main/java/kr/hs/jung/prism/ui/component/PreferenceSwitchers.kt)
각각 트리거 + 팝오버 한 벌을 두 스위처가 나눠 씁니다. **높이만 시안과 다릅니다** —
트리거·메뉴 줄이 웹에서는 36이지만 앱에서는 손가락 표적이라 각 플랫폼의 최소 터치
크기(iOS 44 · Android 48)까지 키웁니다. 너비·패딩·간격·색은 시안 그대로입니다.

## 화면

`Auth` 페이지는 로그인 화면을 데스크톱(1440) · 모바일(375) 두 벌로 둡니다.

| 프레임 | 보여주는 것 |
| --- | --- |
| `Default` · `Error` · `Loading` | 기본 상태와 오류·대기 상태 |
| `Language open` · `Theme open` | 팝오버가 열린 모습 (한 번에 하나만 열린다) |
| `Dark` | 다크 모드 — `Colors` 컬렉션 모드를 `Dark`로 고정한 프레임 |

[`Dashboard` 페이지](https://www.figma.com/design/sTDo6HDslOcRmWL78klk1I/Prism?node-id=2480-60)는
로그인 이후 화면입니다 — `Dashboard / Desktop / Default` · `Dashboard / Mobile / Default`,
그리고 모바일 네비 드로어(`Mobile / Drawer (open)`).

| 프레임 | 보여주는 것 |
| --- | --- |
| `Desktop / Default` | 앱 셸(사이드바 + 상단 바) + Active sessions 카드 |
| — | 상단 바에는 페이지 이름만 둡니다. `OVERVIEW` 눈썹은 뺐습니다 — 목적지가 하나뿐이라 묶음 이름이 가리킬 것이 없고, 넣으려면 뜻 없는 낱말 하나를 세 언어로 번역해야 합니다 |
| `Mobile / Default` | 사이드바가 접힌 모바일 배치. 카드 머리는 제목·부제만 두고 `Sign out all`은 그 아래 오른쪽 — 나란히 두면 영어·일본어에서 둘 다 줄바꿈됩니다 |
| `Mobile / Drawer (open)` | 햄버거로 연 네비 드로어(슬라이드인 + 스크림) — 바닥에 테마·언어·로그아웃 |

> **별도 다크 시안을 두지 않습니다** — 색이 전부 `Colors` 컬렉션 변수에 묶여 있어
> 프레임의 적용 모드만 `Dark`로 바꾸면 다크가 나옵니다(웹의 `<html data-theme>`와 같은
> 구조). `Auth`의 `Dark` 프레임은 다크에서의 **선택 상태**(트리거가 `Dark`를 가리킴)를
> 보여주기 위한 예외입니다.
>
> **문구는 Figma가 아니라 i18n 마스터가 원천입니다.** 시안의 텍스트는 마스터
> ([../i18n/client.csv](../i18n/client.csv))와 같아야 합니다 — 실제로 카드 부제가 데스크톱
> (`Devices currently signed in to your account`)과 모바일(`3 devices signed in`)에서 서로
> 달라, 마스터 값(`Where your account is signed in`)으로 통일했습니다. 표 헤더처럼 CSS가
> 대문자로 바꾸는 자리는 시안이 대문자로, 마스터는 문장형으로 둡니다(`DEVICE` ↔ `Device`).
>
> **사이드바와 모바일 드로어는 같은 컴포넌트입니다**(`Organism/Sidebar`). 불리언 속성
> `Preferences`로 가릅니다 — 기본 `false`(데스크톱: 이 컨트롤이 상단 바에 있음), 모바일
> 드로어 인스턴스만 `true`(바닥에 구분선 + 테마·언어·로그아웃). 컴포넌트를 둘로 쪼개면
> 내비게이션 항목이 늘 때마다 두 곳을 고쳐야 하고, 언젠가 한쪽만 고쳐집니다.
>
> **세션 행은 기기 종류 + 짧은 세션 id입니다.** 제목 줄에 `Mac`·`iPhone`·`Windows`,
> 부제에 `#a3f1c204`. 기기명·브라우저·위치(`MacBook Pro · Chrome · Seoul, KR`)를 그리려면
> User-Agent 원문과 IP를 저장해야 하고, 그러면 개인정보 미저장 원칙이 깨집니다
> ([../plan/dashboard.md](../plan/dashboard.md) §5). 시안도 그 값으로 맞춰 두었습니다 —
> 계약에 없는 값을 시안이 계속 보여주면 다음 사람이 그것을 구현하려 듭니다.
>
> 부제에 "현재 세션/로그인된 세션"을 겹쳐 적지 않습니다. 바로 옆 배지(`Current`/`Active`)가
> 이미 그 말을 하고, 좁은 폭에서는 줄바꿈까지 만듭니다.

테마·언어 선택은 화면 아래 `Preferences` 줄에 8px 간격으로 나란히 놓습니다(웹의
`.auth__prefs`와 같은 배치). 다크 프레임의 트리거는 `Dark`를 가리킵니다 — 화면이
어두운 이유가 사용자의 선택임을 그림 안에서 알 수 있어야 하기 때문입니다.

## 스타일

Manrope (Regular / SemiBold / Bold) 기반. 컬러는 Navy / Primary / Accent Blue 중심의
soft cool 무드 (라이트/다크 양쪽 정의 — Figma `Colors` 변수 컬렉션 참고).

## 라이트 / 다크

Figma `Colors` 컬렉션의 `Light` · `Dark` 두 모드가 원본이고, 빌드가
`tokens/color/{light,dark}.json`을 거쳐 플랫폼별 산출물로 펼칩니다.

다크는 라이트의 반전이 아니라 따로 정의합니다.

- **주요 동작**은 한 단계 밝은 파랑(`#4A78B8`)으로 갑니다 — 라이트의 네이비
  (`#1D3557`)는 어두운 배경 위에서 배경과 붙어 버립니다.
- **의미색**(성공·경고·오류·정보)은 밝게, 그 **배경**은 어둡게 뒤집습니다. 라이트의
  파스텔 배경(`#FDEEEE` 등)을 그대로 두면 다크 화면에 흰 판이 뚫립니다.
- 각 짝은 본문 크기에서 대비 4.5:1 이상을 지킵니다.
