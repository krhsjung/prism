# ios

Prism iOS 클라이언트 — SwiftUI + Swift Concurrency.

## 실행

Xcode로 `prism.xcodeproj`를 열고 실행합니다. 명령줄로는:

```bash
xcodebuild -project prism.xcodeproj -scheme prism \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
xcodebuild test -project prism.xcodeproj -scheme prism \
  -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:prismTests
```

유닛 테스트는 `prismTests`에 65개(계약 디코딩 · Keychain · AuthManager 상태 전이 ·
대시보드 세션 상태)입니다.

`prismUITests/DashboardUITests`는 데모 로그인부터 대시보드가 실제로 그려지는지까지 보는
연기 테스트라 **서버가 떠 있어야** 통과합니다 — 기본 실행에 섞지 않고 필요할 때만 부릅니다:

```bash
xcodebuild test -project prism.xcodeproj -scheme prism \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:prismUITests/DashboardUITests
```

프로젝트는 **파일 시스템 동기화 그룹**(objectVersion 77)을 씁니다 — `prism/` 아래에
파일을 놓으면 `.xcodeproj`를 건드리지 않아도 타깃에 들어갑니다.

## 구조

피처-우선(feature-first): **인증 피처**는 `Features/Auth/` 한 곳에 오케스트레이션 + 화면이
모여 있고, 공유 커널(계약)·인프라(Core)·디자인시스템·앱 셸은 공유 위치에 둔다. 대시보드가
붙으면 `Features/Dashboard/`가 같은 자리에 슬롯인한다.

```text
prism/
├── App/                    # 앱 진입점
├── Features/               # 피처별 모듈
│   └── Auth/               # 인증 피처
│       │                   #   AuthManager · AuthService — 상태 머신 + 전송
│       │                   #   LoginViewModel · LoginView — 화면
│       │                   #   SocialSignIn · SocialSDK — provider 공통 추상 + SDK 부트스트랩
│       │                   #   {Apple,Google,Kakao}SignInController — 네이티브 SDK 경로
│       │                   #   WebAuthController — 웹 redirect(flow=native) 경로
│   └── Dashboard/           # 대시보드 피처
│       │                   #   SessionsService — /auth/sessions* 전송
│       │                   #   DashboardViewModel · DashboardView — 셸 + 활성 세션 카드
├── Core/                   # 공유 인프라
│   ├── DI/                 # ServiceContainer — 의존성 조립
│   ├── Localization/       # 언어 선택 + 문구 조회
│   ├── Networking/         # APIEndpoint · APIError · NetworkManager
│   ├── Security/           # KeychainManager (세션 자격증명)
│   ├── Theme/              # 라이트/다크/시스템 선택
│   └── Utils/              # Log · StorageKeys
├── Domain/Models/Auth/     # 공유 API 계약 (AuthContracts + Contracts.gen)
├── Presentation/Views/     # 공유 UI + 앱 셸
│   ├── Components/         # PrismButton · PrismCard · 스위처 (디자인시스템)
│   ├── Extensions/         # AppColor · AppDimension (디자인 토큰)
│   └── Pages/              # RootView(라우팅) · Main/SignedInView(로그인 후 셸)
└── Resources/
    ├── Assets.xcassets/    # Colors/ = 디자인 토큰 (라이트·다크)
    └── Localization/       # 생성된 .xcstrings + Messages.gen.swift
```

> 계약(`Domain/Models/Auth`)과 제네릭 네트워킹(`Core/Networking`)은 **공유 커널**로 남긴다 —
> 전송 계층과 다른 피처가 함께 쓰고, 피처가 이들에 의존하되 역방향 의존은 없다.

## API 주소

주소는 소스에 박지 않고 빌드 환경변수 `PRISM_API_URL`에서 옵니다 — 웹의
`VITE_API_URL`과 같은 역할입니다. 값은 [Config/Info.plist](Config/Info.plist)를 통해
번들로 들어가고 `APIConfiguration`이 읽습니다.

