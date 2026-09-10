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
화면 페이지(`Auth` · `Dashboard` · `WebRTC` · `Push`)로 나뉩니다.

선택 메뉴는 `Atom/SelectOption`(메뉴 한 줄) → `Molecule/SelectMenu`(팝오버) →
`Molecule/Select`(트리거)로 조합합니다. 언어 선택은 `Auth`의 로그인 프레임이 배치를
보여주고, 웹 구현은 [../apps/web/src/components/LocaleSwitcher.tsx](../apps/web/src/components/LocaleSwitcher.tsx),
문구는 [../i18n/](../i18n/)에서 옵니다.

테마 선택도 **같은 컴포넌트**입니다. 다른 점은 줄마다 아이콘이 붙는다는 것뿐이라,
`Atom/SelectOption`의 불리언 `Leading icon`으로 가르고 아이콘은 `Atom/Icon`
(Monitor · Sun · Moon)을 바꿔 끼웁니다 — 예전에는 `Atom/ThemeOption`이 따로 있었지만
차이가 선행 글리프 하나뿐이라 흡수했습니다. 웹이 이미 하나의
[SelectMenu](../apps/web/src/components/SelectMenu.tsx)를 두 스위처가 나눠 쓰고 있었으니
([ThemeSwitcher](../apps/web/src/components/ThemeSwitcher.tsx)) **시안이 코드를 따라간
경우**입니다. `Molecule/Select`의 `Leading icon`을 끄면 글리프 없는 일반 셀렉트가 되고,
WebRTC 로비의 카메라·마이크 선택이 그것을 씁니다.

통화 컨트롤은 `Molecule/CallControls`가 `Atom/IconButton` 두세 개를 담습니다. 로비 프리뷰
인스턴스만 불리언 `End=false`로 종료 버튼을 끕니다 — `Organism/Sidebar`의 `Preferences`와
같은 수법이고 같은 이유입니다(둘로 쪼개면 컨트롤이 늘 때 두 곳을 고쳐야 하고, 언젠가 한쪽만
고쳐집니다).

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
> **`Atom/Icon`은 24 그리드입니다** — 원래 심볼 프레임이 16이었고 도형만 24를 2/3으로 줄여
> 둔 상태였는데, WebRTC 슬라이스에서 24로 재단했습니다(변경이 아니라 이 문서로의 수렴입니다).
> 크기는 변형 축이 아니라 **인스턴스 리사이즈**로 냅니다 — 축을 더하면 아이콘 하나가 변형
> 여럿이 되고, 스케일 툴을 쓰지 않으므로 stroke는 유지됩니다. 기존 화면(메뉴 줄·셰브런)은
> 인스턴스를 16으로 고정해 그대로 둡니다. 현재 14개:
> `Monitor` · `Sun` · `Moon` · `Chevron Down` · `Chevron Right` · `Chevron Up` ·
> `Mic` · `Mic off` · `Camera` · `Camera off` · `Phone off` · `Copy` · `Check` · `Link`.
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

