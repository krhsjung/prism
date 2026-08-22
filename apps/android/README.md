# android

Prism Android 클라이언트 — Jetpack Compose + Kotlin Coroutines.

## 실행

Android Studio로 열거나 명령줄로:

```bash
./gradlew :app:assembleDebug          # 디버그 APK
./gradlew :app:testDebugUnitTest      # JVM 유닛 테스트 (55개)
./gradlew :app:installDebug           # 실행 중인 기기/에뮬레이터에 설치
```

## 구조

피처-우선(feature-first): **인증 피처**는 `feature/auth/` 한 곳에 오케스트레이션 + 화면이
모여 있고, 공유 커널(계약)·인프라(core)·디자인시스템·앱 셸은 공유 위치에 둔다. 대시보드가
붙으면 `feature/dashboard/`가 같은 자리에 슬롯인한다.

```text
app/src/main/java/kr/hs/jung/prism/
├── PrismApplication.kt         # DI 컨테이너 소유
├── MainActivity.kt             # 테마 해석 + attachBaseContext 언어 적용
├── feature/
│   └── auth/                   # 인증 피처
│       │                       #   AuthManager · AuthApi — 상태 머신 + 전송
│       │                       #   LoginViewModel · LoginScreen · AuthOption — 화면
│       │                       #   social/ — SocialSignIn 추상 + Google·Kakao 네이티브 SDK
│       │                       #   WebAuth · WebAuthActivity — Custom Tabs redirect(flow=native)
│   └── dashboard/              # 대시보드 피처
│       │                       #   SessionsApi — /auth/sessions* 전송
│       │                       #   DashboardViewModel · DashboardScreen — 셸 + 활성 세션 카드
│       │                       #   Timestamps — 화면 언어의 시각 표기
├── core/                       # 공유 인프라
│   ├── di/ServiceContainer.kt  # 의존성 조립
│   ├── i18n/                   # 언어 선택 + 협상
│   ├── network/                # ApiClient(OkHttp, Bearer 전용) · ApiError · 디코딩
│   ├── security/SecureStore    # EncryptedSharedPreferences
│   ├── theme/                  # PrismColors(토큰) · Dimensions · ThemeStore
│   └── util/AppLog.kt
├── domain/model/               # 공유 API 계약 (Contracts + Contracts.gen)
└── ui/                         # 공유 UI + 앱 셸
    ├── component/              # PrismButton · PrismCard · PrismBadge · PrismAvatar · 스위처
    └── RootScreen.kt           # 인증 상태가 화면을 고른다(라우팅)
```

> 계약(`domain/model`)과 제네릭 네트워킹(`core/network`)은 **공유 커널**로 남긴다 —
> 전송 계층과 다른 피처가 함께 쓰고, 피처가 이들에 의존하되 역방향 의존은 없다.

## API 주소

주소는 소스에 박지 않고 빌드 설정 `PRISM_API_URL`에서 `BuildConfig`로 흘려보낸다 —
웹의 `VITE_API_URL`·iOS의 `PRISM_API_URL`과 같은 역할이다.

```bash
./gradlew :app:assembleDebug -PprismApiUrl=https://<도메인>
# 또는 환경변수
PRISM_API_URL=https://<도메인> ./gradlew :app:assembleDebug
```

비어 있으면 **디버그는 배포된 개발 서버**(iOS `APIConfiguration.developmentURL`과 같은
주소)로 떨어진다 — 기기에 그냥 설치해도 로그인이 동작한다. 에뮬레이터 루프백(10.0.2.2)을
기본으로 두면 실기기에서는 자기 자신을 가리켜 아무 데도 닿지 않기 때문이다. 릴리스는
기본값이 없어(빈 값) 주소를 빠뜨린 릴리스 빌드가 빌드 시점에 실패한다.

호스트에서 서버를 직접 띄웠다면 주소를 덮어쓴다:

```bash
./gradlew :app:installDebug -PprismApiUrl=http://10.0.2.2:3000   # 에뮬레이터
```

평문 HTTP는 [network_security_config.xml](app/src/main/res/xml/network_security_config.xml)이
`10.0.2.2`·`localhost`에만 예외로 허용한다 — 실기기에서 개발 머신의 LAN 주소
(`http://192.168.x.x:3000`)로 붙이려면 그 호스트를 여기 **추가해야** 한다. 운영
도메인(https)은 이 목록과 무관하다.

## 다국어

화면 문구는 전부 번역 마스터([../../i18n/](../../i18n/))에서 생성된다. 문구를 바꾸려면
`i18n/client.csv`를 고치고 `i18n/`에서 `node scripts/generate.js`를 실행한다 — 산출물은 직접 고치지
않는다. 생성물은 **전용 소스셋** `app/src/generated/res`에 들어가고(손으로 쓴 `res/`와
섞이지 않아 잔재 정리가 안전하다), `build.gradle.kts`의 `sourceSets`가 등록한다.

```kotlin
Text(stringResource(R.string.auth_welcome_back))
```

- 리소스 이름은 `[a-zA-Z0-9_]`만 되므로 키의 점을 언더스코어로 바꾼다
  (`auth.welcome_back` → `R.string.auth_welcome_back`). `R.string` 자체가 컴파일
  타임에 검증된다.
- 표시 언어는 저장된 선택 > 기기 선호 순서 > 기본 언어(en) 순이고, 로그인 화면의
  언어 스위처로 바꾼 값은 `SharedPreferences`에 남는다.
- **언어 적용은 `MainActivity.attachBaseContext`에서 한다.** `stringResource`는 시스템
  언어로만 해석하므로, 선택한 언어로 Activity의 리소스를 통째로 덮어써야 화면 문구는
  물론 **팝업·드롭다운까지** 그 언어를 따른다(Compose의 `CompositionLocal` 덮어쓰기는
  별도 윈도우인 팝업에 닿지 않는다). 그래서 언어를 바꾸면 `recreate()`로 이 경로를
  다시 탄다 — 세션 상태는 Application 컨테이너에 있어 사라지지 않는다.

### 당겨서 새로고침은 `refresh()`를 탄다

`PullToRefreshBox`가 도는 동안 알리는 것은 `DashboardUiState.refreshing` 하나이고, 목록은
건드리지 않는다 — 인디케이터가 이미 "받았다"를 말하고 있어 목록까지 비우면 화면만 흔들린다.
실패해도 `finally`에서 인디케이터를 멈춘다. 기본 인디케이터 색은 material 기본 팔레트를
쓰므로(우리는 몇 개 역할만 덮어썼다) `PullToRefreshDefaults.Indicator`에 우리 색을 준다.

### 로그인 뒤 화면의 ViewModel은 **세션**에 붙는다

`viewModel()`의 기본 소유자는 Activity다. 로그아웃해서 화면이 사라져도 인스턴스는 남고,
다시 로그인하면 팩토리를 부르지 않은 채 그것을 돌려준다 — `init`의 최초 로드도 다시 돌지
않아 **앞 세션의 목록이 새 세션 화면에 그대로 그려진다.** 실제로 그렇게 보였다.

그래서 `ui/SessionScope.kt`가 세션마다 `ViewModelStore`를 갈아 끼우고, 갈아 끼울 때 앞
저장소를 비운다(각 ViewModel의 `onCleared()`까지 불린다). 세션의 경계는
`AuthManager.State.SignedIn.generation`이 정한다 — **새 로그인에서만 오르고, 복원·토큰
갱신에서는 그대로**다. 복원마다 올리면 포그라운드로 돌아올 때마다 목록이 깜빡인다.

> iOS·웹에는 이 문제가 없다. iOS는 `signedOut`을 지나며 뷰가 파괴돼 `@State`가 새로
> 만들어지고, 웹은 라우트가 언마운트된다. 화면 상태를 화면보다 오래 살리는 것은 Android의
> `ViewModel`뿐이다.