```bash
PRISM_API_URL=https://<도메인> xcodebuild ...
```

비어 있으면 `http://localhost:3000`으로 떨어집니다. 시뮬레이터에서 로컬 서버(http)를
붙이려면 ATS 예외(`NSAllowsLocalNetworking`)를 `Config/Info.plist`에 추가하세요 —
운영 빌드에는 넣지 않습니다.

> `Config/Info.plist`는 커스텀 키만 담은 **베이스** 파일입니다. 씬 매니페스트·런치
> 스크린 등 나머지는 Xcode가 `GENERATE_INFOPLIST_FILE`로 만들어 그 위에 얹습니다.
> 이 파일이 `prism/` 밖에 있는 이유는, 동기화 그룹 안에 두면 리소스로도 복사되어
> "Multiple commands produce Info.plist"로 빌드가 깨지기 때문입니다.

## 다국어

화면 문구는 전부 번역 마스터([../../i18n/](../../i18n/))에서 생성됩니다. 문구를
바꾸려면 `i18n/client.csv`를 고치고 `i18n/`에서 `node scripts/generate.js`를 실행하세요 —
`Resources/Localization/`의 산출물은 직접 수정하지 않습니다.

```swift
@Environment(LocalizationStore.self) private var t
...
Text(t(.authWelcomeBack))
Text(t(.dashboardSignedInAs, ["name": user.displayName]))
```

- 키는 생성된 열거형(`MessageKey`)이라 오타·삭제된 키가 컴파일 단계에서 걸립니다.
  테이블(`Auth.xcstrings` 등)도 키가 알고 있어 호출부가 파일명을 몰라도 됩니다.
- 표시 언어는 저장된 선택 > 기기 선호 순서 > 기본 언어(en) 순으로 정해지고,
  로그인 화면의 `LocaleSwitcher`로 바꾼 값은 `UserDefaults`에 남습니다.
- **`String(localized:)`를 쓰지 않습니다.** 그 API는 시스템 언어로만 해석해서 앱 안의
  언어 선택이 먹히지 않습니다. `LocalizationStore`가 고른 언어의 `.lproj` 번들에서
  직접 읽습니다.
- 언어를 늘릴 때는 `prism.xcodeproj`의 `knownRegions`에도 코드를 추가해야 그 언어의
  `.lproj`가 번들에 생성됩니다(빠지면 그 언어만 조용히 영어로 뜹니다).

### 만료된 세션은 네트워크 계층이 되살린다

액세스 토큰은 짧아 **화면을 쓰는 도중에도 만료된다.** 갱신이 `restoreSession()`(앱 시작·
포그라운드 복귀)에만 있으면 그사이의 401은 그냥 실패로 보인다 — 세션 목록이 "불러오지
못했습니다"가 되고, 사용자가 할 수 있는 일은 앱을 껐다 켜는 것뿐이다.

그래서 `NetworkManager`가 401 + `SESSION_EXPIRED`를 만나면 `SessionRefreshing`으로 세션을
갱신하고 **새 토큰으로 한 번만** 다시 보낸다. 화면마다 처리하면 빠뜨리는 곳이 생긴다.

- 고리는 **만든 뒤에** 꽂는다(`ServiceContainer.init`의 `network.use(refresher:)`).
  생성 시점에 이으면 NetworkManager → AuthService → AuthManager → NetworkManager로 도는
  순환이 된다.
- 갱신은 `AuthManager.refreshForRetry`가 맡고 **한 번만** 나간다: 내가 실패시킨 토큰이
  이미 갈려 있으면 다른 요청이 갱신한 것이므로 그 결과를 쓴다.
- 되살릴 엔드포인트는 `APIEndpoint.retriesOnExpiredSession`이 정한다. `/auth/me`·
  `/auth/logout`은 빠진다 — 갱신 정책은 AuthManager의 것이고, 그쪽이 자기 직렬화 안에서
  부르는 호출이기 때문이다.

