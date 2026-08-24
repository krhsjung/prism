# prism

한 도메인, 네 플랫폼 — 서버 · 웹 · iOS · Android 구현을 한 저장소에 모은 풀스택 포트폴리오.

## 이름의 의미

프리즘은 하나의 빛을 여러 갈래로 펼쳐 보여줍니다. 이 프로젝트도 **하나의 백엔드(도메인)** 를
**웹 · iOS · Android** 라는 여러 면으로 굴절시켜, 같은 기능을 플랫폼마다 어떻게 구현했는지
나란히 비교할 수 있게 합니다. 도메인은 일부러 단순하게 두었고, 보여주려는 것은 도메인 복잡도가
아니라 **여러 플랫폼에 걸친 구현 품질과 일관성**입니다. 하나의 소스가 여러 결과물로 나뉜다는
점에서 프리즘이라는 이름을 골랐습니다.

## 지금 상태

**인증 vertical slice가 네 플랫폼 모두에서 동작합니다** — 로그인부터 세션 관리·배포까지
한 기능을 끝까지 관통했습니다. 다음 슬라이스는 [WebRTC 1:1 통화](plan/webrtc.md)(기획 확정, 구현 전).

| 기능 | 서버 | 웹 | iOS | Android |
| --- | :---: | :---: | :---: | :---: |
| 데모 로그인(원클릭) | ✅ | ✅ | ✅ | ✅ |
| Google 로그인 | ✅ | ✅ | ✅ 네이티브 SDK | ✅ 네이티브 SDK |
| Apple 로그인 | ✅ | ✅ | ✅ 네이티브 SDK | ✅ redirect 전용<sup>1</sup> |
| Kakao 로그인 | ✅ | ✅ | ✅ 네이티브 SDK | ✅ 네이티브 SDK |
| 세션 유지·갱신 | ✅ | ✅ 쿠키 | ✅ Bearer | ✅ Bearer |
| 활성 세션 관리 | ✅ | ✅ | ✅ | ✅ |
| 다국어(en · ko · ja) | ✅ | ✅ | ✅ | ✅ |
| 라이트 / 다크 테마 | — | ✅ | ✅ | ✅ |

<sup>1</sup> Android에는 공식 Sign in with Apple 네이티브 SDK가 없어 웹 redirect 경로만 둡니다([plan/auth.md](plan/auth.md) §9).

## 기능

- **로그인**: 원클릭 데모 · Google · Apple · Kakao. provider는 공통 `OAuthClient` 인터페이스 +
  레지스트리로 추가합니다(`GET /auth/:provider`). 웹은 popup(데스크톱)·redirect(모바일),
  네이티브 앱은 provider SDK로 앱 안에서 토큰을 받는 경로와, 서버 웹 OAuth를 시스템 웹 세션으로
  열고 커스텀 스킴으로 받은 **일회용 코드**를 교환하는 경로(`flow=native` +
  `POST /auth/native/exchange`) 두 가지를 모두 지원합니다.
- **세션**: 토큰이 아니라 **서버가 보유한 세션**이 로그인 상태의 원천입니다(Redis).
  짧은 액세스 토큰 + 1회용 리프레시 자격증명(쓰면 회전)으로 나뉘고, 웹은 두 값을 모두
  `HttpOnly` 쿠키(운영에서 `__Host-` 접두어)로만 다루며 JS는 만지지 않습니다. 네이티브는
  Bearer를 안전 저장소(Keychain · EncryptedSharedPreferences)에 담습니다.
  수명은 활동 기준 sliding idle(기본 12h) + 연장 불가 absolute 상한(7일, 코드 상수)이고,
  세션 행을 지우면 발급된 토큰이 **즉시** 무효가 됩니다.
- **세션 관리**: 대시보드에서 내 활성 세션을 보고 개별·전체로 원격 폐기합니다
  (`GET /auth/sessions` · `POST /auth/sessions/:id/revoke` · `.../revoke-all`).
  목록에는 기기 **종류**(iPhone·iPad·Galaxy·Mac·Windows 등)만 둡니다 — User-Agent는 로그인 시점에
  그 enum 하나로 접고 버리며, IP는 읽지 않습니다. 기기명·브라우저·위치를 담으려면 그것을
  저장해야 하고, 그러면 개인정보 미저장 원칙이 깨집니다([plan/dashboard.md](plan/dashboard.md)).
- **보안**: 리프레시 **재사용 탐지**(유예 창 밖의 재제시는 탈취로 보고 세션 폐기) ·
  login-CSRF 방어(흐름별 nonce 쿠키 ↔ 서명된 state 바인딩, 콜백에서 일회 소진) ·
  쿠키를 심고 지우는 요청의 출처 검증 · OAuth 종료 페이지의 CSP nonce ·
  모든 외부 JSON 경계 런타임 디코딩 · 운영 fail-fast(JWT 시크릿 강도, CORS/웹 URL 필수) ·
  개인정보 미저장(provider + provider_id만 보관, 표시 이름은 세션 한정).
- **데이터**: PostgreSQL — 12-factor `PRISM_DATABASE_URL`(+replica URL 목록으로 읽기 분산).
  replica 헬스 추적·half-open 복귀·연결/쿼리 타임아웃.
