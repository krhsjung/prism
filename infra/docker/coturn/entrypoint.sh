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
  #
  # 파일 이름은 발급 방식마다 다르다 — certbot은 `fullchain.pem`·`privkey.pem`을,
  # 손으로 만든 것은 `cert.pem`·`key.pem`을 쓴다. 호스트의 디렉터리를 그대로 마운트해
  # 쓰려면(갱신이 바로 반영되게) 이름을 하나로 강요할 수 없으므로 둘 다 받는다.
  # 체인이 담긴 쪽을 먼저 본다 — 중간 인증서가 빠지면 일부 클라이언트가 거절한다.
  CERT_FILE=''
  for n in fullchain.pem cert.pem; do
    if [ -f "$CERT_DIR/$n" ]; then CERT_FILE="$CERT_DIR/$n"; break; fi
  done
  KEY_FILE=''
  for n in privkey.pem key.pem; do
    if [ -f "$CERT_DIR/$n" ]; then KEY_FILE="$CERT_DIR/$n"; break; fi
  done
  if [ -n "$CERT_FILE" ] && [ -n "$KEY_FILE" ]; then
    echo "cert=${CERT_FILE}"
    echo "pkey=${KEY_FILE}"
    # TLS 하한은 turnserver.conf의 `no-tlsv1`·`no-tlsv1_1`이 정한다.
    # coturn에는 `tls-min-version`이라는 옵션이 없어 적으면 기동 로그가
    # "Bad configuration format"으로 덮인다 — 켜지지도 않는 줄이었다.
  else
    echo "# turns:(5349) 꺼짐 — ${CERT_DIR}에 인증서·키가 없다." >&2
  fi

  # 사설·예약 대역으로의 릴레이 차단(SSRF 방어). TURN은 "아무 데나 패킷을 보내 주는
  # 서버"라 이걸 안 막으면 우리 내부망 스캐너가 된다. 로컬 시험에서만 열어 준다.
  #
  # ⚠️ **하한이 `::`인 범위를 두지 않는다.** coturn은 범위의 하한이 any 주소(`::`·`0.0.0.0`)
  # 면 "하한 없음"으로 읽고, 주소족이 다른 주소는 족 번호로 대소를 정한다(IPv4 < IPv6).
  # 그래서 `::-::ffff:…` 한 줄이 **모든 IPv4 피어**를 거부한다 — 공인 IP까지 막혀 릴레이가
  # 통째로 죽고, 클라이언트에는 "TURN 정책이면 영영 연결 중"으로 보인다. IPv6 쪽은
  # 루프백·IPv4 매핑·ULA·링크로컬을 각각 하한이 any가 아닌 범위로 적는다.
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
      ::1 \
      ::ffff:0.0.0.0-::ffff:255.255.255.255 \
      64:ff9b::-64:ff9b::ffff:ffff \
      fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff \
      fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
    do
      echo "denied-peer-ip=${range}"
    done

    # **릴레이 주소 자신은 연다.** 양쪽이 다 TURN을 지나면(relay 정책, 대칭 NAT 둘) 상대의
    # 후보가 이 서버의 릴레이 주소이고, coturn은 자기 external-ip를 relay-ip로 되돌려 비교하므로
    # 그 피어는 위의 사설 대역(172.16/12)에 걸린다. allowed가 denied보다 우선한다 — 이 한 줄이
    # 없으면 relay↔relay 쌍이 서지 않고, 이 서버 자신에게 보내는 것뿐이라 열어도 잃을 것이 없다.
    if [ -n "$RELAY_IP" ]; then
      echo "allowed-peer-ip=${RELAY_IP}"
    fi
  fi

  if [ "${COTURN_VERBOSE:-false}" = 'true' ]; then
    echo 'verbose'
  fi
} >> "$CONF"

echo "coturn: realm=${COTURN_REALM} relay=${RELAY_IP:-<auto>}:${MIN_PORT}-${MAX_PORT} external-ip=${EXTERNAL_IP:-<none>}"

exec turnserver -c "$CONF"