### 유휴 창을 미는 것은 **사용자의 요청**뿐이다

세션의 유휴 수명은 "마지막 활동으로부터"인데, 무엇이 활동인지는 클라이언트만 안다. 타이머로
미리 회전하던 때는 **앱을 켜 둔 것만으로 세션이 무한히 연장**됐다 — 유휴 만료가 있으나 마나였다.

지금은 회전이 필요할 때만 돌고(요청 직전 만료 임박 판단 · 401 대응 · 복원), 유휴 창은
`NetworkManager`가 요청에 다는 표식 하나로 갈린다.

- 사용자가 시킨 요청에는 `X-Prism-Activity: 1`이 붙는다. 서버는 **이 표식이 붙은 요청만**
  활동으로 보고 창을 민다.
- 소켓이 시킨 목록 재조회만 표식을 뺀다(`send(..., background: true)`). 다른 기기가 붙었다
  끊긴 것이 내 세션을 살려 주면 안 되기 때문이다.
- 앱 복귀의 `restoreSession()`은 표식을 **단다**. 그 경로는 `/auth/refresh`에서 끝나고 다시
  보호된 요청을 보내지 않아, 여기서 표식을 빼면 "앱을 다시 연 것"이 활동으로 세어지지 않는다.

### 세션 소켓 — 다른 기기의 변화가 화면에 닿는다

`SessionSocket`이 로그인 동안 `wss://…/socket`에 붙어 `sessionsChanged`를 받는다. 목록은
소켓이 주는 것이 아니라 그 신호를 받고 **기존 HTTP 경로로 다시 가져온다** — 회전·401 처리가
전부 그쪽에 있고, 소켓이 목록을 직접 주입하면 지난 세션의 소켓이 새 세션의 화면에 목록을
밀어 넣는 경로가 열린다.

- **이 타입은 인증 상태를 바꾸지 않는다.** 소켓이 끊기는 이유는 대부분 인증과 무관하고
  (회선·프록시·파드 재시작), 그것으로 로그아웃하면 오프라인이 곧 로그아웃이 된다.
  서버가 확정 거절을 보내와도 목록 재조회 한 번을 시킬 뿐이고, 그 401을 이미 있는 중앙
  경로(`NetworkManager` → `SessionAuthority`)가 처리한다.
- 만료(`SESSION_EXPIRED`)는 다르다 — **공유 회전**(`refreshForRetry`)을 타고 다시 붙는다.
  직접 회전하면 1회용 리프레시가 두 번 나가 재사용 탐지에 걸린다.
- 서버 하트비트가 45초 동안 없으면 죽은 것으로 보고 다시 붙는다(백오프 + 지터).
  `URLSessionWebSocketTask`는 상대가 조용히 사라진 것을 알려 주지 않는다.

`prismUITests/SessionLifetimeUITests`가 이 둘을 **실제 서버에 대고** 확인한다 — 소켓이 깨운
재조회 뒤에도 만료 시각이 그대로인지, 다른 기기에서 해제하면 손대지 않아도 로그인 화면으로
돌아오는지. `PRISM_API_URL`이 필요해 기본 테스트 계획에는 넣지 않았다.

```bash
xcodebuild test -project prism.xcodeproj -scheme prism \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:prismUITests/SessionLifetimeUITests
```

### 드로어는 **사라지는 동안의 z 순서**를 못박는다

`ZStack` 안에서 조건부로 얹은 뷰는 나갈 때 남는 콘텐츠 **뒤로** 밀린다. 대시보드의 콘텐츠는
불투명한 배경을 깔고 있어, 드로어가 미끄러져 나가는 동안이 통째로 가려졌다 — 애니메이션은
도는데 화면에는 "그냥 사라짐"으로 보였고, **닫을 때만** 웹·Android와 달랐다(열 때는 새로
얹히므로 멀쩡했다). 스크림과 드로어에 `.zIndex()`를 주어 고쳤다.