- **다국어**: 한 벌의 마스터 CSV([i18n/](i18n/))에서 플랫폼별 번역 파일을 생성 —
  웹·서버는 타입이 붙은 TS로, iOS·Android는 xcstrings·strings.xml로 펼칩니다.
  키는 생성된 유니온이라 오타·누락이 컴파일에서 걸리고, 웹은 기본 언어만 번들에
  싣고 나머지는 분리 로드. 서버는 `Accept-Language`로 응답 언어를 정합니다(en·ko·ja).
- **테마**: 라이트 · 다크 선택. 고르기 전에는 기기 설정을 따르고, 고른 값은 저장되어
  기기 설정과 무관하게 유지됩니다. 웹은 `<html data-theme>` 하나로 색이 갈리고 첫 페인트
  전에 정해져 깜빡임이 없습니다. 다크는 라이트의 반전이 아니라 별도 팔레트([design/](design/)).
- **계약**: 서버가 소유한 단일 계약([contracts.ts](apps/server/libs/common/src/types/contracts.ts))을
  세 클라이언트로 생성 배포합니다 — 웹(`contracts.gen.ts`) · iOS(`Contracts.gen.swift`) ·
  Android(`Contracts.gen.kt`). `pnpm sync:contracts`로 재생성하고, drift는
  `pnpm check:contracts`와 테스트가 차단합니다.
- **운영**: `/healthz`(liveness) · `/readyz`(DB·세션 저장소 인지 readiness),
  Docker + Helm(kind) 배포, nginx 경로 라우팅.
- **품질**: TypeScript `unknown`/`any` 키워드 금지(lint 강제) · strict +
  `noUncheckedIndexedAccess` · 자동 테스트 **서버 298 · 웹 128 · iOS 98 · Android 101**
  (그 밖에 실제 Redis를 요구하는 통합 스펙 17개는 `PRISM_REDIS_URL`이 있을 때만 실행).

## 구조

```
prism/
├── apps/
│   ├── server/   # NestJS — REST API, 도메인 소스 (auth · api · socket 세 서비스)
│   ├── web/      # React + Vite
│   ├── ios/      # Swift + SwiftUI
│   └── android/  # Kotlin + Compose
├── infra/        # Docker, CI/CD, 배포 설정
├── design/       # 디자인 토큰 (Figma → 플랫폼별 산출물)
├── i18n/         # 번역 마스터(CSV) + 플랫폼별 생성기
└── plan/         # 기획/설계 문서, ADR, API 명세
```

각 앱은 독립 프로젝트입니다. 빌드/실행은 각 앱 폴더 안에서 수행합니다.

## 기술 스택

| 영역    | 스택                                                    |
| ------- | ------------------------------------------------------- |
| Server  | NestJS · PostgreSQL · Redis                             |
| Web     | React + Vite                                            |
| iOS     | Swift + SwiftUI                                         |
| Android | Kotlin + Compose                                        |
| Infra   | Docker · Kubernetes(kind) · Helm · nginx                |
| 공유    | 계약 생성(TS→Swift/Kotlin) · 번역 생성(CSV) · 디자인 토큰 |

## 시작하기

가장 빠른 경로는 **서버 + 웹**입니다. 데모 로그인은 소셜 크리덴셜 없이 동작합니다.

```bash
# 1) 저장소(PostgreSQL · Redis) 기동
cd infra/docker/postgres && docker compose up -d
cd ../redis && docker compose up -d

# 2) 스키마 마이그레이션 (infra/postgres/README.md 참고)
./infra/postgres/migrate.sh

# 3) 서버(auth) · 웹
cd apps/server && pnpm install && pnpm start:auth:dev
cd apps/web && pnpm install && pnpm dev
```

iOS·Android는 각각 [apps/ios/README.md](apps/ios/README.md) ·
[apps/android/README.md](apps/android/README.md)의 네이티브 로그인 설정 절을 먼저 보세요
(크리덴셜 없이 빌드해도 **데모 로그인은 동작**합니다).

## 문서

| 문서 | 내용 |
| --- | --- |
| [plan/](plan/) | 기획·설계 — [auth](plan/auth.md) · [dashboard](plan/dashboard.md) · [webrtc](plan/webrtc.md) |
| [apps/server/](apps/server/README.md) | 서비스 경계, 세션, 서버 다국어 |
| [apps/web/](apps/web/README.md) | 웹 인증·세션 관리, 다국어, 테마 |
| [apps/ios/](apps/ios/README.md) · [apps/android/](apps/android/README.md) | 앱 구조, 네이티브 로그인 설정 |
| [design/](design/README.md) | 디자인 시스템 · 토큰 · 화면 |
| [i18n/](i18n/README.md) | 번역 마스터와 생성기 |
| [infra/](infra/README.md) | 아키텍처, 로컬 환경, [배포](infra/deploy/README.md), [DB](infra/postgres/README.md) |

## 배포

web(정적) · auth · api · socket 빌드/배포 방법은 [infra/deploy/README.md](infra/deploy/README.md)를 참고하세요.