### 선택 메뉴는 `DropdownMenu`가 아니라 `Popup`이다

테마·언어 스위처(`ui/component/PreferenceSwitchers.kt`)는 material3의 `DropdownMenu`를
쓰지 않는다. 그쪽 배치 규칙은 "트리거 아래 아니면 트리거 위"뿐이라, 드로어처럼 **옆으로**
펴야 하는 자리를 표현할 수 없다 — 세로 여백이 조금만 모자라면(실기기에서 9px) 메뉴가
트리거에서 떨어져 위로 날아갔다.

그래서 `Popup` + `PreferenceMenuPosition`으로 배치를 직접 정한다. 껍데기(모서리·테두리·
그림자)는 `MenuDefaults`와 같은 값을 써서 생김새는 그대로다. 규칙은 축마다 다르다 —
**펴는 축**은 자리가 없으면 반대쪽으로 뒤집고, **트리거에 걸어 두는 축**은 뒤집지 않고
화면 안으로 당긴다(웹의 `min()` 클램프·iOS `.popover`와 같다).

## 디자인 토큰

색은 [PrismColors](app/src/main/java/kr/hs/jung/prism/core/theme/PrismTheme.kt)에 라이트·다크
두 벌로 있고, 이름·값은 웹의 CSS 변수와 1:1이다(`--color-surface` ↔ `PrismColors.surface`).
치수는 [PrismDimensions](app/src/main/java/kr/hs/jung/prism/core/theme/PrismDimensions.kt)다.
원천은 Figma → `design/tokens` → `apps/web/src/index.css` 순서이며, Compose에는 색을
직접 적지 않는다.

## 앱 아이콘

원본은 **iOS 앱 아이콘**([AppIcon-1024.png](../ios/prism/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png))이다 —
두 앱의 아이콘이 갈라지지 않도록 한쪽을 원본으로 삼는다. 네이비 그라디언트 + 흰 P.

- 어댑티브 아이콘(API 26+)은 벡터 두 겹이다: [배경](app/src/main/res/drawable/ic_launcher_background.xml)(그라디언트)
  + [전경](app/src/main/res/drawable/ic_launcher_foreground.xml)(P). 전경은 **가운데 72
  안전 영역**에만 글자를 둔다 — 런처마다 마스크 모양이 달라 가장자리는 잘릴 수 있다.
- 전경은 `monochrome` 레이어로도 함께 쓰여, 테마 아이콘(모노크롬)에서 시스템이 색을 입힌다.
- `mipmap-*/ic_launcher{,_round}.webp`는 어댑티브를 못 쓰는 **API 24·25용** 레거시
  비트맵이다(minSdk가 24라 필요하다). 원본 PNG에 둥근 사각·원 마스크를 씌워 밀도별로 뽑았다.

## 인증

소셜 전용이다 — 이메일/비밀번호도, 가입 화면도 없다([../../plan/auth.md](../../plan/auth.md)).

| 수단   | 상태 | 비고 |
| ------ | ---- | ---- |
| Google | ✅ 동작 | Credential Manager로 id_token → `POST /auth/google/native`(Bearer 세션). **크리덴셜 설정 필요**(아래) |
| Kakao  | ✅ 동작 | Kakao SDK로 access token → `POST /auth/kakao/native`(Bearer 세션). **크리덴셜 설정 필요**(아래) |
| Demo   | ✅ 동작 | `POST /auth/demo/native` — 시드 계정 세션을 `AuthSession`(토큰)으로. 설정 없이 바로 된다 |
| Apple  | ✅ 동작 | 네이티브 SDK가 없어 **redirect 전용** — Custom Tabs로 서버 웹 OAuth(`flow=native`) → 코드를 `POST /auth/native/exchange`로 교환 |

