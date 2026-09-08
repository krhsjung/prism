# Auth — 인증 흐름 기획

소셜 로그인(Google + Apple + Kakao) 기반 인증 시스템. 이메일/비밀번호 인증 없이,
첫 로그인 시 자동으로 계정이 생성되는 단순한 구조.

추가로, **포트폴리오 리뷰어(채용 담당자 등)가 개인 SNS 계정을 연동하지 않고도
앱을 체험**할 수 있도록 **원클릭 데모 로그인**을 제공한다. 데모 버튼은
미리 시드된 고정 계정(`provider='demo'`)으로 즉시 세션을 발급하므로 진입
마찰이 0이다. ID/PW 방식 대신 데모 버튼을 택한 이유는, 비밀번호 해싱·재설정·
레이트리밋 등을 어설프게 구현하면 오히려 감점 요소가 되고 리뷰어 타이핑 마찰도
남기 때문이다.

> **개인정보 미저장** — 서버 DB에는 이름·이메일 등 개인정보를 저장하지 않는다.
> `provider` 종류와 가명 식별자(`provider_id`, OAuth sub)만 보관하며, 표시 이름은
> 로그인 시 소셜 토큰에서 추출해 **서버 세션 레코드(Redis)에만** 담는다(DB에도, JWT에도
> 넣지 않는다 — 세션 만료와 함께 사라진다). JWT엔 식별자(`sub`·세션 id)뿐이라 쿠키가
> 유출돼도 이름이 읽히지 않는다. 이 사실을
> 로그인 화면에도 문구로 노출해 리뷰어가 안심하고 체험하도록 한다.

## 1. 범위

- Continue with Google
- Continue with Apple
- Continue with Kakao
- **Try the demo (원클릭 데모 로그인 — 시드된 데모 계정 세션 발급)**
- 자동 회원가입 (첫 로그인 시 서버에서 사용자 upsert)
- 로그아웃

---

## 2. 사용자 흐름

### 2.1 Happy Path

1. 사용자가 Login 화면 진입
2. `Continue with Google`·`Continue with Apple`·`Continue with Kakao` 중 클릭
3. 화면 Loading 상태 — 클릭된 버튼 text → "Connecting...", 모든 버튼 Disabled
4. OAuth 제공자 페이지로 리다이렉트
5. 사용자가 제공자에서 인증 / 동의
6. 서비스로 콜백 — 서버가 ID token 검증 + 사용자 생성/식별 (upsert)
7. 클라이언트에 access token 발급 → Dashboard로 이동

### 2.1-b 데모 로그인 (원클릭)

1. 사용자가 Login 화면에서 `Try the demo` 클릭
2. 클릭된 버튼 text → "Connecting...", 모든 버튼 Disabled (소셜과 동일 패턴)
3. 클라이언트가 데모 로그인 호출 (외부 리다이렉트 없음) — 웹은 `POST /auth/demo`(쿠키),
   네이티브는 `POST /auth/demo/native`(Bearer 토큰을 body로)
4. 서버가 시드된 데모 계정(`provider='demo'`, `provider_id='demo-001'`)으로
   JWT 발급 → 즉시 Dashboard로 이동

### 2.2 Error Paths

| 시나리오                         | 처리                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| 사용자가 OAuth 페이지에서 cancel | Default 화면으로 복귀 (alert 없음)                                           |
| 제공자 인증 실패 (token 무효)    | Error 화면 + alert: "Couldn't sign you in. Try again or use another method." |
| 서버 측 에러 (5xx)               | Error 화면 + alert: "Server error. Please try again in a moment."            |
| 네트워크 끊김                    | Error 화면 + alert: "Connection lost. Check your network."                   |

---

## 3. 화면 (Figma)

