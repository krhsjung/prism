# postgres

PostgreSQL 스키마 마이그레이션. SQL-first + 추적 테이블 기반 자체 러너.

## 구조

```text
infra/postgres/
├── migrate.sh                # 마이그레이션 실행 스크립트
└── migrations/               # 번호순 .sql 파일
    ├── 000_create_app_user.sql   # 앱 유저(role) + CONNECT 권한
    ├── 001_create_schemas.sql    # core/prism 스키마 + 권한
    └── 002_create_users.sql      # users 테이블 + updated_at 트리거 + 데모 계정 시드
```

`infra/docker/postgres/`는 컨테이너 실행 환경(docker-compose)을 담당하고,
이 폴더는 **스키마와 마이그레이션 이력**을 담당.

> **책임 분리** — 컨테이너 init 스크립트(`primary-entrypoint.sh`)는 standby 접속에
> 필요한 복제 역할/슬롯만 만든다. 앱 유저·스키마·권한·테이블·시드는 모두 이 마이그
> 레이션이 담당한다.

## 동작 방식

1. `prism` 스키마와 `prism.schema_migrations(version text PRIMARY KEY, applied_at
   timestamptz)` 테이블 자동 생성 (최초 실행 시).
2. `migrations/*.sql` 파일을 파일명 오름차순으로 순회.
3. 각 파일명을 version으로 사용 — `prism.schema_migrations`에 이미 있으면 건너뜀.
4. 적용되지 않은 마이그레이션은 단일 트랜잭션으로 실행 + 이력 INSERT까지 한 번에 커밋.
5. 실패 시 트랜잭션 전체 롤백 (`ON_ERROR_STOP=1`).
6. 마지막에 앱 유저의 이력 표 권한을 회수.

> **이력 표가 `prism` 스키마에 있는데 001도 같은 스키마를 만드는 이유** — 러너는
> "무엇이 적용됐는지" 읽어야 001을 돌릴지 정할 수 있으므로, 이력 표는 어떤 마이그
> 레이션보다도 먼저 존재해야 한다. 양쪽 다 `IF NOT EXISTS`라 충돌하지 않는다.
>
> **권한 회수가 필요한 이유** — 001의 `GRANT ... ON ALL TABLES IN SCHEMA prism`이
> 이력 표까지 함께 잡아간다. 앱이 이력을 고칠 수 있으면 적용된 마이그레이션을 지워
> 재실행시키거나, 없는 이력을 넣어 건너뛰게 만들 수 있다. 이력은 러너(슈퍼유저)만
> 쓰면 되므로 실행 끝에 매번 되돌린다.

## 사용법

### 1) 환경변수 설정

```bash
export POSTGRES_PRIMARY_USER=postgres            # 슈퍼유저
export PRISM_POSTGRES_DB=prism                   # 대상 DB
export PRISM_POSTGRES_USER=prism                 # 앱 유저
export PRISM_POSTGRES_PASSWORD=changeme          # 앱 유저 비밀번호

# 옵션
export POSTGRES_PRIMARY_CONTAINER=postgres-primary   # 기본값
```

> `infra/docker/postgres/.env`에 동일한 변수가 정의돼 있으므로,
> `set -a && source ../docker/postgres/.env && set +a`로 한 번에 불러올 수 있음
> (비밀번호 등 비어 있는 값은 셸에서 먼저 export한 뒤 source).

### 2) PostgreSQL 컨테이너 실행 중인지 확인

```bash
cd infra/docker/postgres && docker compose up -d
```

### 3) 마이그레이션 실행

```bash
./infra/postgres/migrate.sh
```

출력 예시:

```text
✓ 000_create_app_user (skip)
→ 001_create_schemas
→ 002_create_users
Done.
```

## 마이그레이션 파일 작성 규칙

- 파일명: `NNN_description.sql` (3자리 숫자 + 짧은 설명, 예: `000_create_app_user.sql`)
- 번호는 절대 재사용 / 변경 금지 — 이력으로 영구 고정됨
- 파일 안에 `BEGIN;` / `COMMIT;`을 직접 쓸 필요 없음 (러너가 트랜잭션으로 감쌈)

### SQL 내 변수 치환

`envsubst`로 다음 변수가 SQL 안에서 치환됨:

| SQL 변수          | 출처 환경변수             |
| ----------------- | ------------------------- |
| `${APP_USER}`     | `PRISM_POSTGRES_USER`     |
| `${APP_PASSWORD}` | `PRISM_POSTGRES_PASSWORD` |
| `${DB}`           | `PRISM_POSTGRES_DB`       |

예시:

```sql
-- 000_create_app_user.sql
CREATE ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASSWORD}';
GRANT CONNECT ON DATABASE ${DB} TO ${APP_USER};
```

## 이력 확인

```bash
docker exec -i postgres-primary \
  psql -U "$POSTGRES_PRIMARY_USER" -d "$PRISM_POSTGRES_DB" \
  -c "SELECT * FROM prism.schema_migrations ORDER BY applied_at;"
```

## 한계 / 미지원

- **롤백 없음** (down 마이그레이션 없음) — 잘못 적용 시 새 마이그레이션으로 보정
- **dry-run 없음** — 적용 전 확인은 SQL 파일 직접 읽기로
- 동시 실행 보호 없음 — 한 번에 한 인스턴스만 실행 권장
