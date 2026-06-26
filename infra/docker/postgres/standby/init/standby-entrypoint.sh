#!/bin/bash
# init.sh - PostgreSQL standby 초기화 스크립트 (환경변수 사용)
set -e

echo ">> initializing PostgreSQL standby server"

# Primary가 리슨할 때까지 대기
until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$POSTGRES_REPLICATION_USER"; do
  echo "  >> Waiting for primary at $PRIMARY_HOST:$PRIMARY_PORT..."
  sleep 2
done

# Primary 초기화 완료 대기 (POSTGRES_DB 데이터베이스가 생성될 때까지)
if [ -n "$POSTGRES_DB" ]; then
  echo "  >> Waiting for database '$POSTGRES_DB' to be created on primary..."
  until PGPASSWORD="$POSTGRES_REPLICATION_PASSWORD" psql -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$POSTGRES_REPLICATION_USER" -d "$POSTGRES_DB" -c "SELECT 1" >/dev/null 2>&1; do
    sleep 2
  done
  echo "  >> Database '$POSTGRES_DB' is ready on primary."
fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "  >> Performing basebackup as $POSTGRES_REPLICATION_USER..."

  # pg_basebackup을 사용하여 Primary로부터 데이터베이스를 복제
  #    --wal-method=stream 옵션을 사용하여 WAL 파일을 스트리밍 방식으로 가져옴
  #    -D 옵션은 데이터베이스 디렉토리를 지정
  #    -U 옵션은 복제 사용자 지정
  #    -vP 옵션은 진행 상황을 자세히 출력  
  pg_basebackup \
    -h "$PRIMARY_HOST" \
    -p "$PRIMARY_PORT" \
    -U "$POSTGRES_REPLICATION_USER" \
    -D "$PGDATA" \
    -vP --wal-method=stream

  # 4) standby 모드 활성화
  touch "$PGDATA/standby.signal"
  cat <<EOF >> "$PGDATA/postgresql.auto.conf"
primary_conninfo = 'host=$PRIMARY_HOST port=$PRIMARY_PORT user=$POSTGRES_REPLICATION_USER password=$POSTGRES_REPLICATION_PASSWORD'
hot_standby = on
EOF
  echo ">> PostgreSQL standby server initialized successfully."
else
  echo ">> PostgreSQL standby server already initialized. Skipping initialization."
fi

# postgres를 직접 실행하지 말고, 공식 엔트리포인트 통해 권한 강등하기
# 컨테이너를 root 권한으로 띄운 상태에서 exec postgres를 수행하면 “root 실행 금지” 에러가 납니다.
# - exec postgres -c config_file=/etc/postgresql/postgresql.conf
# 공식 이미지의 엔트리포인트(docker-entrypoint.sh)가 gosu postgres … 로 권한을 바꿔주는 로직을 우회해 버렸기 때문입니다.
exec docker-entrypoint.sh postgres -c config_file=/etc/postgresql/postgresql.conf -c log_line_prefix="${POSTGRES_LOG_LINE_PREFIX}"