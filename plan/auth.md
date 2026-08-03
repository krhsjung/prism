# Auth — 인증 흐름 기획

소셜 로그인(Google + Apple) 기반 인증 시스템. 이메일/비밀번호 인증 없이,
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
- **Try the demo (원클릭 데모 로그인 — 시드된 데모 계정 세션 발급)**
- 자동 회원가입 (첫 로그인 시 서버에서 사용자 upsert)
- 로그아웃

---

## 2. 사용자 흐름

### 2.1 Happy Path

1. 사용자가 Login 화면 진입
2. `Continue with Google` 또는 `Continue with Apple` 클릭
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

| 플랫폼  | OAuth 방식                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------ |
| Web     | OAuth 2.0 redirect flow — 서버가 `/auth/{provider}/callback` 처리, ID token을 서버에서 직접 교환 |
| iOS     | Sign in with Apple SDK (네이티브) · Google Sign-In SDK — 결과 ID token을 서버에 POST             |
| Android | Credential Manager API (Apple + Google) — 동일하게 ID token을 서버에 POST                        |

### 4.2 서버 라이브러리

- `@nestjs/passport` + `passport-google-oauth20` (web redirect 흐름용)
- `apple-signin-auth` (네이티브에서 받은 Apple ID token 검증)
- `google-auth-library` (네이티브에서 받은 Google ID token 검증)
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
  authorizationCode: string;   // (옵션) refresh token 교환용
  user?: {                     // 첫 로그인에서만 옵션으로 전달
    name?: { firstName: string; lastName: string };
    email?: string;
  };
}
```

**Response 200**: `{ accessToken: string, user: User }`
**Response 401**: `{ error: 'INVALID_TOKEN' }`

### `POST /auth/demo`

원클릭 데모 로그인. 외부 OAuth 없이 시드된 데모 계정으로 즉시 세션을 발급.

**Body**: 없음
**Response 200**: `{ accessToken: string, user: User }` — `user.provider === 'demo'`
**Response 503**: `{ error: 'DEMO_DISABLED' }` — 데모 비활성화 환경(`AUTH_DEMO_ENABLED=false`)일 때

> 서버는 시드된 `provider='demo' / provider_id='demo-001'` 계정을 조회해 JWT를
> 발급한다. 새 계정을 만들지 않으므로 모든 리뷰어가 동일 데모 계정을 공유한다.

### `GET /auth/me`

**Header**: `Authorization: Bearer <accessToken>`
**Response 200**: `User`
**Response 401**: `{ error: 'SESSION_EXPIRED' | 'INVALID_TOKEN' | 'UNAUTHORIZED' }`

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
8. ⏳ iOS Sign in with Apple + Google Sign-In
9. ⏳ Android Credential Manager 통합

---

## 9. 오픈 이슈

- **세션 만료 UX** — 1시간 후 토큰 만료 시 자동 재로그인할지, 명시적으로
  Login 화면으로 보낼지. 일단 후자 (단순).
- **provider 식별자** — 동일 이메일이지만 다른 provider로 두 번 가입하면?
  v1은 별도 계정으로 처리. 향후 account linking으로 통합.
- **Apple 이름/이메일** — Apple은 첫 로그인 시 한 번만 이름/이메일을 준다. 개인정보
  미저장 정책상 이를 저장하지 않으므로, 이후 세션에는 표시 이름이 없을 수 있다.
  v1은 일반 라벨(예: "Member")로 대체. 표시 이름 영속이 필요해지면 정책 재검토.
