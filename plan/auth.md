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
> 로그인 시 소셜 토큰에서 추출해 JWT 세션에만 담는다(영구 저장 안 함). 이 사실을
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
3. 클라이언트가 `POST /auth/demo` 호출 (외부 리다이렉트 없음)
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

| 시안    | 핵심 요소                                                                      |
| ------- | -------------------------------------------------------------------------- |
| Default | Brand · Welcome back · Google · Apple · **Try the demo** · **개인정보 미저장 문구** |
| Error   | + Red Alert (Molecule/Alert variant=Error)                                 |
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

| 화면 요소      | 디자인 시스템 매핑                                           |
| -------------- | ------------------------------------------------------------ |
| Google 버튼    | `Atom/Button` — Variant=Outline, State=Default \| Disabled   |
| Apple 버튼     | `Atom/Button` — Variant=Primary, State=Default \| Disabled   |
| Kakao 버튼     | `Atom/Button` — Variant=Kakao(브랜드 노랑 #FEE500), State=Default \| Disabled |
| 데모 버튼      | `Atom/Button` — Variant=Secondary, State=Default \| Disabled |
| 에러 알림      | `Molecule/Alert` — Variant=Error                             |
| 카드 (Desktop) | 토큰: `--color-card`, `--color-border`, `elevation/lg`       |

---

## 4. 기술 아키텍처

```text
┌────────────┐    OAuth     ┌─────────────┐
│  Client    │ ──────────── ▶  Provider   │
│  (web/iOS/ │              │  Google /   │
│   Android) │ ◀──────────  │  Apple      │
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

| 플랫폼          | OAuth 방식                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Web             | OAuth 2.0 redirect flow — 서버가 `/auth/{provider}/callback` 처리, ID token을 서버에서 직접 교환 |
| Android/iOS (네이티브 앱) | provider 네이티브 SDK로 토큰을 받아 `/auth/{provider}/native`에 POST — Apple=`identityToken`, Google=`idToken`, Kakao=`accessToken` |

> **왜 `/native` 엔드포인트가 있는가(설계 근거).** 지금 모바일 앱을 출시하는 것은
> 아니지만, 서버는 네이티브 SDK 로그인을 받을 수 있게 열어 둔다. 웹 redirect 흐름은
> 콜백을 커스텀 스킴/앱 링크로 앱에 되돌리는데, Android에서는 이 redirect가 다른
> 앱(YouTube·Gmail 등 구글 계열)의 인텐트 필터에 가로채여 앱으로 돌아오지 못하고
> "앱 선택" 창이 뜨는 문제가 실제로 관측됐다. 이를 피하려면 앱이 provider 네이티브
> SDK로 **앱 안에서** 토큰을 받아 서버에 POST하고, 서버가 그 토큰을 검증해 세션을
> 발급해야 한다(§5 `/native`). 아래는 이 흐름을 붙일 때 쓸 대표 클라이언트 라이브러리다.
>
> - Google — [`google_sign_in`](https://pub.dev/packages/google_sign_in) (Android는 `serverClientId`로 받은 `idToken`을 서버에 전달)
> - Kakao — [`kakao_flutter_sdk_user`](https://pub.dev/packages/kakao_flutter_sdk_user) (`kakao_flutter_sdk`의 로그인 모듈, `OAuthToken.accessToken` 전달)
> - Apple — [`sign_in_with_apple`](https://pub.dev/packages/sign_in_with_apple) (`identityToken` + 요청 시 쓴 raw `nonce` 전달)

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

### `POST /auth/demo`

원클릭 데모 로그인. 외부 OAuth 없이 시드된 데모 계정으로 즉시 세션을 발급.

**Body**: 없음
**Response 200**: `SessionUser` = `{ user, accessTokenTtlMs }` — `user.provider === 'demo'`.
세션은 **HttpOnly 쿠키**로 심고(응답 body엔 토큰을 담지 않는다 — 소셜 콜백·`/auth/refresh`의
쿠키 흐름과 동일), 웹은 쿠키로 인증되고 `accessTokenTtlMs`로 선제 갱신을 스케줄한다.
**Response 503**: `{ error: 'DEMO_DISABLED' }` — 데모 비활성화 환경(`AUTH_DEMO_ENABLED=false`)일 때

> 서버는 시드된 `provider='demo' / provider_id='demo-001'` 계정을 조회해 세션을
> 발급한다. 새 계정을 만들지 않으므로 모든 리뷰어가 동일 데모 계정을 공유한다.
>
> **네이티브(iOS)는 이 흐름을 쓰지 않는다** — 토큰이 body에 없고 쿠키로만 오므로,
> Bearer + Keychain을 쓰는 iOS는 데모를 미구현으로 둔다(§9). Android는 쿠키 흐름을
> 그대로 채택해 데모를 실동작시킨다(EncryptedSharedPreferences에 쿠키 저장).

### `GET /auth/me`

**Header**: `Authorization: Bearer <accessToken>`
**Response 200**: `SessionUser` = `{ user, accessTokenTtlMs }`
**Response 401**: `{ error: 'SESSION_EXPIRED' | 'INVALID_TOKEN' | 'UNAUTHORIZED' }`

> `accessTokenTtlMs`는 액세스 토큰 서명 수명(비밀·PII 아님)으로, 웹이 만료 전에 선제
> 갱신을 스케줄하는 데 쓴다(HttpOnly라 exp를 못 읽는다 — §6). 데모 로그인·쿠키 흐름
> 갱신 응답(`SessionUser`)에도 같은 필드가 실린다. 네이티브 갱신(`AuthSession`)은 토큰
> 자체를 받아 exp를 직접 읽으므로 이 필드가 없다.
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
  provider: "google" | "apple" | "demo";
  displayName: string; // 소셜 토큰에서 추출해 JWT에 담김 — DB 미저장(세션 한정)
  createdAt: string;
};
```

> `email`은 수집·저장하지 않으므로 모델에 없다. `displayName`은 DB 컬럼이 아니라
> JWT 클레임에서 채워지며, 데모 세션은 서버가 상수 `"Demo User"`를 부여한다.

---

## 6. 세션 정책

세션의 진실은 토큰이 아니라 **서버 세션(Redis)** 이다. 매 요청 세션 행을 확인하므로
로그아웃·강제 폐기가 다음 요청부터 즉시 반영된다(서명만 보면 만료까지 폐기할 방법이 없다).

| 항목                | 정책                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| Access Token        | JWT (HS256). 수명 `PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN` (기본 15분)           |
| Refresh 자격증명    | `<sessionId>.<secret>` 난수 32B. **저장은 SHA-256 해시만**. 쓸 때마다 회전   |
| idle 만료 (sliding) | `PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN` (기본 12시간). 갱신할 때마다 다시 채워짐 |
| absolute 상한       | 7일 고정. 활동이 있어도 여기서 끝 — 리프레시 무한 연장을 막는다             |
| 저장 위치 (Web)     | HttpOnly 쿠키. 운영은 `__Host-` 접두어 + `Secure` + `SameSite=Lax`          |
| 쿠키 이름           | `prism_session` / `prism_refresh`. `PRISM_COOKIE_NAMESPACE`로 앱별 분리 가능 |
| 저장 위치 (iOS)     | Keychain (일반 `UserDefaults` 금지)                                         |
| 저장 위치 (Android) | 하드웨어 기반 Keystore / EncryptedSharedPreferences (일반 preferences 금지) |

> 네이티브는 자격증명을 로그에 남기지 않는다. 액세스 토큰은 `Authorization: Bearer`로,
> 리프레시 자격증명은 `POST /auth/refresh`의 body로만 오간다.
>
> **sliding은 "탭이 살아 있는 동안" 밀린다.** idle 창을 다시 채우는 것은 회전(`POST
> /auth/refresh`)이고, 웹은 이를 두 경로로 부른다: **(1) 반응형** — 요청이 401
> (`SESSION_EXPIRED`)을 만나면 한 번 갱신하고 재시도([api.ts](../apps/web/src/lib/api.ts)),
> **(2) 선제 스케줄러** — 로그인·세션 확인 응답이 주는 `accessTokenTtlMs`의 75% 지점마다
> 회전을 예약하고, 탭 복귀(`visibilitychange`/`focus`/`online`) 시 직전 회전이 오래됐으면
> 즉시 회전한다([AuthProvider](../apps/web/src/lib/AuthProvider.tsx)). 덕분에 요청이 없어도
> **탭이 열려 있으면 세션이 absolute 상한(7일)까지 밀린다.** 두 경로는 같은 single-flight를
> 공유해 겹쳐도 `/auth/refresh`가 한 번만 나간다. 탭을 완전히 닫아 두면 회전이 멈추고 idle
> TTL에 만료된다(의도된 종료). 백그라운드 탭은 브라우저가 타이머를 억제하므로 예약이
> 밀릴 수 있으나, 복귀 시 wake 보정이 메운다.

### 6.1 리프레시 재사용 탐지

회전만으로는 탈취가 **드러나지 않는다**. 옛 자격증명이 거부되기만 하면, 공격자가 먼저
회전시킨 뒤 피해자가 실패하는 상황과 단순 오류가 구분되지 않는다.

그래서 소비된 자격증명의 해시를 세션별 이력으로 남기고, 나중에 제시된 값이 그 이력에
있으면 "이미 쓴 값을 또 쓴다"는 신호로 읽는다(RFC 9700 refresh token reuse).

| 제시된 값                          | 판정       | 세션    |
| ---------------------------------- | ---------- | ------- |
| 현재 자격증명                      | `rotated`  | 유지·연장 |
| 30초 이내에 소비된 값              | `raced`    | **유지** |
| 30초가 지나 소비된 값              | `reused`   | **폐기** |
| 이력에 없는 값 · 없는 세션 · 상한 초과 | `rejected` | 유지    |

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

| 위치 | 담는 것 |
| --- | --- |
| `@app/session` | 세션 토큰 서명/검증 · 세션·리프레시 쿠키 이름/속성 · `JwtAuthGuard` · `@Public()` |
| `services/auth` | 로그인·세션 발급 · OAuth 흐름(state 토큰 · nonce 쿠키) · 갱신 · 폐기 |
| `services/api` | 도메인 기능. 세션은 검증만 한다 |

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

| 트리거 | 처리 |
| --- | --- |
| 앱 시작·포그라운드 복귀 | 저장된 자격증명으로 `GET /auth/me`. 없으면 `SignedOut` |
| `/auth/me` 200 | `SignedIn(user)` |
| `/auth/me` 401 `SESSION_EXPIRED` | `POST /auth/refresh`로 이어감(갱신하면 살아난다) |
| `/auth/me`·`/auth/refresh` 401 `INVALID_TOKEN`·`UNAUTHORIZED` | **확정 실패** — 자격증명 폐기 후 `SignedOut` |
| 그 밖의 실패(오프라인·타임아웃·5xx·형식 오류) | **일시적 실패** — 자격증명 **보존**, `SignedOut`(다음 시도에 복구) |
| 로그인(데모/소셜) 성공 | 자격증명 저장 후 `SignedIn` |
| 로그아웃 | 로컬 자격증명 폐기 + 서버 세션 폐기, `SignedOut` |

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

**플랫폼 매핑 (같은 규칙, 다른 기전):**

| 규칙 | iOS | Android |
| --- | --- | --- |
| #2 직렬화 | generation 카운터 + single-flight `restoreTask` | `Mutex`로 세션 연산 감쌈 |
| #3 회전 저장 | `KeychainManager.save`, "현재 refresh == 보낸 값" 확인 | 쿠키 흐름은 서버가 `Set-Cookie`로 회전(CookieJar가 반영) |
| #4 로그아웃 durable | Keychain `revoked` 마커로 자격증명을 **덮어씀**(삭제 아님) — 앱 종료·재설치에도 유지 | `withContext(NonCancellable)` + 정리를 락 **안**에서(경쟁·취소 방어), 쿠키는 `SecureStore`에 |
| #5 읽기 실패 구분 | `RawReadResult { data \| notFound \| failure }` | CookieJar는 메모리 캐시 + 암호화 저장, 읽기 실패 시 빈 상태로 시작 |
| #6 극단 처리 | 마커도 삭제도 실패하면 현재 상태 유지 | revoke·clear 모두 실패면 `SignedOut` 미게시(현재 상태 유지) |

> 이 불변식들은 iOS(테스트 47개)·Android(32개)의 회귀 테스트로 고정돼 있다. 세션 로직을
> 고칠 때는 이 표를 먼저 읽고, 두 플랫폼에 같은 규칙이 유지되는지 확인할 것.

---

## 7. 보안 체크리스트

- [ ] HTTPS only (production)
- [ ] Apple/Google ID token signature 검증 (서버)
- [ ] OAuth `state` parameter (CSRF 방어 — web redirect 흐름)
- [ ] Replay attack 방지 (token nonce / iat 검증)
- [ ] **개인정보 미저장** — DB(`core.users`)에 이름/이메일 등 PII 컬럼 없음
      (provider · provider_id · 타임스탬프만). 표시 이름은 JWT 세션에만.
- [ ] PII 로그 금지 (displayName 등 마스킹 — 로그·에러 트래킹 포함)
- [ ] JWT secret을 환경 변수로만 관리
- [ ] **데모 계정 격리** — 데모 세션은 파괴적/민감 작업 차단(읽기 위주 또는
      샌드박스), 공유 계정이므로 PII 입력 금지. `AUTH_DEMO_ENABLED` 플래그로
      운영 환경에서 토글 가능하게.
- [ ] **데모 레이트리밋** — `/auth/demo` 남용 방지(IP당 분당 N회).

---

## 8. 개발 마일스톤

1. ✅ Figma 시안 6개 확정 (Auth 페이지)
2. ✅ 디자인 토큰 sync
3. ⏳ `apps/web` Auth UI 구현 + 다크 모드 토글 (Google · Apple · **데모 버튼**)
4. ⏳ NestJS mock auth endpoint (`/auth/google`, `/auth/apple`, **`/auth/demo`** — fake JWT 반환)
5. ⏳ Web ↔ Mock 서버 연동 확인 (**데모 원클릭 포함**)
6. ⏳ 실제 Google OAuth 연동
7. ⏳ 실제 Apple Sign In 연동
8. 🔶 iOS 로그인 화면 — UI·토큰·다국어·Keychain·Sign in with Apple 완료.
   Google·데모는 네이티브 엔드포인트가 없어 보류(§9)
9. 🔶 Android 로그인 화면 — UI·다국어·다크 테마·데모(쿠키 세션, EncryptedSharedPreferences)
   완료. Google·Apple은 네이티브 엔드포인트가 없어 보류(§9)

---

## 9. 오픈 이슈

- **세션 만료 UX** — 활성 탭은 선제 갱신이 absolute 상한(7일)까지 세션을 유지하므로(§6),
  이 문제는 이제 **진짜 만료**(탭을 idle TTL 넘게 닫아둠·7일 상한 초과·원격 폐기)에서만
  드러난다. 그때 자동 재로그인 대신 Login 화면으로 보낸다(단순). 조용한 자동 재로그인은
  향후 검토.
- **네이티브의 Google·데모 로그인** — 앱에는 세 버튼이 다 있지만 서버가 네이티브
  응답(`AuthSession`)을 주는 경로는 Apple뿐이다. Google은 `/auth/google/native`가
  아예 없고(웹은 redirect 콜백으로 처리한다), 데모는 `/auth/demo`가 존재하되 세션을
  쿠키로만 심고 `SessionUser`를 돌려준다 — Bearer를 쓰는 네이티브가 받을 값이 없다.
  URLSession의 쿠키 항아리로 데모를 "되게" 만들 수는 있으나 그러면 네이티브 세션이
  Keychain 밖에서 살게 되어 §6의 저장 정책이 깨지므로, 그 우회는 택하지 않는다.
  두 엔드포인트가 네이티브 응답을 주도록 여는 것이 남은 일이다.
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
