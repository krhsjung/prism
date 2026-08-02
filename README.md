# prism

한 도메인, 네 플랫폼 — 서버 · 웹 · iOS · Android 구현을 한 저장소에 모은 풀스택 포트폴리오.

## 이름의 의미

프리즘은 하나의 빛을 여러 갈래로 펼쳐 보여줍니다. 이 프로젝트도 **하나의 백엔드(도메인)** 를
**웹 · iOS · Android** 라는 여러 면으로 굴절시켜, 같은 기능을 플랫폼마다 어떻게 구현했는지
나란히 비교할 수 있게 합니다. 도메인은 일부러 단순하게 두었고, 보여주려는 것은 도메인 복잡도가
아니라 **여러 플랫폼에 걸친 구현 품질과 일관성**입니다. 하나의 소스가 여러 결과물로 나뉜다는
점에서 프리즘이라는 이름을 골랐습니다.

## 기능

현재 구현된 것은 **인증 vertical slice** — 로그인부터 세션·배포까지 한 기능을 끝까지 관통합니다.

- **로그인**: 원클릭 데모 · Google OAuth · Apple Sign In(웹 `form_post` + 네이티브 SDK 경로).
  provider는 공통 `OAuthClient` 인터페이스 + 레지스트리로 추가한다(`GET /auth/:provider`).
- **세션**: stateless HS256 JWT. `GET /auth/me`로 복원, 로그아웃은 클라이언트 토큰 폐기.
- **보안**: login-CSRF 방어(흐름별 nonce 쿠키 ↔ 서명된 state 바인딩, 콜백에서 일회 소진) ·
  모든 외부 JSON 경계 런타임 디코딩 · 운영 fail-fast(JWT 시크릿 강도, CORS/웹 URL 필수) ·
  개인정보 미저장(provider + provider_id만 보관, 표시 이름은 세션 한정).
- **데이터**: PostgreSQL — 12-factor `PRISM_DATABASE_URL`(+replica URL 목록으로 읽기 분산).
  replica 헬스 추적·half-open 복귀·연결/쿼리 타임아웃.
- **다국어**: 한 벌의 마스터 CSV([i18n/](i18n/))에서 플랫폼별 번역 파일을 생성 —
  웹·서버는 타입이 붙은 TS로, iOS·Android는 xcstrings·strings.xml로 펼친다.
  키는 생성된 유니온이라 오타·누락이 컴파일에서 걸리고, 웹은 기본 언어만 번들에
  싣고 나머지는 분리 로드. 서버는 `Accept-Language`로 응답 언어를 정한다(en·ko·ja).
- **테마**: 라이트 · 다크 선택. 고르기 전에는 기기 설정을 따르고, 고른 값은 저장되어
  기기 설정과 무관하게 유지된다. 색은 `<html data-theme>` 하나로 갈리고 첫 페인트
  전에 정해져 깜빡임이 없다. 다크는 라이트의 반전이 아니라 별도 팔레트([design/](design/)).
- **계약**: 서버가 소유한 단일 계약([contracts.ts](apps/server/libs/common/src/types/contracts.ts))을
  웹으로 생성 배포(`pnpm sync:contracts`), drift는 테스트가 차단.
- **운영**: `/healthz`(liveness) · `/readyz`(DB 인지 readiness), Docker + Helm 배포.
- **품질**: TypeScript `unknown`/`any` 키워드 금지(lint 강제) · strict +
  `noUncheckedIndexedAccess` · 서버 167 / 웹 74 자동 테스트.

## 구조

```
prism/
├── apps/
│   ├── server/   # NestJS — REST API, 도메인 소스
│   ├── web/      # React + Vite
│   ├── ios/      # Swift + SwiftUI
│   └── android/  # Kotlin + Compose
├── infra/        # Docker, CI/CD, 배포 설정
├── design/       # 디자인 자산, 목업, 스크린샷
├── i18n/         # 번역 마스터(CSV) + 플랫폼별 생성기
└── plan/         # 기획/설계 문서, ADR, API 명세
```

각 앱은 독립 프로젝트입니다. 빌드/실행은 각 앱 폴더 안에서 수행합니다.

## 기술 스택

| 영역    | 스택             |
| ------- | ---------------- |
| Server  | NestJS           |
| Web     | React + Vite     |
| iOS     | Swift + SwiftUI  |
| Android | Kotlin + Compose |

## 시작하기

자세한 실행 방법은 각 앱 폴더의 README를 참고하세요.

## 배포

web(정적) · auth · api 빌드/배포 방법은 [infra/deploy/README.md](infra/deploy/README.md)를 참고하세요.
