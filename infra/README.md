# infra

배포 및 운영 인프라 설정 모음.

## 구조

```text
infra/
├── architecture.drawio     # 인프라 구조도 (draw.io) — 단일 소스 오브 트루스
├── deploy/                 # web·services 빌드/배포 자동화 (Docker + Helm + 스크립트)
├── docker/                 # 로컬 개발용 컨테이너 환경
│   ├── postgres/           # PostgreSQL primary/standby (스트리밍 복제) docker-compose
│   ├── redis/              # Redis
│   └── kind/               # 로컬 Kubernetes (kind) 클러스터
└── postgres/               # DB 스키마 마이그레이션 (SQL 러너 + 파일)
```

## 아키텍처

전체 구조는 [architecture.drawio](architecture.drawio)에서 관리한다
(draw.io / diagrams.net 또는 VS Code drawio 확장으로 열기).

- 외부 도메인 **`<your-domain>`** → **nginx**(reverse proxy)가 경로별 라우팅
  - `/` → **web** (정적 SPA 빌드)
  - `/auth` → **auth** 서비스 (NestJS)
  - `/api` → **api** 서비스 (NestJS)
- `auth`·`api`는 **kind(Kubernetes)** 에서 구동, 데이터는 PostgreSQL·Redis(docker) 사용
- nginx(host) → kind 전달은 **NodePort + kind `extraPortMappings`** 로 노출한 host 포트를 `proxy_pass`

- 컨테이너 기동: 각 `docker/<svc>/`에서 `docker compose up -d`
- DB 마이그레이션: 컨테이너 기동 후 [`postgres/`](postgres/README.md) 참고

## 배포

web(정적)·auth·api 빌드/배포(이미지·Helm·nginx) 방법은
[deploy/README.md](deploy/README.md)를 참고.

> `docker/postgres/`(컨테이너 실행 환경)와 `postgres/`(스키마·마이그레이션)는
> 역할이 분리돼 있다. 자세한 책임 구분은 [postgres/README.md](postgres/README.md).
