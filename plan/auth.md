# Auth — 인증 흐름 기획

소셜 로그인(Google + Apple) 전용 인증 시스템. 이메일/비밀번호 인증 없이,
첫 로그인 시 자동으로 계정이 생성되는 단순한 구조.

## 1. 범위

- Continue with Google
- Continue with Apple
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

| 시안    | 핵심 요소                                              |
| ------- | ------------------------------------------------------ |
| Default | Brand · Welcome back · Google · Apple · Sign up footer |
| Error   | + Red Alert (Molecule/Alert variant=Error)             |
| Loading | Google → "Connecting...", 모든 버튼 Disabled state     |

### 컴포넌트 의존성

| 화면 요소      | 디자인 시스템 매핑                                         |
| -------------- | ---------------------------------------------------------- |
| Google 버튼    | `Atom/Button` — Variant=Outline, State=Default \| Disabled |
| Apple 버튼     | `Atom/Button` — Variant=Primary, State=Default \| Disabled |
| 에러 알림      | `Molecule/Alert` — Variant=Error                           |
| Sign up 링크   | Text + `--color-accent` 토큰                               |
| 카드 (Desktop) | 토큰: `--color-card`, `--color-border`, `elevation/lg`     |

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

iOS 네이티브 Sign in with Apple 전용. 첫 로그인에만 `user` 필드가 포함되므로
서버는 반드시 첫 응답에서 이름/이메일을 영구 저장해야 함.

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

### `GET /auth/me`

**Header**: `Authorization: Bearer <accessToken>`
**Response 200**: `User`
**Response 401**: `{ error: 'UNAUTHORIZED' }`

### `POST /auth/logout`

**Response 204** — 단순 구현 시 클라이언트가 토큰 폐기만 (서버는 stateless).

### 모델

```ts
type User = {
  id: string;
  email: string;
  displayName: string;
  provider: "google" | "apple";
  createdAt: string;
};
```

---

## 6. 세션 정책

| 항목                | 정책                                                 |
| ------------------- | ---------------------------------------------------- |
| Access Token        | JWT (HS256), 1시간 만료                              |
| Refresh Token       | v1 미지원 — 만료 시 재로그인                         |
| 저장 위치 (Web)     | `localStorage` (v1) → 추후 HttpOnly cookie 전환 검토 |
| 저장 위치 (iOS)     | Keychain                                             |
| 저장 위치 (Android) | EncryptedSharedPreferences                           |

---

## 7. 보안 체크리스트

- [ ] HTTPS only (production)
- [ ] Apple/Google ID token signature 검증 (서버)
- [ ] OAuth `state` parameter (CSRF 방어 — web redirect 흐름)
- [ ] Replay attack 방지 (token nonce / iat 검증)
- [ ] PII 로그 금지 (email/displayName 마스킹)
- [ ] JWT secret을 환경 변수로만 관리

---

## 8. 개발 마일스톤

1. ✅ Figma 시안 6개 확정 (Auth 페이지)
2. ✅ 디자인 토큰 sync
3. ⏳ `apps/web` Auth UI 구현 + 다크 모드 토글
4. ⏳ NestJS mock auth endpoint (`/auth/google`, `/auth/apple` — fake JWT 반환)
5. ⏳ Web ↔ Mock 서버 연동 확인
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
- **Apple 이름/이메일** — Apple은 첫 로그인 시 한 번만 이메일/이름을 주므로,
  서버가 첫 응답을 반드시 저장해야 함.
