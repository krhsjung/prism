# server

Prism 백엔드 — NestJS 기반 REST API, 도메인 소스 of truth.

## 실행

```bash
npm install
npm run start:dev   # watch 모드
npm run start       # 일반 실행
npm run build       # 프로덕션 빌드 → dist/
```

## 테스트

```bash
npm test            # 유닛 (Jest)
npm run test:e2e    # E2E
```

Redis 통합 스펙(`libs/redis`)은 실제 Redis를 요구해 기본 실행에서는 skip됩니다.
`PRISM_REDIS_URL`을 주면 Lua 스크립트까지 함께 검증합니다.

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
