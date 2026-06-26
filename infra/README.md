# infra

배포 및 운영 인프라 설정 모음.

## 구조

```text
infra/
├── docker/                 # 로컬 개발용 컨테이너 환경
│   ├── postgres/           # PostgreSQL primary/standby (스트리밍 복제) docker-compose
│   ├── redis/              # Redis
│   └── kind/               # 로컬 Kubernetes (kind) 클러스터
└── postgres/               # DB 스키마 마이그레이션 (SQL 러너 + 파일)
```

- 컨테이너 기동: 각 `docker/<svc>/`에서 `docker compose up -d`
- DB 마이그레이션: 컨테이너 기동 후 [`postgres/`](postgres/README.md) 참고

> `docker/postgres/`(컨테이너 실행 환경)와 `postgres/`(스키마·마이그레이션)는
> 역할이 분리돼 있다. 자세한 책임 구분은 [postgres/README.md](postgres/README.md).
