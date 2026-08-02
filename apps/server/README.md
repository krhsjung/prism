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
