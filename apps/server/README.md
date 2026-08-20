# server

Prism 백엔드 — NestJS 기반 REST API, 도메인 소스 of truth.

서비스가 둘입니다 — `services/auth`(로그인·세션 발급)와 `services/api`(보호된 도메인
API). 공유 코드는 `libs/`에 있고 `@app/*`로 참조합니다(`common` · `config` · `database` ·
`redis` · `session`).

## 실행

```bash
pnpm install
pnpm start:auth:dev   # auth 서비스 (watch)
pnpm start:dev        # api 서비스 (watch)
pnpm build            # api 프로덕션 빌드 → dist/
pnpm build:auth       # auth 프로덕션 빌드
```

저장소(PostgreSQL · Redis)가 먼저 떠 있어야 합니다 —
[../../infra/README.md](../../infra/README.md) 참고.

## 테스트

```bash
pnpm test         # 유닛 (Jest) — 219개
pnpm test:e2e     # E2E
```

Redis 통합 스펙(`libs/redis`, 17개)은 실제 Redis를 요구해 기본 실행에서는 skip됩니다.
`PRISM_REDIS_URL`을 주면 Lua 스크립트까지 함께 검증합니다 — `compareAndRenew`나
인덱스 수명(`PEXPIREAT`)은 서버에서 실행되므로 메모리 구현으로는 확인되지 않습니다.

## 세션

**토큰이 아니라 서버가 보유한 세션이 "로그인 상태"의 원천입니다.** 세션 행을 지우면
그 순간부터 발급된 토큰이 무효가 됩니다(즉시 폐기). 저장소는 Redis인데, 세션이
**만료가 본질인 데이터**라 본체가 키 TTL로 스스로 사라지기 때문입니다 — 만료된 행을
치우는 별도 작업이 필요 없습니다.

자격증명은 둘로 나뉩니다.

| | 무엇 | 수명 | 웹 | 네이티브 |
| --- | --- | --- | --- | --- |
| 액세스 토큰 | 서명된 JWT(세션 id만 담음) | 기본 15m | `HttpOnly` 쿠키 | Bearer |
| 리프레시 자격증명 | `<sessionId>.<secret>` — 저장소엔 해시만 | 기본 12h(sliding) | `HttpOnly` 쿠키 | body |

- **액세스 토큰은 "어느 세션인가"만 말합니다.** 사용자 정보는 세션 레코드에 있으므로
  토큰이 유출돼도 이름이 읽히지 않고, 폐기가 즉시 반영됩니다(stateless JWT라면 만료를
  기다려야 합니다).
- **리프레시는 1회용이라 쓰면 회전합니다.** 같은 값을 두 번 쓰면 실패하므로 탈취된
  자격증명의 병행 사용이 드러납니다 — 유예 창(30초) 밖의 재제시는 **재사용 탐지**로
  보고 세션을 폐기합니다. 창 안의 재제시는 탭 경합이라 세션을 유지합니다.
- **수명은 두 겹입니다** — 활동 기준 sliding idle(`PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN`)
  과, 리프레시로도 넘을 수 없는 absolute 상한(7일). 상한은 env가 아니라 코드 상수입니다
  (`SESSION_ABSOLUTE_TTL_MS`) — "무한 연장 금지"는 배포 환경이 아니라 서비스의 정책입니다.
- 사용자별 인덱스(정렬 집합)가 "내 세션 목록 / 전체 로그아웃"을 받칩니다. 지나간 항목은
  접근할 때 걷어내고, 집합 키 자체도 마지막 항목의 만료 시각에 사라집니다 — 그러지 않으면
  다시 찾아오지 않는 사용자의 인덱스가 영영 남습니다.

쿠키는 운영에서 전부 `__Host-` 접두어가 붙습니다(Domain 금지 + Path=/ + Secure).
자세한 근거는 `libs/session/src/session-cookie.ts`, 정책은
[plan/auth.md](../../plan/auth.md) §6.

## 인증 경계

`services/auth`가 세션을 **발급**하고, 나머지 서비스는 **검증만** 합니다.
검증에 쓰이는 것(토큰 서명 규칙 · 쿠키 이름 · 가드)은 전부 `@app/session`에 있습니다 —
서비스마다 따로 두면 인증의 원천이 둘이 되고, 한쪽만 고쳐지는 순간 구멍이 됩니다.

`services/api`는 전역 가드가 걸려 **모든 라우트가 기본 보호**입니다. 새 엔드포인트는
아무것도 하지 않아도 인증을 요구하고, 공개 경로만 `@Public()`로 표시합니다.

```typescript
@Public()          // 이게 없으면 인증 필요
@Get('healthz')
health() { ... }
```

정책 전반은 [plan/auth.md](../../plan/auth.md) §6 참고.

## 계약

`libs/common/src/types/contracts.ts`가 **모든 클라이언트가 공유하는 계약의 원천**입니다.
타입·순수 상수·디코더만 두고 프레임워크 의존은 넣지 않습니다 — 세 플랫폼이 그대로
컴파일하기 때문입니다.

```bash
pnpm sync:contracts    # 웹 사본 + iOS/Android 생성물 재생성
pnpm check:contracts   # 재생성 결과와 커밋된 파일 대조 (drift 검사)
```

| 대상 | 산출물 | 손으로 유지하는 것 |
| --- | --- | --- |
| 웹 | `apps/web/src/lib/contracts.gen.ts` | — (통째로 생성) |
| iOS | `Domain/Models/Auth/Contracts.gen.swift` | 모델 struct·디코더 (`AuthContracts.swift`) |
| Android | `domain/model/Contracts.gen.kt` | 모델·디코더 (`Contracts.kt`) |

## 다국어

서버는 오류 **코드**만 반환하고 문구는 클라이언트가 고릅니다(`contracts.ts`의
`AUTH_ERROR_CODES`). 번역이 필요한 것은 서버가 직접 그리는 화면 — OAuth 콜백
종료 페이지뿐이고, 그 문구는 `i18n/server.csv`에서 생성됩니다.

요청 언어는 `Accept-Language`로 정합니다(`libs/common/src/i18n/`). 웹이 고른 언어는
`localStorage`에 있어 출처가 다른 서버에서는 읽을 수 없습니다.

`libs/common/src/i18n/**/*.gen.ts`는 생성 파일이라 lint·prettier 대상에서 제외합니다 —
재생성은 [../../i18n/](../../i18n/)에서 합니다.

## 관련 문서

- 번역 마스터 / 생성기: [../../i18n/README.md](../../i18n/README.md)
- 인증 흐름 기획: [../../plan/auth.md](../../plan/auth.md)
- DB 스키마 / 마이그레이션: [../../infra/postgres/README.md](../../infra/postgres/README.md)