XCUITest의 요소 질의는 애니메이션이 끝나기를 기다리므로 좌표로는 이걸 볼 수 없다.
지속 시간을 3초로 늘려 탭 직후 프레임을 연달아 찍는 방법으로 확인했다.

## 디자인 토큰

색은 `Resources/Assets.xcassets/Colors`에 라이트·다크 두 벌로 들어 있고, 이름은 웹의
CSS 변수와 1:1입니다(`--color-surface` ↔ `AppColor.surface`). 치수는 코드 토큰
(`AppDimension`)입니다. 원천은 Figma → `design/tokens` → `apps/web/src/index.css`
순서이며, 뷰 안에 색·숫자를 직접 적지 않습니다.

> 예외 하나: `--color-primary`의 에셋 이름은 `BrandPrimary`입니다. `Primary`로 두면
> Xcode가 만드는 심볼이 SwiftUI의 `Color.primary`와 충돌합니다.

## 인증

소셜 전용입니다 — 이메일/비밀번호도, 가입 화면도 없습니다([../../plan/auth.md](../../plan/auth.md)).
세션 자격증명은 Keychain에만 두고, `NetworkManager`는 **쿠키를 끕니다**: 웹 흐름이
심는 세션 쿠키가 URLSession에 자동 저장되면 네이티브가 Bearer 없이도 인증되는
경로가 생겨, Keychain을 거치라는 §6 정책을 조용히 우회하게 됩니다.

| 수단   | 상태 | 비고 |
| ------ | ---- | ---- |
| Apple  | ✅ 동작 | `POST /auth/apple/native` — nonce는 요청에 해시, 서버에 원본 |
| Google | ✅ 동작 | GoogleSignIn SDK로 id_token → `POST /auth/google/native` |
| Kakao  | ✅ 동작 | Kakao SDK로 access token → `POST /auth/kakao/native` |
| Demo   | ✅ 동작 | `POST /auth/demo/native` — 시드 계정 세션을 `AuthSession`(토큰)으로 |

네 경로 모두 서버가 `AuthSession`(토큰)을 body로 주고, 앱은 그걸 Keychain(Bearer)에
담습니다 — 흐름이 하나로 통일돼 있습니다. 소셜 셋은 provider SDK로 앱 안에서 토큰을
받아 서버에 보내고, 데모는 SDK 없이 서버가 시드 계정으로 바로 세션을 발급합니다.
웹의 `/auth/demo`(쿠키)와 세션은 같고 **전달만 다릅니다** — 네이티브는 쿠키를 쓰지 않아
`/auth/demo/native`가 토큰을 body로 줍니다.

각 provider는 **native / redirect 두 방식**의 버튼으로 나뉩니다:
- **native** — provider SDK로 앱 안에서 토큰 획득(위 표).
- **redirect** — `ASWebAuthenticationSession`으로 서버 웹 OAuth(`flow=native`)를 열고,
  콜백의 일회용 코드를 `POST /auth/native/exchange`로 토큰과 교환합니다([WebAuthController.swift](prism/Features/Auth/WebAuthController.swift)).
  콜백 스킴은 `prism`(서버 `PRISM_NATIVE_AUTH_CALLBACK` 기본값 `prism://auth/callback`)이라,
  둘을 바꾸면 양쪽을 같이 맞춰야 합니다. ASWebAuthenticationSession이 콜백을 내부에서
  캡처하므로 Info.plist에 스킴 등록은 필요 없습니다.

### 네이티브 로그인 설정(빌드 전)

이 앱은 서드파티 SDK를 두 개 씁니다. **Xcode에서 SPM 패키지로 추가**해야 빌드됩니다
(File ▸ Add Package Dependencies…):

