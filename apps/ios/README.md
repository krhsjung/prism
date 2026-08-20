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

유닛 테스트는 `prismTests`에 48개(계약 디코딩 · Keychain · AuthManager 상태 전이)입니다.

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
