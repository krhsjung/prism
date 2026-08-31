#!/usr/bin/env python3
"""coturn 점검 — STUN 바인딩과 TURN 할당(장기 자격증명)이 실제로 되는지 본다.

`docker compose up` 뒤, 그리고 공유기 포트포워딩·공인 IP가 바뀔 때마다 돌린다.
브라우저를 열지 않고도 "TURN이 살아 있나"를 한 줄로 답한다.

    python3 turn-check.py                       # 127.0.0.1:3478, 자격증명은 env에서
    python3 turn-check.py -s <도메인> -p 3478    # 밖에서(공유기 너머) 확인

표준 라이브러리만 쓴다(설치 없이 어디서나 돌게). 실패하면 종료 코드가 1이다.
"""

import argparse
import hashlib
import hmac
import os
import socket
import struct
import sys

MAGIC_COOKIE = 0x2112A442

# STUN/TURN 메시지 타입
BINDING_REQUEST = 0x0001
BINDING_SUCCESS = 0x0101
ALLOCATE_REQUEST = 0x0003
ALLOCATE_SUCCESS = 0x0103
ALLOCATE_ERROR = 0x0113

# 속성 타입
ATTR_ERROR_CODE = 0x0009
ATTR_USERNAME = 0x0006
ATTR_MESSAGE_INTEGRITY = 0x0008
ATTR_REALM = 0x0014
ATTR_NONCE = 0x0015
ATTR_XOR_RELAYED_ADDRESS = 0x0016
ATTR_REQUESTED_TRANSPORT = 0x0019

TRANSPORT_UDP = 17


def header(msg_type: int, length: int, txn: bytes) -> bytes:
    return struct.pack(">HHI", msg_type, length, MAGIC_COOKIE) + txn


def attribute(attr_type: int, value) -> bytes:
    if isinstance(value, str):
        value = value.encode("utf-8")
    padding = (4 - len(value) % 4) % 4
    return struct.pack(">HH", attr_type, len(value)) + value + b"\x00" * padding


def parse_attributes(message: bytes) -> dict:
    """헤더(20바이트) 뒤의 TLV를 훑는다. 같은 타입이 여러 번이면 마지막이 이긴다."""
    found, offset = {}, 20
    while offset + 4 <= len(message):
        attr_type, attr_len = struct.unpack(">HH", message[offset : offset + 4])
        found[attr_type] = message[offset + 4 : offset + 4 + attr_len]
        offset += 4 + attr_len + (4 - attr_len % 4) % 4
    return found


def decode_xor_address(value: bytes) -> str:
    """XOR-RELAYED-ADDRESS(IPv4)를 ip:port로 푼다."""
    port = struct.unpack(">H", value[2:4])[0] ^ (MAGIC_COOKIE >> 16)
    addr = struct.unpack(">I", value[4:8])[0] ^ MAGIC_COOKIE
    octets = [(addr >> shift) & 0xFF for shift in (24, 16, 8, 0)]
    return "{}:{}".format(".".join(str(o) for o in octets), port)


