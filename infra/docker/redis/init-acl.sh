#!/bin/sh
set -e

ACL_FILE="/data/users.acl"

# ACL 파일이 없으면 생성
if [ ! -f "$ACL_FILE" ]; then
  echo "Creating ACL file with ailom user..."
  cat > "$ACL_FILE" <<EOF
user ${PRISM_REDIS_USER} on sanitize-payload >${PRISM_REDIS_PASSWORD} ~* resetchannels +@all -@admin -@dangerous +info
EOF
else
  echo "ACL file already exists, skipping creation."
fi

# Redis 서버 시작
exec redis-server /etc/redis/redis.conf --requirepass "${REDIS_PASSWORD}"