[Auth 페이지](https://www.figma.com/design/sTDo6HDslOcRmWL78klk1I/Prism) —
6개 시안: Desktop / Mobile × Default / Error / Loading.

| 시안    | 핵심 요소                                                                           |
| ------- | ----------------------------------------------------------------------------------- |
| Default | Brand · Welcome back · Google · Apple · **Try the demo** · **개인정보 미저장 문구** |
| Error   | + Red Alert (Molecule/Alert variant=Error)                                          |
| Loading | 클릭된 버튼 → "Connecting...", 모든 버튼 Disabled state                             |

> 데모 버튼은 소셜 버튼 바로 아래(카드 최하단)에 배치한다. 시각적으로 부차
> 액션이므로 `Atom/Button` Variant=Secondary(소프트 필)로 두어 Apple(Primary)·
> Google(Outline)과 구분하면서 위계는 한 단계 낮춘다. 라벨: `Try the demo`.
>
> **가입 화면 없음** — Google/Apple은 첫 로그인 시 자동 가입(upsert), 데모는 시드
> 계정을 쓰므로 별도 Sign up 플로우가 존재하지 않는다. 따라서 로그인 카드에는
> "Don't have an account? Sign up" 푸터나 "No sign-up needed" 류 문구를 두지 않는다.
>
> **개인정보 미저장 문구** — 카드 최하단에 muted 캡션으로 노출한다. 영문 UI에 맞춰
> "This portfolio stores no personal data." (Body/Small · muted text color). 6개
> 시안 전부에 동일 배치.

### 컴포넌트 의존성

| 화면 요소      | 디자인 시스템 매핑                                                            |
| -------------- | ----------------------------------------------------------------------------- |
| Google 버튼    | `Atom/Button` — Variant=Outline, State=Default \| Disabled                    |
| Apple 버튼     | `Atom/Button` — Variant=Primary, State=Default \| Disabled                    |
| Kakao 버튼     | `Atom/Button` — Variant=Kakao(브랜드 노랑 #FEE500), State=Default \| Disabled |
| 데모 버튼      | `Atom/Button` — Variant=Secondary, State=Default \| Disabled                  |
| 에러 알림      | `Molecule/Alert` — Variant=Error                                              |
| 카드 (Desktop) | 토큰: `--color-card`, `--color-border`, `elevation/lg`                        |

---

## 4. 기술 아키텍처

```text
┌────────────┐    OAuth     ┌─────────────┐
│  Client    │ ───────────▶ │  Provider   │
│  (web/iOS/ │              │  Google /   │
│   Android) │ ◀─────────── │  Apple      │
└────┬───────┘  code/idToken└─────────────┘
     │ POST /auth/{provider}
     │ { idToken }
     ▼
┌────────────┐
│  Server    │ — ID token 검증 · 사용자 upsert · JWT 발급
│  (NestJS)  │
└────────────┘
```

### 4.1 플랫폼별 OAuth 방식

| 플랫폼                    | OAuth 방식                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Web                       | OAuth 2.0 redirect flow — 서버가 `/auth/{provider}/callback` 처리, ID token을 서버에서 직접 교환                                    |
| Android/iOS (네이티브 앱) | provider 네이티브 SDK로 토큰을 받아 `/auth/{provider}/native`에 POST — Apple=`identityToken`, Google=`idToken`, Kakao=`accessToken` |

> **왜 `/native` 엔드포인트가 있는가(설계 근거).** 웹 redirect 흐름은 콜백을 커스텀
> 스킴/앱 링크로 앱에 되돌리는데, Android에서는 이 redirect가 다른 앱(YouTube·Gmail 등
> 구글 계열)의 인텐트 필터에 가로채여 앱으로 돌아오지 못하고 "앱 선택" 창이 뜨는 문제가
> 실제로 관측됐다. 그래서 네이티브 앱은 provider 네이티브 SDK로 **앱 안에서** 토큰을 받아
> 서버에 POST하고, 서버가 그 토큰을 검증해 Bearer 세션(`AuthSession`)을 발급한다(§5 `/native`).
>
> 네이티브 앱(`apps/ios`·`apps/android`)이 실제로 쓰는 SDK:
>
> | provider | iOS(Swift)                                 | Android(Kotlin)                | 서버에 보내는 값              |
> | -------- | ------------------------------------------ | ------------------------------ | ----------------------------- |
> | Google   | GoogleSignIn-iOS                           | Credential Manager + Google ID | `idToken`                     |
> | Kakao    | kakao-ios-sdk                              | `com.kakao.sdk:v2-user`        | `accessToken`                 |
> | Apple    | Sign in with Apple(AuthenticationServices) | — (공식 네이티브 SDK 없음)     | `identityToken` + raw `nonce` |
>
> Google id_token의 audience는 플랫폼별로 다르다 — iOS는 iOS 클라이언트 ID, Android는
> `serverClientId`(웹 클라이언트 ID). 서버 `PRISM_GOOGLE_NATIVE_AUDIENCES`에 필요한 값을
> 더한다. 각 앱의 크리덴셜/빌드 설정은 `apps/{ios,android}/README.md` 참고.

### 4.2 서버 라이브러리

- `@nestjs/passport` + `passport-google-oauth20` (web redirect 흐름용)
- `jose` (Apple identityToken/id_token JWS 검증 + client_secret ES256 서명)
- `google-auth-library` (네이티브에서 받은 Google ID token 검증 — 서명·iss·exp·audience)
- Kakao access token은 별도 라이브러리 없이 `access_token_info`로 발급 앱(app_id)을 대조한 뒤 `user/me` 조회
- `@nestjs/jwt` — HS256, 1시간 만료 JWT 발급

---

## 5. API 컨트랙트

### `POST /auth/google`

**Body**: `{ idToken: string }`
**Response 200**: `{ accessToken: string, user: User }`
**Response 401**: `{ error: 'INVALID_TOKEN' }`

### `POST /auth/apple`

웹 redirect 흐름 — 동일 구조 (`{ idToken: string }`).

### `POST /auth/apple/native`

iOS 네이티브 Sign in with Apple 전용. 첫 로그인에만 `user` 필드가 포함됨. 단,
**개인정보 미저장 정책에 따라 이름/이메일은 영구 저장하지 않는다** — 받은 이름은
해당 세션의 표시 이름으로만 쓰고 DB에는 넣지 않는다. (Apple은 이름을 첫 로그인에
한 번만 주므로 이후 세션에는 표시 이름이 없을 수 있고, 그때는 일반 라벨로 대체.)

**Body**:

```ts
{
  identityToken: string;       // Apple JWS — 서버에서 signature 검증
  nonce: string;               // 필수 — SDK 요청에 쓴 raw nonce. 서버가 SHA-256 해시로
                               //   id_token의 nonce 클레임과 대조해 재생 공격을 막는다.
                               //   (클라이언트는 요청엔 해시, 서버엔 raw를 보낸다)
  user?: {                     // 첫 로그인에서만 옵션으로 전달
    name?: { firstName: string; lastName: string };
  };
}
```

> ⚠️ 이메일은 요청하지 않는다(개인정보 미저장). `authorizationCode`(refresh token 교환)는
> v1에서 쓰지 않는다 — 세션·리프레시는 서버가 자체 발급한다(아래 Response).

**Response 200**: `AuthSession` = `{ accessToken, refreshToken, user }` — 네이티브는 쿠키가
아니라 이 토큰들을 받아 안전한 저장소(iOS Keychain)에 보관하고 `Authorization: Bearer`·
`POST /auth/refresh`(body)로 쓴다. (§6 저장 정책·[contracts.ts](../apps/server/libs/common/src/types/contracts.ts) `AuthSession`)
**Response 401**: `{ error: 'INVALID_TOKEN' }` — `identityToken`·`nonce` 누락, 서명·nonce 불일치 포함

### `POST /auth/google/native`

Flutter 앱의 `google_sign_in` 네이티브 로그인 전용. code 교환 없이 SDK가 준 `idToken`을
서버가 Google 공개 키로 검증한다(서명·`iss`·`exp` + `aud`가 우리 앱의 audience 중 하나와
일치). 다른 앱을 위해 발급된 id_token은 audience 불일치로 통과하지 못한다.

**Body**: `{ idToken: string }` — SDK의 `GoogleSignInAuthentication.idToken`
**Response 200**: `AuthSession` = `{ accessToken, refreshToken, user }` (Bearer 저장·사용, apple/native와 동일)
**Response 401**: `{ error: 'INVALID_TOKEN' }` — `idToken` 누락·서명·audience 불일치 포함

> audience는 웹 `PRISM_GOOGLE_CLIENT_ID` + 선택값 `PRISM_GOOGLE_NATIVE_AUDIENCES`(콤마 구분).
> Android `google_sign_in`은 `serverClientId`(웹 클라이언트 ID)로 받은 id_token이라 기본
> audience(웹 clientId)로 검증되고, 플랫폼별 클라이언트 ID를 쓰는 구성만 추가 audience가 필요하다.

### `POST /auth/kakao/native`

Flutter 앱의 `kakao_flutter_sdk_user` 네이티브 로그인 전용. Kakao access token은 (Google/Apple의
id_token과 달리) 서명이 없는 불투명 문자열이라 로컬 검증이 불가능하다 — 서버가
`access_token_info`로 이 토큰의 발급 앱(`app_id`)이 우리 앱(`PRISM_KAKAO_APP_ID`)과
일치하는지 확인한 뒤 `user/me`로 프로필을 읽는다. app_id 대조가 다른 앱 토큰의 재사용을
막는 유일한 방어라, `PRISM_KAKAO_APP_ID` 미설정 시 이 엔드포인트는 항상 실패한다.

**Body**: `{ accessToken: string }` — SDK의 `OAuthToken.accessToken`
**Response 200**: `AuthSession` = `{ accessToken, refreshToken, user }`
**Response 401**: `{ error: 'INVALID_TOKEN' }` — `accessToken` 누락·만료·app_id 불일치 포함

### 네이티브 웹-redirect (`flow=native`) + `POST /auth/native/exchange`

네이티브 앱이 provider SDK 대신 **웹 OAuth**로 로그인하는 경로(iOS
`ASWebAuthenticationSession` 등). 같은 provider를 SDK(native)·웹(redirect) 두 방식으로
비교/제공하려는 용도다.

1. 앱이 시스템 웹 세션으로 `GET /auth/{provider}?flow=native`를 연다.
2. 서버는 평소 웹 흐름대로 provider로 redirect하고 콜백을 처리한다. 단 `flow=native`면
   세션을 **쿠키로 심지 않고**, 일회용 코드를 만들어 커스텀 스킴으로 돌려준다:
   `prism://auth/callback?code=<code>` (실패/취소는 `?error=<code>` 또는 파라미터 없음).
   코드는 Redis에 짧게(120s) 저장되고 **1회용**(GETDEL)이다.
3. 앱이 그 코드를 교환한다:

   **`POST /auth/native/exchange`** — **Body** `{ code: string }`
   **Response 200**: `AuthSession = { accessToken, refreshToken, user }`
   **Response 401**: `{ error: 'INVALID_TOKEN' }` — 코드 누락·없음·이미 소진.

> 토큰을 URL에 싣지 않는다(로그·유출 위험) — 코드만 넘기고 HTTPS로 교환하는
> authorization-code 방식이다. 콜백 스킴은 `PRISM_NATIVE_AUTH_CALLBACK`(기본
> `prism://auth/callback`)이며 앱이 등록/캡처하는 스킴과 같아야 한다.

### `POST /auth/demo`

원클릭 데모 로그인. 외부 OAuth 없이 시드된 데모 계정으로 즉시 세션을 발급.

**Body**: 없음
**Response 200**: `SessionUser` = `{ user, accessTokenTtlMs }` — `user.provider === 'demo'`.
세션은 **HttpOnly 쿠키**로 심고(응답 body엔 토큰을 담지 않는다 — 소셜 콜백·`/auth/refresh`의
쿠키 흐름과 동일), 웹은 쿠키로 인증되고 `accessTokenTtlMs`로 "만료 임박"을 판단한다(§6).
**Response 503**: `{ error: 'DEMO_DISABLED' }` — 데모 비활성화 환경(`AUTH_DEMO_ENABLED=false`)일 때

> 서버는 시드된 `provider='demo' / provider_id='demo-001'` 계정을 조회해 세션을
> 발급한다. 새 계정을 만들지 않으므로 모든 리뷰어가 동일 데모 계정을 공유한다.
>
> 이 쿠키 흐름은 **웹 전용**이다. 네이티브(iOS·Android)는 아래 `/auth/demo/native`를 쓴다.

### `POST /auth/demo/native`

네이티브(Bearer) 데모 로그인. `/auth/demo`와 **세션 발급은 같고**(같은 `issueDemoSession`),
전달만 다르다 — 토큰을 body로 준다.

**Body**: 없음
**Response 200**: `AuthSession` = `{ accessToken, refreshToken, user }` — `user.provider === 'demo'`.
쿠키를 심지 않는다(네이티브는 쿠키를 쓰지 않고 Bearer를 안전 저장소에 담는다, §6).
**Response 503**: `{ error: 'DEMO_DISABLED' }` — 데모 비활성화 환경일 때

> 쿠키를 심지 않으므로 login-CSRF 대상이 아니라 `WebOriginGuard`를 두지 않는다(레이트리밋만).
> iOS·Android 모두 이 경로로 데모를 실동작시키며, 세션은 소셜 네이티브와 동일하게
> Keychain/Keystore(Bearer)에 담기고 `/auth/refresh`(body 토큰)로 회전한다.

### `GET /auth/me`

**Header**: `Authorization: Bearer <accessToken>`
**Response 200**: `SessionUser` = `{ user, accessTokenTtlMs }`
**Response 401**: `{ error: 'SESSION_EXPIRED' | 'INVALID_TOKEN' | 'UNAUTHORIZED' }`

> `accessTokenTtlMs`는 액세스 토큰 서명 수명(비밀·PII 아님)으로, 클라이언트가 요청을
> **보내기 직전에** "곧 만료인가"를 판단하는 데 쓴다(§6의 (2); 타이머 예약은 2026-08-24에
> 걷어냈다). 웹은 HttpOnly라 exp를 못 읽고, **네이티브는 토큰을 열어 보지 않는다** — 앱이
> 토큰을 파싱하기 시작하면 서명 검증 없이 클레임을 믿는 경로가 생긴다. 그래서 쿠키 흐름의
> `SessionUser`와 네이티브의 `AuthSession` **둘 다** 이 필드를 싣는다. 로그인·복원·회전
> 응답 모두에 실려, 로그인 직후부터 그 판단을 할 수 있다.
>
> 401은 세 가지로 나뉜다. 클라이언트가 `POST /auth/refresh`를 시도할지 판단하는
> 근거이기 때문이다 — 세션 쿠키가 HttpOnly라 그 판단을 서버만 내릴 수 있다.
>
> - `SESSION_EXPIRED` — 액세스 토큰 만료. **갱신하면 살아난다**(유일하게 갱신할 값어치가 있는 401)
> - `INVALID_TOKEN` — 서명이 깨진 토큰(변조·쿠키 주입). 갱신 대상 아님
> - `UNAUTHORIZED` — 자격증명 없음(첫 방문) 또는 세션이 이미 폐기됨. 갱신해도 같은 이유로 실패

### `POST /auth/logout`

**Response 204** — 단순 구현 시 클라이언트가 토큰 폐기만 (서버는 stateless).

### 모델

```ts
type User = {
  id: string;
  provider: "google" | "apple" | "kakao" | "demo";
  displayName: string; // 소셜 토큰에서 추출해 서버 세션(Redis)에 담김 — DB·JWT 미저장(세션 한정)
  createdAt: string;
};
```

> `email`은 수집·저장하지 않으므로 모델에 없다(OAuth 스코프에서도 요청하지 않는다).
> `displayName`은 DB 컬럼도 JWT 클레임도 아니라 **서버 세션 레코드(Redis)**에서 채워지며,
> 세션이 만료되면 함께 사라진다. 데모 세션은 서버가 상수 `"Demo User"`를 부여한다.

---

## 6. 세션 정책

세션의 진실은 토큰이 아니라 **서버 세션(Redis)** 이다. 매 요청 세션 행을 확인하므로
로그아웃·강제 폐기가 다음 요청부터 즉시 반영된다(서명만 보면 만료까지 폐기할 방법이 없다).

| 항목                | 정책                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| Access Token        | JWT (HS256). 수명 `PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN` (기본 15분)             |
| Refresh 자격증명    | `<sessionId>.<secret>` 난수 32B. **저장은 SHA-256 해시만**. 쓸 때마다 회전    |
| idle 만료 (sliding) | `PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN` (기본 12시간). 갱신할 때마다 다시 채워짐 |
| absolute 상한       | 7일 고정. 활동이 있어도 여기서 끝 — 리프레시 무한 연장을 막는다               |
| 저장 위치 (Web)     | HttpOnly 쿠키. 운영은 `__Host-` 접두어 + `Secure` + `SameSite=Lax`            |
| 쿠키 이름           | `prism_session` / `prism_refresh`. `PRISM_COOKIE_NAMESPACE`로 앱별 분리 가능  |
| 저장 위치 (iOS)     | Keychain (일반 `UserDefaults` 금지)                                           |
| 저장 위치 (Android) | 하드웨어 기반 Keystore / EncryptedSharedPreferences (일반 preferences 금지)   |

> 네이티브는 자격증명을 로그에 남기지 않는다. 액세스 토큰은 `Authorization: Bearer`로,
> 리프레시 자격증명은 `POST /auth/refresh`의 body로만 오간다.
>
> **sliding은 "요청이 있는 동안" 밀린다.** idle 창을 다시 채우는 것은 회전(`POST
/auth/refresh`)이고, 부르는 경로는 **요청 하나**뿐이다:
> **(1) 반응형** — 요청이 401(`SESSION_EXPIRED`)을 만나면 한 번 갱신하고 재시도,
> **(2) 보내기 전 선제** — 요청을 보내려는데 액세스 토큰이 만료 여유(5초) 안이면 그 자리에서
> 먼저 회전하고 보낸다. 둘은 **같은 single-flight 문**을 쓰므로 겹쳐도 `/auth/refresh`는
> 한 번만 나간다([api.ts](../apps/web/src/lib/api.ts) · 네이티브는 `refreshForRetry`).
> (2)는 정확성이 아니라 최적화다 — 없어도 (1)이 받아 낸다.
>
> ### 결정 번복(2026-08-24): 타이머 선제 갱신을 걷어냈다
>
> 이전에는 `accessTokenTtlMs`의 75% 지점마다 **타이머로** 회전을 예약해, 요청이 없어도
> 탭만 열려 있으면 세션이 absolute 상한까지 밀렸다. 그것을 되돌린다.
>
> **이유는 idle 타임아웃을 스스로 무력화하기 때문이다.** idle TTL의 목적은 "아무도 안 쓰면
> 끊는다"인데, 타이머가 계속 돌면 자리를 비운 기계에 탭이 열려 있는 **가장 흔한 상황**에서
> 바로 그 통제가 사라진다. 12시간짜리 idle 세션이 탭 하나 때문에 7일을 산다.
>
> 그 대가로 얻던 것은 "유휴 탭을 계속 로그인 상태로 둔다" 하나뿐이었다. 지연(요청→401→
> 갱신→재시도 3왕복)은 (1)이 이미 자동으로 처리해 사용자 눈에 보이지 않고, 그마저도
> 이제 (2)가 대부분 없앤다.
>
> **결과**: 유휴 상태에서는 회전 트래픽이 **0**이고, 방치된 화면은 idle 창이 지나면
> 정직하게 만료돼 로그인 화면으로 간다(아래 §8). 세션이 정말 끝났다는 사실은 세션
> 소켓이 재연결에 실패하며 끌고 온다([dashboard.md](./dashboard.md)).

> ### 결정(2026-08-27): **미는 것은 회전이 아니라 활동이다**
>
> 타이머를 걷어내고도 같은 구멍이 남아 있었다. 세션 소켓이 `sessionsChanged`를 뿌리면
> 화면이 목록을 다시 부르는데, 액세스 수명이 짧으면 그 재조회는 거의 매번 회전을 태우고
> 회전은 idle 창을 다시 채운다. 그 신호는 **다른 기기가 붙거나 끊길 때마다** 나가므로,
> 기기가 둘이면 서로가 서로의 세션을 영원히 살려낸다 — 사용자는 아무것도 하지 않았는데
> 유휴 만료가 이름만 남는다(실제로 그렇게 관측됐다).
>
> 처음에는 회전에 성격을 달아(`background`) "배경 회전은 밀지 않는다"로 막았다. **그것은
> 틀렸다.** 회전과 활동은 1:1이 아니기 때문이다 — 회전은 single-flight라 하나로 합쳐지는데,
> 배경 회전에 사용자 요청이 합류하면 그 사용자의 활동이 통째로 사라진다. 유휴 창 끝자락에서
> "방금 눌렀는데 몇 초 뒤 로그아웃"이 되는 자리다(코드 리뷰에서 드러났다).
>
> → **회전은 자격증명 교체만 한다. 창을 미는 것은 활동이고, 활동은 "인증된 요청이 서버에
> 닿는 것"이다.** 그래서 미는 일을 `JwtAuthGuard`로 옮겼다.
>
> - **회전은 이제 절대 밀지 않는다**(`rotate`는 남은 수명을 그대로 두고 값만 교체한다 —
>   Redis의 `SET ... KEEPTTL`). 누가 왜 회전시켰는지 그 자리에서는 알 수 없기 때문이다.
> - **미는 것은 `SessionsRepository.touch`뿐이다.** 세션 본체·리프레시 자격증명·사용자
>   인덱스 score를 **한 원자 구간에서 함께** 민다. 셋이 갈리면 살아 있는데 목록에 없거나
>   (전체 폐기가 놓친다) 목록에는 있는데 죽은 세션이 된다. score는 **Redis 시계**로 찍고
>   (앱 시계로 찍으면 왕복 시간만큼 이른 값이 남아 그 틈에 목록이 산 세션을 놓친다),
>   건너뛸지는 **가장 적게 남은 키**로 판단한다(키 하나만 보면 다른 키의 임박을 놓친다).
> - **판단은 요청이 나른다**: `X-Prism-Activity: 1`이 붙은 요청만 민다. 화면 진입 ·
>   당겨서 새로고침 · 해제/전체 로그아웃 · 앱 복원이 그렇고, **소켓 신호로 목록을 다시
>   가져오는 요청 하나만** 표시를 달지 않는다.
> - **표시가 없으면 밀지 않는다(fail-closed).** 반대로 두면 안 되는 이유가 있다: 우리
>   도메인의 등록 가능 도메인이 PSL에 없어 다른 `*.asuscomm.com` 호스트가 전부 우리와
>   same-site다. 그들이 `<img>`·최상위 이동으로 유발한 GET에도 `SameSite=Lax` 세션 쿠키가
>   실려 오는데, "표시 없음 = 활동"이라면 그 요청이 **남의 세션을 상한까지 살려 준다**
>   (응답을 읽지 못해도 수명은 늘어난다). 커스텀 헤더는 그런 요청이 붙일 수 없다 —
>   단순 요청은 헤더를 못 달고, fetch로 달면 프리플라이트가 CORS 허용 출처에서 막힌다.
>   §6.2의 `WebOriginGuard`가 POST에 대해 하는 일을, 이 표시가 GET에 대해 한다.
> - **회전도 표시를 받는다.** 네이티브 앱의 복원은 `/auth/me`가 만료로 실패하면
>   `/auth/refresh`로 끝나고 다시 보호된 요청을 보내지 않는다 — 그래서 그 회전에 표시가
>   붙어 있으면 서버가 회전 뒤 창도 민다. 표시가 없는 회전(소켓이 시킨 것)은 밀지 않는다.
> - **합류 문제가 구조적으로 사라진다.** 회전이 누구 것이든 사용자의 요청은 **자기 자신이**
>   가드를 지나며 창을 민다 — 더 이상 "누가 회전을 시작했는가"에 달려 있지 않다.
> - **표시는 권한이 아니다.** 거짓말을 해도 자기 세션을 덜 살려 달라는 요청일 뿐이라,
>   남의 세션에도 더 오래 사는 쪽으로도 쓸 수 없다.
> - 활동마다 쓰기 셋이 붙지 않도록, 창이 `TOUCH_MIN_INTERVAL_MS`(10초)만큼 줄어든 뒤에만
>   실제로 민다 — 정확성이 아니라 쓰기 절약이다.
>
> ⚠️ **회전은 Lua로 Redis 안에서 일어난다.** `keepTtl`은 `PTTL`로 남은 수명을 확인만 하고
> 값 교체는 `KEEPTTL`로 한다 — 초 단위로 읽어 되쓰면 1ms 미만이 잘려 만료 직전에 오히려
> 창이 가득 차는(고치려던 버그가 되살아나는) 자리가 생긴다. 남은 수명이 양수가 아니면
> **아무것도 바꾸지 않고 실패한다.** 이 갈래는 실제 Redis를 요구하는 통합 스펙에서만
> 검증되므로(`PRISM_REDIS_URL`), 그 스위트를 건너뛴 채로 이 코드를 고치지 않는다.

> **남겨 둔 문제(추적 중)** — 회전은 서버에서 **응답을 주기 전에** 자격증명을 교체한다.
> 그 응답이 유실되면(타임아웃·연결 끊김) 클라이언트는 이미 소비된 옛 값만 들고 남고,
> 서버는 후속 자격증명을 다시 내주지 않는다. 유예 창(§6.1) 밖에서 다시 제시하면 재사용
> 탐지에 걸려 세션이 폐기된다. 활동 표시가 붙은 회전은 응답 전에 밀기 한 번이 더 들어가
> 그 창이 아주 조금 넓어진다. 이번 라운드의 유휴 창 문제와는 별개의 **가용성** 문제라
> 여기 적어 두고 따로 고친다 — 제대로 된 답은 회전에 멱등 재생(같은 시도의 재요청이
> 이미 만든 후속 자격증명을 돌려받는 것)을 두는 것이다.

### 6.1 리프레시 재사용 탐지

회전만으로는 탈취가 **드러나지 않는다**. 옛 자격증명이 거부되기만 하면, 공격자가 먼저
회전시킨 뒤 피해자가 실패하는 상황과 단순 오류가 구분되지 않는다.

그래서 소비된 자격증명의 해시를 세션별 이력으로 남기고, 나중에 제시된 값이 그 이력에
있으면 "이미 쓴 값을 또 쓴다"는 신호로 읽는다(RFC 9700 refresh token reuse).

| 제시된 값                              | 판정       | 세션      |
| -------------------------------------- | ---------- | --------- |
| 현재 자격증명                          | `rotated`  | 유지·연장 |
| 30초 이내에 소비된 값                  | `raced`    | **유지**  |
| 30초가 지나 소비된 값                  | `reused`   | **폐기**  |
| 이력에 없는 값 · 없는 세션 · 상한 초과 | `rejected` | 유지      |

- **유예 창(30초)** 이 있는 이유 — 회전이 끝나기 전에 이미 출발한 요청이 직후에 도착하는
  정상 경합이 있다. 브라우저의 쿠키 항아리는 하나뿐이라 stale 값을 들고 있을 수 있는
  시간은 "요청 하나의 왕복"뿐이므로, 창을 크게 잡을 이유가 없다(크게 잡으면 탐지만 늦어진다).
- **이력에 없는 값은 폐기하지 않는다** — 세션 id는 자격증명의 앞부분이라 유출되기 쉽다.
  발급된 적 없는 값까지 폐기 신호로 보면 아무 문자열이나 붙여 남의 세션을 끊을 수 있다(폐기 DoS).
  폐기는 "한때 유효했음을 증명한" 값에만 적용한다.
- **이력 깊이는 최근 128개**(`CONSUMED_HISTORY_LIMIT`) — 소비된 해시를 세션당 이 개수만
  유지한다. 너무 작으면 짧은 시간에 여러 번 회전한 뒤 stale 값이 도착할 때 옛 해시가
  이력에서 밀려나 `reused`가 `rejected`로 오판돼 **탐지 구멍**이 생긴다(그래서 1로 줄이면
  안 된다). 너무 크면 메모리만 늘 뿐, 탐지 정확도 이득은 동시 in-flight 자격증명 수에서
  포화한다. 웹 단일 클라이언트의 동시성을 넉넉히 덮는 값으로 128을 둔다.
- **응답으로는 구분해 주지 않는다** — 탐지됐다는 사실 자체가 공격자에게 줄 정보다.
  서버 로그에만 보안 이벤트로 남기고, 클라이언트에는 평범한 401을 돌려준다.
- 탐지 시에는 쿠키도 정리한다. 세션이 이미 죽어 보호할 "성공한 탭"이 없고,
  남겨두면 죽은 쿠키로 매 요청 401을 반복하게 된다.

### 6.2 서비스 간 경계 — 발급은 하나, 검증은 공유

auth 서비스가 세션을 **발급**하고, 모든 서비스가 그 세션을 **검증**한다.
검증에 쓰이는 것(토큰 서명 규칙 · 쿠키 이름 · 가드)은 전부 `@app/session` 한 곳에 있다 —
서비스마다 따로 두면 인증의 원천이 둘이 되고, 한쪽만 고쳐지는 순간 그게 구멍이 된다.

| 위치            | 담는 것                                                                           |
| --------------- | --------------------------------------------------------------------------------- |
| `@app/session`  | 세션 토큰 서명/검증 · 세션·리프레시 쿠키 이름/속성 · `JwtAuthGuard` · `@Public()` |
| `services/auth` | 로그인·세션 발급 · OAuth 흐름(state 토큰 · nonce 쿠키) · 갱신 · 폐기              |
| `services/api`  | 도메인 기능. 세션은 검증만 한다                                                   |

**api 서비스는 기본이 보호다(protected-by-default).** 전역 가드(`APP_GUARD`)가 걸려 있어
새로 추가한 엔드포인트는 아무것도 하지 않아도 인증을 요구하고, 공개 경로만 `@Public()`로
표시한다(현재는 `/healthz`뿐).

라우트마다 가드를 붙이는 반대 방향이었다면 **빠뜨린 라우트가 조용히 공개**되고,
그 사실이 코드에 드러나지도 않는다 — 리뷰에서 "없는 것"을 알아채야 하기 때문이다.
이쪽은 공개가 눈에 보인다.

> 인증(누구인가)과 인가(그럴 권한이 있는가)는 별개다. 전역 가드는 인증까지만 하고,
> 리소스 소유권·역할 검사는 각 핸들러나 전용 가드가 맡는다
> (예: 세션 개별 폐기는 `revokeOwnedSession`이 소유자 범위를 확인한다).

### 6.3 네이티브 세션 상태 머신 (iOS·Android 공통 규칙)

네이티브 클라이언트는 "저장된 자격증명으로 서버에 세션을 물어보고, 그 답으로 화면
상태를 정하는" 작은 상태 머신이다. iOS·Android가 **저장 모델이 달라**(iOS는
Bearer/Keychain, Android 데모는 쿠키/EncryptedSharedPreferences) 구현은 다르지만,
아래 **규칙(불변식)은 동일**하다. 규칙을 어기면 세션 부활·유효 세션 파괴·재로그인
같은 정합성 버그가 생긴다 — 이 표는 그 규칙을 글로 고정해 두 플랫폼을 정렬한다.

**상태:** `Checking`(시작 직후 확인 중) → `SignedOut` | `SignedIn(user)`.
시작이 `Checking`인 이유: 자격증명이 있다는 사실만으로 로그인 화면을 그리면 원격에서
폐기된 세션이 한 프레임 통과한다. 진실은 서버에 있으므로 `GET /auth/me`로 확인한 뒤 정한다.

**전이:**

| 트리거                                                        | 처리                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| 앱 시작·포그라운드 복귀                                       | 저장된 자격증명으로 `GET /auth/me`. 없으면 `SignedOut`             |
| `/auth/me` 200                                                | `SignedIn(user)`                                                   |
| `/auth/me` 401 `SESSION_EXPIRED`                              | `POST /auth/refresh`로 이어감(갱신하면 살아난다)                   |
| `/auth/me`·`/auth/refresh` 401 `INVALID_TOKEN`·`UNAUTHORIZED` | **확정 실패** — 자격증명 폐기 후 `SignedOut`                       |
| 그 밖의 실패(오프라인·타임아웃·5xx·형식 오류)                 | **일시적 실패** — 자격증명 **보존**, `SignedOut`(다음 시도에 복구) |
| 로그인(데모/소셜) 성공                                        | 자격증명 저장 후 `SignedIn`                                        |
| 로그아웃                                                      | 로컬 자격증명 폐기 + 서버 세션 폐기, `SignedOut`                   |

**불변식 (플랫폼별 구현이 반드시 지켜야 하는 것):**

1. **일시적 실패는 자격증명을 지우지 않는다.** 확정 실패(위 표의 401 두 코드)에만
   지운다 — 오프라인으로 앱을 켰다고 유효 세션을 파괴하면 안 된다.
2. **세션 연산은 직렬화한다.** 포그라운드 복귀마다 복원이 시작되므로, 두 복원이 같은
   1회용 갱신 자격증명을 동시에 써 세션을 잃는(재사용 탐지) 것을 막는다.
3. **부수효과(refresh 회전)가 있는 네트워크 호출은 취소하지 않는다.** 서버는 응답을 주기
   전에 회전하므로, 취소로 응답을 버리면 회전된 새 값을 잃는다. 회전 응답을 받으면
   "우리가 보낸 값이 아직 저장소의 현재 값일 때만" 저장한다(그사이 로그아웃/새 로그인이
   값을 바꿨으면 낡은 응답이라 버린다). **화면 상태 반영만** 최신 여부 가드를 통과한다.
4. **로그아웃 의도는 durable하게, 취소·중단에도 남긴다.** 사용자가 로그아웃을 눌렀는데
   네트워크 대기 중 화면 회전 등으로 코루틴/태스크가 취소돼도, 로컬 세션은 반드시
   정리돼야 한다. 정리는 다른 연산과 **끼어들지 않게**(경쟁으로 부활하지 않게) 한다.
5. **저장소 읽기 실패를 "없음"으로 오인하지 않는다.** 일시적 읽기 오류를 "자격증명 없음"
   으로 뭉개면, 옛 값으로 마이그레이션하거나 로그아웃 마커를 놓쳐 세션이 부활한다.
6. **자격증명 폐기는 로그아웃 화면과 함께 durable해야 한다.** 서버 로그아웃·로컬 삭제가
   모두 실패하는 극단에서는 거짓 `SignedOut`을 게시하지 않는다(재시도 가능하게 두고,
   서버가 이미 폐기했다면 다음 확인이 self-healing으로 정리).
7. **요청은 보내는 시점의 세션 표식을 달고 나간다.** 401의 뒷일(갱신·재시도·세션 종료)은
   **그 표식의 세션이 아직 현재일 때만** 한다. 응답이 돌아오기 전에 로그아웃하고 다시
   로그인하면 그 401은 끝난 세션의 것인데, 토큰만 비교해서는 "회전됐다"와 구분되지 않아
   옛 요청이 새 세션의 토큰으로 재생되거나 방금 만든 세션을 끊는다. 웹은 쿠키가 자동으로
   실려 나가 비교할 토큰조차 없으므로 표식이 유일한 방벽이다.

   표식은 **보낼 토큰과 짝지어** 발급한다(네이티브). 부르는 쪽이 토큰을 읽은 뒤 표식을
   받기까지 사이에 세션이 갈릴 수 있어, 표식만 새로 찍으면 옛 토큰이 새 세션의 이름표를
   달고 나간다. 짝이 맞는지는 **이 세션이 발급한 토큰인가**로 본다 — 지금 값뿐 아니라
   회전으로 막 물러난 것도 포함한다. 함께 나간 두 요청 중 하나가 먼저 회전시켰다고
   나머지를 남의 세션으로 보면, 되살릴 수 있는 401이 그냥 실패가 되기 때문이다.

   그 "발급 기록"은 **회전이 속한 세대**에 적는다. 회전이 네트워크에 매달린 사이 새
   로그인이 시작되면 세대는 이미 올라가 있어, 지금 세대에 적으면 끝난 세션의 토큰이 다음
   세션의 이름표를 받는다. 같은 이유로 iOS는 **사용자 액션이 도는 동안 표식을 아예 주지
   않는다** — 세대는 액션 시작에 오르지만 자격증명은 채택 시점에야 갈리므로, 그 사이는
   "어느 세션으로 끝날지 모르는" 구간이다(Android는 세대와 토큰이 `adopt` 안에서 락을 쥔 채
   함께 갈려 이 구간이 없다).
8. **쓰는 도중의 갱신 실패는 사용자를 쫓아내지 않는다.** 갱신 한 번의 결과는
   `회전 / 확정 거부 / 판단 불가(오프라인·5xx) / 앞질러짐` 넷으로 나뉘고, **무엇을 할지는
   부르는 쪽이 정한다**: 앱 시작의 복원은 확인이 안 되면 로그인 화면을 보여야 하지만,
   화면을 쓰는 도중의 401 갱신은 잠깐 끊긴 것만으로 로그인 화면으로 보내면 안 된다.
   거꾸로 **확정 거부는 반드시 로그인 화면으로 보낸다** — 갱신·재시도까지 거부된 세션을
   화면이 "불러오지 못했습니다"로 덮으면 죽은 세션의 목록이 그대로 남는다.
9. **뒤늦게 도착한 회전도 자기 세션의 것일 때만 반영한다.** 요청을 보낼 때 잡아 둔 표식을
   응답이 돌아왔을 때 대조한다 — 그사이 로그아웃·재로그인이 끝나 있으면 옛 응답이 새 세션의
   자격증명을 덮어쓰거나, 끝난 세션을 되살리려는 요청이 나간다.

   반대 방향도 같다: **정리는 소유권을 확인한 뒤에 한다.** 앞 세션의 자격증명을 버리려다
   소유권 확인보다 먼저 지금 세션의 상태를 건드리면, 정작 아무것도 버리지 않으면서 멀쩡한
   세션만 망가뜨린다.
10. **회전은 한 번에 하나만, 그리고 같은 세션끼리만 나눠 쓴다.** 복원(`/auth/me`가 만료를
    만났을 때)과 401 재시도가 각자 회전하면 **1회용** 리프레시 자격증명을 둘이 동시에 써서
    재사용 탐지(§6)에 걸린다. 반대로 세대를 가리지 않고 합류시키면 남의 확정 거부가 멀쩡한
    내 세션을 끊는다 — 표식이 같은 회전에만 얹힌다.
11. **로그인 화면의 안내는 아는 것만 말한다.** 스스로 로그아웃한 것이 아닌데 로그인
    화면으로 왔다면 한 줄 알려 준다 — 대시보드를 보다가 아무 말 없이 튕기면 이동이
    실패한 것처럼 보인다. 다만 **원인은 단정하지 않는다.** 서버는 폐기·만료·로그아웃을
    모두 `UNAUTHORIZED` 하나로 알려주고(`jwt-auth.guard.ts`의 `findValid`가 null이면 셋
    다다), 폐기는 Redis 키를 지울 뿐 흔적을 남기지 않아 사후에 구분할 방법이 없다.

    알릴지는 **어느 경로가 발견했는지가 아니라 무엇을 보고 있었는지**로 정한다. 같은
    만료를 복원·소켓·화면 요청이 **동시에** 발견할 수 있어, 경로로 정하면 누가 먼저
    처리하느냐에 따라 같은 상황이 조용했다 시끄러웠다 한다 — 먼저 끝낸 쪽이 자격증명을
    치워 버려 뒤늦게 온 쪽은 손댈 것이 없기 때문이다. 그래서 규칙은 하나다:

    > **로그인된 화면에서 세션이 확정적으로 끝났으면 알린다.**

    - **앱을 켤 때(복원)의 실패는 알리지 않는다** — 아직 로그인된 화면이 아니었다. 그
      자리는 자격증명이 아예 없는 첫 방문과 같은 화면이라 설명할 것이 없다.
    - **확인이 안 된 것(오프라인·5xx)에도 알리지 않는다.** 세션이 끝났다고 말할 수 없다.
    - **스스로 누른 로그아웃도 알리지 않는다.** 자기가 누른 버튼의 결과다. 이 의도는
      **락·서버 응답을 기다리기 전에** 세워야 한다 — 기다리는 사이 만료가 먼저 발견되면
      그쪽이 먼저 정리해 버려, 누른 사람에게 사고 통지가 뜬다. 성공한 로그아웃은 그 사이
      올라간 안내도 내린다. 겹쳐 눌릴 수 있는 곳에서는 의도를 **세어** 둔다(웹) — 한쪽의
      실패가 아직 진행 중인 다른 로그아웃의 의도까지 내리면 안 된다.
    - **다시 로그인하면 지운다.** 남겨두면 다음에 스스로 로그아웃했을 때도 "세션이
      종료되었습니다"가 뜬다.

    누가 발견하든 답이 같으므로 세 플랫폼이 같고, **순서에도 흔들리지 않는다.**

    > 원인을 나누려면 서버가 폐기 시점에 짧은 수명의 표식을 남기고(`deleteOwned`·
    > `deleteAllForUser`), **아는 원인만** 실어 보내면 된다. 다만 그때도 최상위 코드를
    > 바꾸지 말고 `UNAUTHORIZED`에 선택적 필드를 더한다 — 옛 클라이언트는 모르는 필드를
    > 무시하므로 양방향으로 안전하게 낡는다. 필수 필드를 더했다가 앱 로그인이 막힌 적이
    > 있다(`103d77c`). 지금은 하지 않는다: 구분되는 창은 액세스 토큰이 아직 살아 있는
    > 구간뿐이고, idle(12h)이 액세스(15m)보다 훨씬 길어 그 창은 사실상 absolute 상한
    > (7일)에서만 열린다.
12. **일시적 실패는 상태를 바꾸지 않는다.** 오프라인·5xx로 회전이 실패한 것은 "세션이
    끝났다"가 아니다 — 자격증명을 지우거나 로그인 화면으로 보내지 않고 그대로 둔다. 다음
    요청이 다시 회전을 시도하고(§6의 (1)·(2)), 소켓은 백오프로 다시 붙는다. 타이머로
    예약해 두고 그 타이머가 소모되는 구조였다면 여기서 재예약이 필요했지만, 그 타이머는
    2026-08-24에 걷어냈다.

**플랫폼 매핑 (같은 규칙, 다른 기전):**

| 규칙                | iOS                                                                                  | Android                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| #2 직렬화           | generation 카운터 + single-flight `restoreTask`                                      | `Mutex`로 세션 연산 감쌈                                                                     |
| #3 회전 저장        | `KeychainManager.save`, "현재 refresh == 보낸 값" 확인                               | 쿠키 흐름은 서버가 `Set-Cookie`로 회전(CookieJar가 반영)                                     |
| #4 로그아웃 durable | Keychain `revoked` 마커로 자격증명을 **덮어씀**(삭제 아님) — 앱 종료·재설치에도 유지 | `withContext(NonCancellable)` + 정리를 락 **안**에서(경쟁·취소 방어), 쿠키는 `SecureStore`에 |
| #5 읽기 실패 구분   | `RawReadResult { data \| notFound \| failure }`                                      | CookieJar는 메모리 캐시 + 암호화 저장, 읽기 실패 시 빈 상태로 시작                           |
| #6 극단 처리        | 마커도 삭제도 실패하면 현재 상태 유지                                                | revoke·clear 모두 실패면 `SignedOut` 미게시(현재 상태 유지)                                  |
| #7 세션 표식        | `generation` + `supersededTokens`. `@MainActor`라 한 호출 안의 읽기가 원자적이다      | `@Volatile SessionStamp(mark, issued)` — 참조 하나를 한 번 읽어 표식과 토큰을 같이 얻는다   |
| #8 갱신 결과 분기   | `RotateOutcome { rotated, rejected, inconclusive, superseded }`                       | `RotateOutcome { ROTATED, REJECTED, INCONCLUSIVE }`                                          |
| #10 회전 single-flight | `sharedRotate` — 세대별 `rotateTask`                                              | `Mutex` 하나가 복원·재시도를 같은 문으로 모은다                                              |
| #11 안내 판정       | `publishSignedOut()` — `state`가 `.signedIn`이었을 때만(로그아웃은 `authActionInFlight`가 막는다) | `clearTokensAndSignOut()` — 직전 상태가 `SignedIn`이고 `signOutRequested`가 아닐 때만        |
| #12 재시도 간격     | `RefreshSchedule.retryDelayMs`(테스트가 주입)                                        | `RETRY_REFRESH_DELAY_MS`(가상 시계로 검증)                                                   |

> **웹의 #12**는 `rotateNow`가 `RefreshResult.rejected`를 보고 갈린다: 확정 거부만
> 재검증(`/auth/me`)으로 넘기고, 오프라인·5xx는 화면을 그대로 둔 채 60초 뒤 다시 건다.
> 예전에는 둘을 구분하지 않아 **잠깐 끊긴 것이 곧 로그아웃**이었다.
>
> **웹의 #11**은 `endSignedInSession(definitive)`이다 — `signedIn` ref로 "로그인된 화면을
> 보고 있었는가"를 읽는다(`useCallback`이 붙잡은 `state`는 낡는다).
>
> **웹의 표식**은 `AuthProvider`의 `sessionMark` ref다. 기존 `generation`은 **진행 중인
> 확인을 무효화**하는 용도라 `/auth/me`마다 오르므로 이 자리에 쓸 수 없다 — 표식은
> 로그인·로그아웃·원격 종료처럼 **세션의 정체가 갈릴 때만** 오르고, 복원·회전은 같은
> 세션을 잇는 것이라 값을 바꾸지 않는다.

> 이 불변식들은 iOS(테스트 47개)·Android(32개)의 회귀 테스트로 고정돼 있다. 세션 로직을
> 고칠 때는 이 표를 먼저 읽고, 두 플랫폼에 같은 규칙이 유지되는지 확인할 것.

---

## 7. 보안 체크리스트

- [ ] HTTPS only (production)
- [ ] Apple/Google ID token signature 검증 (서버)
- [ ] OAuth `state` parameter (CSRF 방어 — web redirect 흐름)
- [ ] Replay attack 방지 (token nonce / iat 검증)
- [ ] **개인정보 미저장** — DB(`core.users`)에 이름/이메일 등 PII 컬럼 없음
      (provider · provider_id · 타임스탬프만). 표시 이름은 서버 세션(Redis)에만,
      email은 OAuth 스코프에서도 요청하지 않음.
- [ ] PII 로그 금지 (displayName 등 마스킹 — 로그·에러 트래킹 포함)
- [ ] JWT secret을 환경 변수로만 관리
- [ ] **데모 계정 격리** — 데모 세션은 파괴적/민감 작업 차단(읽기 위주 또는
      샌드박스), 공유 계정이므로 PII 입력 금지. `AUTH_DEMO_ENABLED` 플래그로
      운영 환경에서 토글 가능하게.
- [ ] **데모 레이트리밋** — `/auth/demo`·`/auth/demo/native` 남용 방지(IP당 분당 N회).

---

## 8. 오픈 이슈

- **세션 만료 UX** — 회전은 **요청이 있을 때만** 일어나므로(§6), 방치된 화면은 idle 창이
  지나면 만료된다. 그때 자동 재로그인 대신 Login 화면으로 보낸다(단순) — "세션이
  종료되었습니다"가 이유를 남긴다. 조용한 자동 재로그인은 향후 검토.
- **Android의 Sign in with Apple** — Android에는 공식 네이티브 Sign in with Apple SDK가
  없어, Apple만 **redirect 전용**이다(Custom Tabs로 서버 웹 OAuth `flow=native`를 열고
  일회용 코드를 토큰과 교환). 누를 수 없는 native 버튼을 두지 않고 로그인 화면에서 뺐다.
  Google·Kakao·데모는 네이티브(Bearer) 응답으로 실동작한다.
- **Apple credential state 확인(iOS)** — Sign in with Apple의 opaque 사용자 식별자
  (`credential.user`)를 저장해 두면 앱 시작·포그라운드 복귀 때
  `ASAuthorizationAppleIDProvider.getCredentialState(forUserID:)`로 Apple에서 인증이
  철회(`.revoked`)됐는지 확인해 선제적으로 로그아웃할 수 있다. v1은 서버 세션 검증
  (`GET /auth/me`)에만 의존하므로, Apple 계정 연결을 끊어도 서버 세션 만료 전까지는
  로컬이 로그인 상태로 남는다. 개인정보 미저장 정책상 저장하는 식별자는 표시 이름·
  이메일이 아닌 provider sub에 해당하는 opaque 값이라 정책과 상충하지 않는다 — 별도
  슬라이스로 검토.
- **provider 식별자** — 동일 이메일이지만 다른 provider로 두 번 가입하면?
  v1은 별도 계정으로 처리. 향후 account linking으로 통합.
- **Apple 이름/이메일** — Apple은 첫 로그인 시 한 번만 이름/이메일을 준다. 개인정보
  미저장 정책상 이를 저장하지 않으므로, 이후 세션에는 표시 이름이 없을 수 있다.
  v1은 일반 라벨(예: "Member")로 대체. 표시 이름 영속이 필요해지면 정책 재검토.