모든 로그인이 서버에서 `AuthSession`(토큰)을 body로 받는 **네이티브(Bearer)** 흐름 하나로
통일돼 있다 — 쿠키를 쓰지 않는다(iOS와 동일). Google·Kakao는 웹 redirect가 아니라
네이티브 SDK로 앱 안에서 토큰을 받아 서버에 보내고(redirect가 다른 앱에 가로채이는 문제를
피한다, plan/auth.md §4.1), 데모는 SDK 없이 서버가 시드 계정으로 바로 세션을 발급한다.
서버가 준 세션은 [SessionTokenStore](app/src/main/java/kr/hs/jung/prism/core/security/SessionTokenStore.kt)(SecureStore)에
담고 `Authorization: Bearer`로 쓴다.

**Apple에는 native 버튼을 두지 않는다** — 안드로이드에는 공식 네이티브 Sign in with Apple
SDK가 없어(plan/auth.md §9) 눌러도 "사용할 수 없다"만 뜨는 버튼이 된다. 대신 redirect
경로 하나만 남긴다(`AuthManager.signIn`의 native/APPLE 분기는 방어용으로 남아 있다).

### 네이티브 로그인 설정(빌드 전)

크리덴셜은 커밋 소스에 두지 않는다. 값은 **`secrets.properties`**(gitignore 대상)에 넣고,
채울 항목은 커밋된 [secrets.example.properties](secrets.example.properties)에 적혀 있다 —
iOS의 `Config/Secrets.xcconfig` ↔ `Secrets.example.xcconfig`와 같은 짝이다.

```bash
cp apps/android/secrets.example.properties apps/android/secrets.properties
# 값을 채운다. 파일이 없거나 비어 있어도 빌드는 그대로 되고, 해당 provider만 비활성이다
# (데모 로그인은 설정 없이 동작한다).
```

우선순위는 **gradle 프로퍼티(`-P…`) > 환경변수 > `secrets.properties`**다 — CI는 환경변수로
주고, 일회성 빌드는 `-P`로 덮어쓴다. 항목은 셋이다:

| 값 | gradle 프로퍼티 / 환경변수 | 용도 |
| -- | -- | -- |
| Google 서버(웹) 클라이언트 ID | `prismGoogleServerClientId` / `PRISM_GOOGLE_SERVER_CLIENT_ID` | Credential Manager `serverClientId`. id_token audience가 되어 서버 검증 대상과 일치해야 한다 |
| Kakao 네이티브 앱 키 | `prismKakaoNativeAppKey` / `PRISM_KAKAO_NATIVE_APP_KEY` | Kakao SDK 초기화 + redirect 스킴(`kakao{앱키}://oauth`) |
| API 주소(선택) | `prismApiUrl` / `PRISM_API_URL` | 위 [API 주소](#api-주소) 절 참고. 비우면 debug는 배포된 개발 서버로 떨어진다 |

**값만으로는 부족하다 — 각 콘솔에 이 앱을 등록해야 한다.** 네이티브 SDK는 호출한 앱이
누구인지를 패키지명 + 서명 지문으로 확인하기 때문이다(웹의 redirect 도메인 등록에 해당).

| 콘솔 | 등록할 것 |
| -- | -- |
| Google Cloud ▸ 사용자 인증 정보 | **Android** 유형 OAuth 클라이언트 — 패키지 `kr.hs.jung.prism` + 서명 SHA-1. 서버 검증 대상은 그대로 웹 클라이언트 ID이므로, 앱에 넣는 값(`prismGoogleServerClientId`)은 여전히 **웹** 쪽이다 |
| Kakao developers ▸ 플랫폼 ▸ Android | 패키지 `kr.hs.jung.prism` + 키 해시(SHA-1을 base64로 옮긴 값) |

디버그 키스토어(`~/.android/debug.keystore`)의 지문은 이렇게 뽑는다:

```bash
keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore \
  -storepass android -keypass android | grep SHA1        # Google Cloud에 넣을 값
# 위 SHA-1을 Kakao 키 해시로 변환
echo "<SHA1>" | tr -d ':' | xxd -r -p | openssl base64    # Kakao에 넣을 값
```

> 릴리스 서명 키로 빌드하면 지문이 달라진다 — 그때는 릴리스 키의 SHA-1/키 해시도 같은
> 자리에 **추가로** 등록한다.

#### 네이티브 로그인이 안 될 때

거절은 **로그인 창을 띄운 뒤에** 온다 — 계정 선택·동의까지 정상으로 보이다가 그 다음에
실패하므로, 화면만 봐서는 크리덴셜 값이 틀린 것처럼 보인다. 원인마다 화면과 로그가
다르고, 특히 Google은 **아무 오류도 뜨지 않는다**:

| provider | 화면 | `prism` 태그 로그 | GMS 로그(Google만) |
| -- | -- | -- | -- |
| Google (지문 미등록) | 계정 선택 시트가 뜨고, 계정을 고르면 그냥 닫힌다(오류 문구 없음) | `google sign-in cancelled (…TYPE_USER_CANCELED)` | `UNREGISTERED_ON_API_CONSOLE` |
| Google (지문은 등록됨) | 계정을 고르면 "로그인하지 못했습니다" | `google credential request failed (…)` | `Developer console is not set up correctly` |
| Google (기기에 계정 없음) | 고를 계정이 없이 "로그인하지 못했습니다" | `no google account available on this device` | — |
| Kakao | 카카오톡/카카오계정 로그인이 뜨고, 동의 후 "로그인하지 못했습니다" | `kakao … login failed (AuthError:Misconfigured/401)` | — |
| Kakao (카카오톡만) | 카카오톡이 잠깐 떴다가 카카오계정 웹 로그인으로 넘어간다(로그인 자체는 성공) | `kakaotalk login failed (AuthError:Unknown/302/NotSupportError)` | 콘솔 아님 — 아래 참고 |

Google의 두 번째 줄은 지문 문제가 아니다. 대개 `prismGoogleServerClientId`에 **웹이 아닌**
클라이언트 ID(Android/iOS 유형)를 넣은 경우다 — Credential Manager는 `serverClientId`로
**웹** 클라이언트만 받는다. 값이 어느 유형인지는 콘솔을 열지 않고도 확인할 수 있다:

```bash
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=<확인할 ID>" -d "code=bogus" -d "grant_type=authorization_code"
# "client_secret is missing." → 웹(기밀) 클라이언트  ← serverClientId에 넣을 값
# "Malformed auth code."     → 공개 클라이언트(Android/iOS) ← 넣으면 안 되는 값
```

서버가 실제로 쓰는 웹 클라이언트 ID는 리다이렉트 응답에서 그대로 읽힌다 — 앱에 넣을 값과
같아야 한다(그래야 `PRISM_GOOGLE_NATIVE_AUDIENCES` 없이 통과한다):

```bash
curl -sI "$PRISM_API_URL/auth/google?flow=native" | grep -i ^location
```

세 번째 줄(`NoCredentialException`)은 콘솔과 무관하다 — 기기에 Google 계정이 하나도 없는
경우다. 계정을 추가하거나 redirect·데모 경로로 로그인하면 된다.

Google이 조용한 이유는 Play 서비스가 콘솔 설정 오류(`UNREGISTERED_ON_API_CONSOLE`)를
앱에는 **사용자 취소**로 돌려주기 때문이다 — 취소는 오류가 아니라 조용한 복귀이므로
(iOS와 같은 규칙) 화면에 아무것도 남지 않는다. 진짜 원인은 GMS 로그에만 있다:

```bash
adb logcat -s prism:V                                  # 앱이 남긴 카테고리
adb logcat | grep -E "UNREGISTERED_ON_API_CONSOLE|Auth.Api.Credentials"   # GMS 원인
```

> **삼성 기기는 `Log.d`를 기본으로 버린다** — `prism` 태그 로그가 하나도 안 보이면 앱이
> 아니라 기기 설정 탓이다. `adb shell setprop log.tag.prism VERBOSE`로 열고 다시 재현한다.

같은 provider의 `redirect` 버튼은 이 등록과 무관하게(웹 OAuth라 서명 지문을 보지 않는다)
끝까지 동작한다 — **native만 실패하고 redirect는 되면** 서버·크리덴셜 값이 아니라 콘솔
등록을 의심할 자리다.

Kakao의 마지막 줄은 **실패가 아니고 콘솔 문제도 아니다** — 원인은 **카카오톡 앱에 로그인된
계정이 없는 것**이다. 간편로그인은 카카오톡의 로그인 세션을 빌려 쓰는 것이라 그 세션이 없으면
카카오톡이 `NotSupportError`로 거절하고, `KakaoSignInClient`가 카카오계정 웹 로그인으로 폴백해
로그인은 끝까지 된다(Kakao 표준 패턴). 카카오톡에 로그인하면 그다음부터는 브라우저 없이
간편로그인만으로 끝난다.

`isKakaoTalkLoginAvailable()`은 **설치 여부만** 본다 — 로그아웃된 카카오톡에서도 true라서,
간편로그인을 시도한 뒤에야 알 수 있다. 폴백이 있는 이유가 이것이다.

카카오톡 로그인 여부는 호스트에서도 확인된다 — 카카오톡은 로그인돼 있을 때만 SSO 계정을
등록한다(앱 화면만 봐서는 구분되지 않으니 이쪽이 정확하다):

```bash
adb shell dumpsys account | grep -i "kakao"   # Account {type=com.kakao.sdk.kakaotalk.sso.account} 유무
```

키 해시 문제와 헷갈리지 않게: 키 해시는 **웹 폴백의 토큰 교환에서** 검증되므로, 폴백이
성공했다면 키 해시·패키지명 등록은 이미 맞다(그 경우 `Misconfigured/401`이 뜬다).

- Google id_token의 audience는 **웹(서버) 클라이언트 ID**다 — 서버의 기본 audience(`PRISM_GOOGLE_CLIENT_ID`=웹 클라이언트 ID)와 같으면 `PRISM_GOOGLE_NATIVE_AUDIENCES` 없이도 통과한다.
- Kakao SDK(v2)는 Maven Central이 아니라 Kakao 저장소에 있어 `settings.gradle.kts`에 저장소를 추가해 두었다.
- 카카오톡 앱 로그인 복귀를 위해 `AndroidManifest.xml`에 `AuthCodeHandlerActivity`(스킴 `kakao{앱키}`)와 `com.kakao.talk` 패키지 가시성 `<queries>`를 등록해 두었다.

> **쿠키를 쓰지 않는다** — `ApiClient`의 OkHttp는 CookieJar를 두지 않는다(기본
> `NO_COOKIES`). 서버 웹 흐름이 심는 세션 쿠키가 자동 저장·전송되면 네이티브가 Bearer
> 없이도 "어쩌다" 인증되는, Keystore를 우회하는 경로가 생기기 때문이다(iOS `NetworkManager`와
> 같은 이유, plan/auth.md §6). 데모도 `/auth/demo/native`가 토큰을 body로 주므로 다른
> 네이티브 경로와 똑같이 Bearer로 유지된다 — 만료되면 `/auth/refresh`로 회전한다.

## 참고

- 인증 기획·계약: [../../plan/auth.md](../../plan/auth.md)
- 서버 계약 원천: `apps/server/libs/common/src/types/contracts.ts`
  오류 코드·provider 상수는 거기서 **생성**된다(`domain/model/Contracts.gen.kt`,
  `apps/server`에서 `pnpm gen:contracts`). 모델·디코더·UI 열거형은 `Contracts.kt`에 손으로
  유지한다. 드리프트는 `pnpm check:contracts`가 잡는다.