def check_binding_udp(server: str, port: int, timeout: float) -> bool:
    """UDP STUN Binding — WebRTC가 srflx 후보를 얻는 바로 그 경로다."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        txn = os.urandom(12)
        sock.sendto(header(BINDING_REQUEST, 0, txn), (server, port))
        response, _ = sock.recvfrom(1024)
    except socket.timeout:
        print("  ✗ UDP STUN binding: 타임아웃 (방화벽/포트포워딩 확인)")
        return False
    except OSError as error:
        print(f"  ✗ UDP STUN binding: {error}")
        return False
    finally:
        sock.close()

    if struct.unpack(">H", response[:2])[0] != BINDING_SUCCESS:
        print("  ✗ UDP STUN binding: 성공 응답이 아니다")
        return False
    print("  ✓ UDP STUN binding")
    return True


def check_allocate_tcp(server, port, username, password, timeout) -> bool:
    """TCP로 TURN Allocate — 401을 받아 realm/nonce를 얻고 다시 인증해서 건다.

    장기 자격증명 키는 MD5(user:realm:password)이고, realm은 **서버가 준 값**을 쓴다.
    우리가 아는 realm을 넣지 않는 이유: 서버 realm이 바뀌면 여기서 드러나야 하기 때문이다.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((server, port))

        transport = attribute(ATTR_REQUESTED_TRANSPORT, struct.pack(">BBBB", TRANSPORT_UDP, 0, 0, 0))
        txn = os.urandom(12)
        sock.send(header(ALLOCATE_REQUEST, len(transport), txn) + transport)
        challenge = parse_attributes(sock.recv(2048))

        realm = challenge.get(ATTR_REALM, b"").rstrip(b"\x00")
        nonce = challenge.get(ATTR_NONCE, b"").rstrip(b"\x00")
        if not realm or not nonce:
            print("  ✗ TURN allocate: 서버가 realm/nonce를 주지 않았다 (lt-cred-mech 꺼짐?)")
            return False
        print(f"  · realm={realm.decode()}")

        key = hashlib.md5(f"{username}:{realm.decode()}:{password}".encode()).digest()
        txn = os.urandom(12)
        attrs = (
            transport
            + attribute(ATTR_USERNAME, username)
            + attribute(ATTR_REALM, realm)
            + attribute(ATTR_NONCE, nonce)
        )
        # MESSAGE-INTEGRITY는 "자기 자신까지 포함한" 길이를 적은 헤더 위에서 계산한다(20 = 속성 4 + HMAC 20 - 4).
        integrity = hmac.new(key, header(ALLOCATE_REQUEST, len(attrs) + 24, txn) + attrs, hashlib.sha1).digest()
        attrs += struct.pack(">HH", ATTR_MESSAGE_INTEGRITY, 20) + integrity

        sock.send(header(ALLOCATE_REQUEST, len(attrs), txn) + attrs)
        response = sock.recv(2048)
    except OSError as error:
        print(f"  ✗ TURN allocate: {error}")
        return False
    finally:
        sock.close()

    msg_type = struct.unpack(">H", response[:2])[0]
    if msg_type == ALLOCATE_ERROR:
        error = parse_attributes(response).get(ATTR_ERROR_CODE, b"\x00" * 4)
        code = (error[2] & 0x07) * 100 + error[3]
        hint = " (자격증명 불일치 — 앱의 PRISM_TURN_* 와 같은 값인가)" if code == 401 else ""
        print(f"  ✗ TURN allocate: 오류 {code}{hint}")
        return False
    if msg_type != ALLOCATE_SUCCESS:
        print(f"  ✗ TURN allocate: 뜻밖의 응답 0x{msg_type:04x}")
        return False

    relayed = parse_attributes(response).get(ATTR_XOR_RELAYED_ADDRESS)
    if not relayed:
        print("  ✗ TURN allocate: 성공했는데 릴레이 주소가 없다")
        return False
    print(f"  ✓ TURN allocate → relay {decode_xor_address(relayed)}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="coturn STUN/TURN 점검")
    parser.add_argument("-s", "--server", default=os.environ.get("COTURN_HOST", "127.0.0.1"))
    parser.add_argument("-p", "--port", type=int, default=int(os.environ.get("COTURN_LISTENING_PORT", 3478)))
    parser.add_argument("-u", "--username", default=os.environ.get("PRISM_TURN_USERNAME", "prism"))
    parser.add_argument("-w", "--password", default=os.environ.get("PRISM_TURN_PASSWORD", ""))
    parser.add_argument("-t", "--timeout", type=float, default=5.0)
    args = parser.parse_args()

    if not args.password:
        print("PRISM_TURN_PASSWORD(또는 -w)가 없다 — 자격증명 없이는 할당을 볼 수 없다", file=sys.stderr)
        return 2

    print(f"coturn {args.server}:{args.port} (user={args.username})")
    results = [
        check_binding_udp(args.server, args.port, args.timeout),
        check_allocate_tcp(args.server, args.port, args.username, args.password, args.timeout),
    ]
    ok = all(results)
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
