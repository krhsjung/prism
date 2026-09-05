#!/bin/sh
# coturn 기동 래퍼 — 환경마다 다른 값(realm·자격증명·공인 IP·인증서)을 base conf 뒤에
# 덧붙여 런타임 conf를 만들고 turnserver에 넘긴다.
#
# 왜 command 인자가 아니라 conf 파일인가:
#   1) `--user=이름:비밀번호`는 `ps`와 `docker inspect`에 평문으로 남는다.
#   2) external-ip·TLS 인증서·사설 대역 차단은 "있으면 켜고 없으면 끈다"라 인자 목록이
#      조건부가 되는데, compose의 `command:`는 조건을 쓸 수 없다.
#   3) 이미지 기본 entrypoint는 인자마다 `eval echo`를 돈다 — 비밀번호에 `$`나 백틱이
#      섞이면 셸이 먹어 버린다. conf 파일은 eval을 타지 않는다.
set -eu

BASE_CONF=/etc/coturn/turnserver.conf
CONF=/tmp/turnserver.runtime.conf
CERT_DIR=/etc/coturn/certs

fail() { echo "coturn: $1" >&2; exit 1; }

# --- 필수 값 ----------------------------------------------------------------
# 반쯤 설정된 채로 뜨지 않는다. realm이 어긋나면 인증이 조용히 실패하고, 클라이언트는
# "TURN을 켰는데 계속 직접 연결"로 보인다 — 부팅에서 잡는 편이 싸다.
[ -n "${COTURN_REALM:-}" ] || fail 'COTURN_REALM is required (the service domain)'
# 시한부 자격증명(use-auth-secret)의 공유 비밀. 소켓 서버의 PRISM_TURN_SECRET과 같은
# 값이어야 하고, 어긋나면 모든 할당이 401로 거절된다 — 클라이언트에는 "TURN을 켰는데
# 계속 직접 연결"로 보이므로 부팅에서 잡는다.
[ -n "${COTURN_AUTH_SECRET:-}" ] || fail 'COTURN_AUTH_SECRET is required (same value as PRISM_TURN_SECRET)'

# --- 릴레이 포트 범위 -------------------------------------------------------
# compose가 게시하는 범위와 **반드시 같아야 한다**. 그래서 양쪽 모두 .env를 본다.
MIN_PORT="${COTURN_MIN_PORT:-49100}"
MAX_PORT="${COTURN_MAX_PORT:-49200}"

# --- 릴레이 주소 ------------------------------------------------------------
# 비워 두면 coturn이 인터페이스를 훑어 `::1`까지 릴레이 후보로 잡는다 — IPv6 릴레이를
# 요청한 클라이언트가 루프백 주소를 받아 조용히 실패한다. 컨테이너의 IPv4 하나로 고정한다.
RELAY_IP="${COTURN_RELAY_IP:-}"
if [ -z "$RELAY_IP" ]; then
  RELAY_IP="$(hostname -i 2>/dev/null | tr ' ' '\n' | grep -m1 -E '^[0-9]+(\.[0-9]+){3}$' || true)"
fi

# --- 공인 IP ----------------------------------------------------------------
# NAT 뒤의 coturn은 자기 사설 IP를 후보로 알려 준다 — 그대로 두면 릴레이 후보가
# 밖에서 닿지 않는다. 비워 두면 이미지가 들고 있는 detect-external-ip(DNS 조회)를 쓴다.
EXTERNAL_IP="${COTURN_EXTERNAL_IP:-}"
if [ -z "$EXTERNAL_IP" ]; then
  EXTERNAL_IP="$(detect-external-ip 2>/dev/null || true)"
fi

# --- conf 조립 --------------------------------------------------------------
cp "$BASE_CONF" "$CONF"

{
  echo ''
  echo '# --- 아래는 entrypoint.sh가 env에서 만든 줄이다 -------------------------'
  echo "realm=${COTURN_REALM}"
  echo "server-name=${COTURN_REALM}"
  echo "min-port=${MIN_PORT}"
  echo "max-port=${MAX_PORT}"
  echo "static-auth-secret=${COTURN_AUTH_SECRET}"

  if [ -n "$RELAY_IP" ]; then
    echo "relay-ip=${RELAY_IP}"
  fi

  if [ -n "$EXTERNAL_IP" ]; then
    echo "external-ip=${EXTERNAL_IP}"
  else
    echo "# external-ip: 값도 없고 자동 탐지도 실패했다 — NAT 뒤라면 릴레이가 안 된다." >&2
  fi

  # TLS는 인증서가 있을 때만 켠다. 없으면 5349는 열려도 turns:는 성립하지 않는다.
  if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
    echo "cert=${CERT_DIR}/cert.pem"
    echo "pkey=${CERT_DIR}/privkey.pem"
    echo 'tls-min-version=1.2'
  fi

  # 사설·예약 대역으로의 릴레이 차단(SSRF 방어). TURN은 "아무 데나 패킷을 보내 주는
  # 서버"라 이걸 안 막으면 우리 내부망 스캐너가 된다. 로컬 시험에서만 열어 준다.
  if [ "${COTURN_ALLOW_PRIVATE_PEERS:-false}" != 'true' ]; then
    for range in \
      0.0.0.0-0.255.255.255 \
      10.0.0.0-10.255.255.255 \
      100.64.0.0-100.127.255.255 \
      127.0.0.0-127.255.255.255 \
      169.254.0.0-169.254.255.255 \
      172.16.0.0-172.31.255.255 \
      192.0.0.0-192.0.0.255 \
      192.88.99.0-192.88.99.255 \
      192.168.0.0-192.168.255.255 \
      198.18.0.0-198.19.255.255 \
      240.0.0.0-255.255.255.255 \
      ::-::ffff:ffff:ffff:ffff:ffff:ffff:ffff \
      fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff \
      fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
    do
      echo "denied-peer-ip=${range}"
    done
  fi

  if [ "${COTURN_VERBOSE:-false}" = 'true' ]; then
    echo 'verbose'
  fi
} >> "$CONF"

echo "coturn: realm=${COTURN_REALM} relay=${RELAY_IP:-<auto>}:${MIN_PORT}-${MAX_PORT} external-ip=${EXTERNAL_IP:-<none>}"

exec turnserver -c "$CONF"