| 패키지 | URL | 링크할 프로덕트 |
| -- | -- | -- |
| GoogleSignIn | `https://github.com/google/GoogleSignIn-iOS` | `GoogleSignIn` |
| Kakao iOS SDK | `https://github.com/kakao/kakao-ios-sdk` | `KakaoSDKCommon`, `KakaoSDKAuth`, `KakaoSDKUser` |

크리덴셜/스킴은 소스에 박지 않고 **gitignore되는 `Config/Secrets.xcconfig`** 로 주입합니다
(값 자체는 공개 식별자지만 커밋 소스에서 분리). `Config/Info.plist`가 이 빌드 변수들을
참조합니다:

1. [Config/Secrets.example.xcconfig](Config/Secrets.example.xcconfig)를 같은 폴더에
   `Secrets.xcconfig`로 복사하고 값을 채운다(`Secrets.xcconfig`는 `.gitignore`됨).
2. 끝. 프로젝트의 Debug/Release는 커밋된 [Config/Base.xcconfig](Config/Base.xcconfig)를
   Configuration File로 이미 가리키고 있고, 그 파일이 `#include? "Secrets.xcconfig"`로
   옆의 시크릿을 **선택 포함**한다(없어도 빌드는 통과 — 소셜 로그인만 비활성).
   값을 고친 뒤에는 Xcode가 Info.plist를 다시 만들도록 클린 빌드(⇧⌘K)한다.

| 빌드 변수 | 용도 |
| -- | -- |
| `GOOGLE_IOS_CLIENT_ID` | Google Cloud OAuth 2.0 **iOS** 클라이언트 ID (`Info.plist`의 `GIDClientID`) |
| `GOOGLE_REVERSED_CLIENT_ID` | 위 ID의 역순(`com.googleusercontent.apps.…`) — Google redirect URL 스킴 |
| `KAKAO_NATIVE_APP_KEY` | Kakao 네이티브 앱 키 — SDK 초기화 + redirect 스킴(`kakao{앱키}`) |

- Google id_token의 audience는 **iOS 클라이언트 ID**입니다 — 서버가 이 값을 허용하도록 `PRISM_GOOGLE_NATIVE_AUDIENCES`에 iOS 클라이언트 ID를 추가하세요(웹 클라이언트 ID와 다릅니다).
- URL 스킴·`LSApplicationQueriesSchemes`·`GIDClientID`는 `Config/Info.plist`에 이미 넣어 두었습니다(값만 `Secrets.xcconfig`에서 치환).
- ⚠️ `xcconfig`는 `//` 를 주석으로 취급하므로 `https://` 같은 값은 xcconfig에 두지 마세요(`PRISM_API_URL`은 별도 빌드 설정/환경변수).
- 값이 비어 있으면 각 컨트롤러가 로그인을 시작하기 전에 거절한다 — GoogleSignIn은
  `GIDClientID`가 없을 때 Swift로 못 잡는 ObjC 예외(`You must specify |clientID| in
  |GIDConfiguration|`)로 앱을 죽이기 때문에, 크래시 대신 `signin_failed`로 떨어뜨린다.
- SDK 초기화(`KakaoSDK.initSDK`)와 redirect 처리(`onOpenURL`)는 [SocialSDK.swift](prism/Features/Auth/SocialSDK.swift)·[prismApp.swift](prism/App/prismApp.swift)에 배선돼 있습니다.

## 참고

- 인증 기획·계약: [../../plan/auth.md](../../plan/auth.md)
- 서버 계약 원천: `apps/server/libs/common/src/types/contracts.ts`
  오류 코드·provider 상수는 거기서 **생성**됩니다(`Domain/Models/Auth/Contracts.gen.swift`,
  `apps/server`에서 `pnpm gen:contracts`). 모델 struct·디코더·UI 열거형은
  `AuthContracts.swift`에 손으로 유지합니다. 드리프트는 `pnpm check:contracts`가 잡습니다.
