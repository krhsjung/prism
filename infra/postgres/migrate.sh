#!/bin/bash
# PostgreSQL 마이그레이션 실행 스크립트
# migrations/*.sql 파일을 번호 오름차순으로 실행하고, 적용 이력을
# schema_migrations 테이블에 기록해서 이미 적용된 마이그레이션은 건너뜀.
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

psql_exec() {
    docker exec -i "$CONTAINER" psql -U "$SUPERUSER" -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

# 적용 이력 테이블 보장
psql_exec <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
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
    applied=$(psql_exec -tA <<< "SELECT 1 FROM schema_migrations WHERE version = '$version';")
    if [ -n "$applied" ]; then
        echo "✓ $version (skip)"
        continue
    fi
    echo "→ $version"
    {
        echo "BEGIN;"
        envsubst '${APP_USER} ${APP_PASSWORD} ${DB}' < "$file"
        printf "INSERT INTO schema_migrations(version) VALUES ('%s');\n" "$version"
        echo "COMMIT;"
    } | psql_exec
done

echo "Done."
