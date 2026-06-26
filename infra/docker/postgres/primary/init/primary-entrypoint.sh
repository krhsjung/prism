#!/bin/bash
# init.sh - PostgreSQL primary 초기화 스크립트 (환경변수 사용)
set -e

echo ">> initializing PostgreSQL primary server"

# psql 클라이언트 옵션
PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER"

echo "  >> creating replication role: $POSTGRES_REPLICATION_USER"
$PSQL <<-EOSQL
  CREATE ROLE ${POSTGRES_REPLICATION_USER} WITH REPLICATION LOGIN PASSWORD '${POSTGRES_REPLICATION_PASSWORD}';
  SELECT pg_create_physical_replication_slot('$POSTGRES_REPLICATION_SLOT');
EOSQL
echo "  >> replication slot '$POSTGRES_REPLICATION_SLOT' created"

# 애플리케이션 유저·스키마·권한은 마이그레이션에서 생성한다.
#   - 000_create_app_user.sql : 앱 유저(role) + CONNECT 권한
#   - 001_create_schemas.sql  : core/app 스키마 + 권한
# (entrypoint은 standby 접속 전에 필요한 복제 역할/슬롯만 담당)

echo ">> PostgreSQL primary initialization completed"