[`WebRTC` 페이지](https://www.figma.com/design/sTDo6HDslOcRmWL78klk1I/Prism?node-id=3036-282)는 통화 슬라이스입니다 —
`Desktop / Lobby` · `Lobby (permission denied)` · `Ringing` · `Incoming call` · `Call expired` ·
`In call` · `In call (diagnostics open)`, 그리고 `Mobile` 네 벌.

| 프레임 | 보여주는 것 |
| --- | --- |
| `Desktop / Lobby` | 셀프 프리뷰 + **내 기기 목록**(`Molecule/CallTarget`) |
| `Desktop / Ringing` | 셀프 타일 + `Calling …` + `Cancel` |
| `Desktop / Incoming call` | 받는 쪽 — 앱 위에 뜨는 수락/거절 |
| `Desktop / Call expired` | 알림을 1분 뒤에 연 기기가 보는 화면 |
| `Desktop / In call` | 피어·셀프 두 타일 + 컨트롤 바 + 접힌 진단 |
| `Desktop / In call (diagnostics open)` | 품질 · 연결 · 설정 · 시그널링 네 절 |
| `Mobile / In call` | 피어 전면 + 셀프 PiP + **화면 바닥 고정** 컨트롤 바 |

> **통화 상대는 내 활성 세션입니다.** 방·코드·링크 공유가 없어서, 로비의 오른쪽 절반은
> 대시보드와 **같은 데이터·같은 행 구성**의 기기 목록입니다(기기 종류 + 짧은 세션 id).
> 소켓의 유무는 "걸 수 있는가"가 아니라 **어떻게 닿는가**를 가릅니다 — 붙어 있으면 바로 울리고,
> 아니면 FCM 푸시로 깨웁니다. 못 거는 줄은 소켓도 알림 토큰도 없는 경우뿐이고, 그 줄에는
> 회색 버튼 대신 이유를 둡니다. 현재 세션 줄은 지우지 않고 **루프백 시험**으로 씁니다.
>
> **프레임이 생기는 조건이 하나 늘었습니다** — 목적·구성이 바뀔 때에 더해, **화면 안에서
> 도달할 수 없는 상태**도 프레임을 갖습니다(`Lobby (permission denied)` · `Call expired`).
> 구성이 로비와 같더라도 그림이 없으면 아무도 그 상태를 검토하지 못하기 때문입니다.

> **프레임은 화면의 목적이나 구성이 바뀔 때만 생깁니다.** 다크가 프레임을 얻지 못한 이유가
> "색이 변수에 묶여서"가 아니라 **그림이 말하는 것이 라이트와 같아서**인 것과 같은 규칙입니다.
> 연결 중·재연결·실패·상대 이탈도 셸·타일·컨트롤이 같은 자리에 있고 배지 색과 한 줄만 바뀌므로,
> **상태는 `Molecule/VideoTile`의 `State` 7변형이 갖습니다** — 그 컴포넌트 프레임이 곧 상태
> 명세서입니다.
>
> **`Stage`는 `Navy`와 값이 같지만 별개 토큰입니다.** `Navy`는 색 이름이고 무대는 역할입니다 —
> 비디오가 놓이는 자리는 테마와 무관하게 어두워야 하는 유일한 표면이라, 이름이 그것을 말하지
> 않으면 다음 사람이 라이트에서 흰색으로 바꿉니다. 짝인 `Stage Foreground`는 두 모드 모두
> 흰색입니다.
>
> **모노(`Code` · `Code/Small`)가 처음 쓰이는 화면입니다.** 값·타임스탬프·후보 문자열처럼
> 자리가 흔들리면 안 되는 것에만 씁니다(1자리↔3자리 ms가 매초 바뀝니다). 라벨은 Manrope
> 그대로 — 모노는 **읽는 글**이 아니라 **재는 값**에 씁니다.

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

[`Push` 페이지](https://www.figma.com/design/sTDo6HDslOcRmWL78klk1I/Prism?node-id=3164-1851)는
내 기기에 알림을 보내 보는 화면입니다 — `Desktop / Send` · `Desktop / Sent` · `Mobile / Send`.

| 프레임 | 보여주는 것 |
| --- | --- |
| `Desktop / Send` | 두 열 — 작성(제목·문구·이미지·링크·버튼)이 왼쪽, **기기 목록**이 오른쪽 |
| `Desktop / Sent` | 고른 줄마다 결말이 붙은 모습. 한 줄은 `duplicate`(같은 설치가 두 세션에 걸린 경우) |
| `Mobile / Send` | 375에서 두 열이 한 열로 쌓인 모습 — 작성 → 목록 → 보내기 |

> **기기 목록은 통화 로비와 같은 자리(오른쪽 416)입니다.** 부품이 같으니
> (`Molecule/CallTarget`) 자리와 폭도 같아야 합니다 — 같은 목록이 화면을 옮길 때마다
> 좌우를 바꾸면, "같은 부품이다"가 그림에서 먼저 거짓이 됩니다. 다른 것은 오른쪽 끝의
> 컨트롤뿐입니다: 로비는 `Call`, 여기는 체크박스입니다.
>
> **보내기 버튼은 두 열 아래 전체 폭입니다.** 작성 열이 기기 4행보다 훨씬 길어, 버튼을
> 열 안에 두면 카드 바닥이 한쪽만 길어집니다.
>
> **카드는 대시보드·통화 카드와 같은 세 구획입니다** — 머리 / 본문 / 바닥에 구분선.
> 바닥 한 줄은 등록 토큰이 세션 안에서만 산다는 사실을 말합니다
> ([../plan/push.md](../plan/push.md) §5-3). 로그인 카드의 440 폭·40 패딩은 여기서
> 되돌립니다.
>
> **이미지 필드는 안 보일 수 있다는 것을 화면이 먼저 말합니다.** 주소도 페이로드도
> 맞는데 macOS Chrome은 그림을 그리지 않습니다 — 시스템 알림 센터에 큰 그림 자리가
> 없어서입니다([../plan/push.md](../plan/push.md) §5-11). 화면이 말하지 않으면
> 리뷰어가 배관이 깨진 것으로 읽습니다.
>
> **알림 줄은 토글입니다 — 다만 끄는 것은 등록이지 권한이 아닙니다.** 브라우저는 앱이
> 권한을 되돌리는 길을 주지 않아서, 끄기가 약속하는 것은 "이 기기가 받는가"뿐입니다.
> 설명 줄이 그 경계를 말합니다([../plan/push.md](../plan/push.md) §5-15).
>
> **제목은 비워 둘 수 있습니다.** 비우면 서버가 받는 기기의 언어로 그리므로
> (`Test push` / `테스트 푸시`), 시안에서도 필수 표시를 두지 않고 placeholder가
> 그 사실을 말합니다 — `Leave empty to use the default`.
>
> **버튼 조합은 드롭다운이 아니라 나란한 세 선택지입니다.** 선택지가 셋뿐이고, 고른 것이
> 화면에 남아 있어야 "이 알림에 버튼이 붙는다"가 보입니다. 375에서는 접힙니다.

테마·언어 선택은 화면 아래 `Preferences` 줄에 8px 간격으로 나란히 놓습니다(웹의
`.auth__prefs`와 같은 배치). 다크 프레임의 트리거는 `Dark`를 가리킵니다 — 화면이
어두운 이유가 사용자의 선택임을 그림 안에서 알 수 있어야 하기 때문입니다.

## 스타일

Manrope (Regular / SemiBold / Bold) 기반. 컬러는 Navy / Primary / Accent Blue 중심의
soft cool 무드 (라이트/다크 양쪽 정의 — Figma `Colors` 변수 컬렉션 참고).

**JetBrains Mono**는 토큰과 타입 스타일(`Code` 14 · `Code/Small` 12)로만 있다가 WebRTC 진단
패널에서 실제로 쓰이기 시작했습니다. 웹은 아직 시스템 모노 스택을 쓰므로
([plan/webrtc.md §9](../plan/webrtc.md)) 구현 때 함께 맞춥니다.

## 라이트 / 다크

Figma `Colors` 컬렉션의 `Light` · `Dark` 두 모드가 원본이고, 빌드가
`tokens/color/{light,dark}.json`을 거쳐 플랫폼별 산출물로 펼칩니다.

다크는 라이트의 반전이 아니라 따로 정의합니다.

- **주요 동작**은 한 단계 밝은 파랑(`#4A78B8`)으로 갑니다 — 라이트의 네이비
  (`#1D3557`)는 어두운 배경 위에서 배경과 붙어 버립니다.
- **의미색**(성공·경고·오류·정보)은 밝게, 그 **배경**은 어둡게 뒤집습니다. 라이트의
  파스텔 배경(`#FDEEEE` 등)을 그대로 두면 다크 화면에 흰 판이 뚫립니다.
- 각 짝은 본문 크기에서 대비 4.5:1 이상을 지킵니다.
