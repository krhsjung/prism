#!/bin/sh
set -eu

ACL_FILE="/data/users.acl"

# env가 없으면 조용히 빈 사용자를 만들지 말고 부팅을 멈춘다.
# (이전 스크립트는 미설정 상태로 실행되면 `user  on >` 처럼 이름·비밀번호가 모두 빈
#  사용자를 파일에 굳혀버렸고, "파일이 있으면 건너뛴다" 때문에 스스로 복구되지 않았다)
: "${REDIS_PASSWORD:?REDIS_PASSWORD must be set}"
: "${PRISM_REDIS_USER:?PRISM_REDIS_USER must be set}"
: "${PRISM_REDIS_PASSWORD:?PRISM_REDIS_PASSWORD must be set}"

# ACL은 매 기동마다 env에서 다시 만든다 — 파일이 아니라 env가 진실의 원천이다.
#
# ⚠️ default를 여기에 반드시 적는다. aclfile을 쓰면 Redis가 기동 시 사용자 목록을
# 통째로 이 파일로 교체하는데, default가 없으면 내장 기본값(on nopass ~* +@all)으로
# 되돌아간다 — 즉 --requirepass는 무시되고 **누구나 무인증으로 전체 접근**하게 된다.
# (CONFIG GET requirepass에는 값이 보이지만 그 비밀번호로 인증조차 되지 않는다)
#
# prism은 앱 전용 최소 권한: 키스페이스를 prism:* 로 제한하고
# -@admin -@dangerous 로 CONFIG·FLUSHALL·KEYS 등을 막는다(진단용 INFO만 예외).
#
# 채널도 같은 규칙으로 좁힌다. socket 서비스가 세션 만료를 들어야 해서 resetchannels
# 뒤에 **세션 키의 keyspace 채널만** 연다 — 다른 키의 알림도, 임의의 pub/sub도 못 쓴다.
#
# ⚠️ PSUBSCRIBE의 패턴은 허용 패턴과 **문자 그대로** 비교된다(글로브끼리 포함관계를
# 따지지 않는다). 그래서 여기 적는 값은 클라이언트가 구독하는 패턴과 **정확히 같아야**
# 한다 — session-presence.gateway.ts의 SESSION_EXPIRY_PATTERN.
echo "Writing ACL: default (admin) + '${PRISM_REDIS_USER}' (app, keyspace prism:*)"
cat > "$ACL_FILE" <<EOF
user default on sanitize-payload >${REDIS_PASSWORD} ~* &* +@all
user ${PRISM_REDIS_USER} on sanitize-payload >${PRISM_REDIS_PASSWORD} ~prism:* resetchannels &__keyspace@0__:prism:session:* +@all -@admin -@dangerous +info
EOF

exec redis-server /etc/redis/redis.conf
