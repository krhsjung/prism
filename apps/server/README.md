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

## 관련 문서

- 인증 흐름 기획: [../../plan/auth.md](../../plan/auth.md)
- DB 스키마 / 마이그레이션: [../../infra/postgres/README.md](../../infra/postgres/README.md)
