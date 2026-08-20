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
| `Mobile / Default` | 사이드바가 접힌 모바일 배치 |
| `Mobile / Drawer (open)` | 햄버거로 연 네비 드로어(슬라이드인 + 스크림) |

> **별도 다크 시안을 두지 않습니다** — 색이 전부 `Colors` 컬렉션 변수에 묶여 있어
> 프레임의 적용 모드만 `Dark`로 바꾸면 다크가 나옵니다(웹의 `<html data-theme>`와 같은
> 구조). `Auth`의 `Dark` 프레임은 다크에서의 **선택 상태**(트리거가 `Dark`를 가리킴)를
> 보여주기 위한 예외입니다.
>
> ⚠️ Dashboard 시안은 세션 행에 `MacBook Pro · Chrome · Seoul, KR` 같은 **기기 라벨**을
> 보여주지만 구현은 그리지 않습니다 — 계약이 UA·IP를 담지 않기 때문입니다(개인정보
> 미저장, [../plan/dashboard.md](../plan/dashboard.md)). 시안의 라벨은 시각적 밀도를
> 잡기 위한 자리표시로 읽습니다.

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
