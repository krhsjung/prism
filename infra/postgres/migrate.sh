#!/bin/bash
# PostgreSQL 마이그레이션 실행 스크립트
# migrations/*.sql 파일을 번호 오름차순으로 실행하고, 적용 이력을
# prism.schema_migrations 테이블에 기록해서 이미 적용된 마이그레이션은 건너뜀.
#
# 필수 환경변수:
#   POSTGRES_PRIMARY_USER    - PostgreSQL 슈퍼유저
#   PRISM_POSTGRES_DB        - 대상 데이터베이스
#   PRISM_POSTGRES_USER      - 앱 유저 이름 (SQL의 ${APP_USER}에 치환)
#   PRISM_POSTGRES_PASSWORD  - 앱 유저 비밀번호 (SQL의 ${APP_PASSWORD}에 치환)
#
# 옵션 환경변수:
#   POSTGRES_PRIMARY_CONTAINER - docker 컨테이너 이름 (기본: postgres-primary)
#
# SQL 파일 내 치환 변수: ${APP_USER}, ${APP_PASSWORD}, ${DB}

set -euo pipefail

CONTAINER="${POSTGRES_PRIMARY_CONTAINER:-postgres-primary}"
SUPERUSER="${POSTGRES_PRIMARY_USER:?POSTGRES_PRIMARY_USER must be set}"
export DB="${PRISM_POSTGRES_DB:?PRISM_POSTGRES_DB must be set}"
export APP_USER="${PRISM_POSTGRES_USER:?PRISM_POSTGRES_USER must be set}"
export APP_PASSWORD="${PRISM_POSTGRES_PASSWORD:?PRISM_POSTGRES_PASSWORD must be set}"
MIGRATIONS_DIR="$(dirname "$0")/migrations"

# 적용 이력을 둘 스키마. 001_create_schemas.sql이 만드는 이름과 같아야 한다.
SCHEMA="prism"

psql_exec() {
    docker exec -i "$CONTAINER" psql -U "$SUPERUSER" -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

# 적용 이력 테이블 보장.
# 스키마 생성이 001과 겹치지만 여기서도 해야 한다 — "무엇이 적용됐는지"를 읽어야
# 001을 돌릴지 정할 수 있으므로 이력 표는 어떤 마이그레이션보다도 먼저 존재해야 한다.
# (IF NOT EXISTS라 001이 다시 실행돼도 충돌하지 않는다)
psql_exec <<SQL
CREATE SCHEMA IF NOT EXISTS ${SCHEMA};
CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

shopt -s nullglob
files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [ "${#files[@]}" -eq 0 ]; then
    echo "No migration files in $MIGRATIONS_DIR"
    exit 0
fi

# 번호 오름차순 정렬
IFS=$'\n' sorted=($(printf '%s\n' "${files[@]}" | sort))
unset IFS

for file in "${sorted[@]}"; do
    version=$(basename "$file" .sql)
    applied=$(psql_exec -tA <<< "SELECT 1 FROM ${SCHEMA}.schema_migrations WHERE version = '$version';")
    if [ -n "$applied" ]; then
        echo "✓ $version (skip)"
        continue
    fi
    echo "→ $version"
    {
        echo "BEGIN;"
        envsubst '${APP_USER} ${APP_PASSWORD} ${DB}' < "$file"
        printf "INSERT INTO %s.schema_migrations(version) VALUES ('%s');\n" "$SCHEMA" "$version"
        echo "COMMIT;"
    } | psql_exec
done

# 001의 `GRANT ... ON ALL TABLES IN SCHEMA prism`이 이력 표까지 함께 잡아간다.
# 앱이 이력을 고칠 수 있으면 적용된 마이그레이션을 지워 재실행시키거나, 반대로 없는
# 이력을 넣어 건너뛰게 만들 수 있다. 이력은 러너(슈퍼유저)만 쓰면 되므로 매번 되돌린다.
role_exists=$(psql_exec -tA <<< "SELECT 1 FROM pg_roles WHERE rolname = '$APP_USER';")
if [ -n "$role_exists" ]; then
    psql_exec <<< "REVOKE ALL ON ${SCHEMA}.schema_migrations FROM \"$APP_USER\";"
fi

echo "Done."
