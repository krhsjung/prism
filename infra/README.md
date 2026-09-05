# infra

배포 및 운영 인프라 설정 모음.

## 구조

```text
infra/
├── architecture.drawio     # 인프라 구조도 (draw.io) — 단일 소스 오브 트루스
├── deploy/                 # web·services 빌드/배포 자동화 (Docker + Helm + 스크립트)
├── docker/                 # 로컬 개발용 컨테이너 환경
│   ├── postgres/           # PostgreSQL primary/standby (스트리밍 복제) docker-compose
│   ├── redis/              # Redis
│   ├── coturn/             # TURN/STUN (WebRTC 미디어 릴레이)
│   └── kind/               # 로컬 Kubernetes (kind) 클러스터
└── postgres/               # DB 스키마 마이그레이션 (SQL 러너 + 파일)
```

## 아키텍처

전체 구조는 [architecture.drawio](architecture.drawio)에서 관리한다
(draw.io / diagrams.net 또는 VS Code drawio 확장으로 열기).

- 외부 도메인 **`<your-domain>`** → **nginx**(reverse proxy)가 경로별 라우팅
  - `/` → **web** (정적 SPA 빌드)
  - `/auth` → **auth** 서비스 (NestJS)
  - `/api` → **api** 서비스 (NestJS)
- `auth`·`api`는 **kind(Kubernetes)** 에서 구동, 데이터는 PostgreSQL·Redis(docker) 사용
- WebRTC 통화의 **미디어는 서버를 지나지 않는다**(P2P). 대칭 NAT·엄격한 방화벽에서만
  **coturn**(docker)이 릴레이로 끼어든다 — 시그널링(`socket`)과는 별개의 경로다
- nginx(host) → kind 전달은 **NodePort + kind `extraPortMappings`** 로 노출한 host 포트를 `proxy_pass`

- 컨테이너 기동: 각 `docker/<svc>/`에서 `docker compose up -d`
- DB 마이그레이션: 컨테이너 기동 후 [`postgres/`](postgres/README.md) 참고

## 배포

web(정적)·auth·api 빌드/배포(이미지·Helm·nginx) 방법은
[deploy/README.md](deploy/README.md)를 참고.

> `docker/postgres/`(컨테이너 실행 환경)와 `postgres/`(스키마·마이그레이션)는
> 역할이 분리돼 있다. 자세한 책임 구분은 [postgres/README.md](postgres/README.md).

## TURN (coturn)

[`docker/coturn/`](docker/coturn/)에 있다. `docker compose up -d`로 뜨고, 값은 전부 셸 환경 →
`.env` → 컨테이너로 흐른다(도메인·비밀번호는 레포에 없다).

- **자격증명은 시한부이고, 통화마다 새로 발급된다.** `COTURN_AUTH_SECRET`은 서버가 읽는
  `PRISM_TURN_SECRET`과 짝인 **공유 비밀**이다 — 소켓이 통화 수락과 함께
  `<만료 unix>:<사용자 id>` 사용자명과 그 HMAC-SHA1(base64) 비밀번호를 만들어 내려주고,
  coturn이 같은 비밀로 검증한다(`use-auth-secret`). 비밀 자체는 클라이언트에게 나가지
  않으므로, 새어 나간 자격증명은 `PRISM_TURN_TTL`(기본 12시간)이 지나면 죽는다.
  두 값이 어긋나면 클라이언트는 401을 받고 조용히 릴레이 없이 붙는다(그래서 아래
  점검 스크립트가 있다).
- **공유기에서 포트를 열어야 한다.** `3478`(UDP·TCP)과 릴레이 범위
  `49100-49200`(UDP)을 이 호스트로 포워딩한다. 할당 하나가 릴레이 포트 하나를 쓴다.
- **`COTURN_EXTERNAL_IP`는 도메인이 아니라 공인 IP다.** coturn은 이 값을 조회 없이 그대로
  후보에 싣는다. 비워 두면 컨테이너가 DNS로 스스로 찾는다 — DDNS IP가 자주 바뀌면
  재기동만으로 따라간다.
- **`turns:`(5349)는 인증서가 있어야 열린다.** `docker/coturn/certs/`에 `cert.pem`·
  `privkey.pem`을 넣으면 entrypoint가 켠다. 없으면 `turn:`/`stun:`만 동작한다.

```bash
cd docker/coturn && docker compose up -d
python3 turn-check.py                 # 로컬에서: STUN 바인딩 + TURN 할당
python3 turn-check.py -s <공인 도메인>  # 밖에서: 포트포워딩까지 함께 확인
```

> **공유 비밀 회전은 아직 수동이다.** `PRISM_TURN_SECRET`을 바꾸려면 coturn과 서버를
> 함께 재기동해야 하고, 그 순간 이미 발급된 자격증명은 전부 무효가 된다(진행 중인
> 통화의 릴레이가 끊긴다). 발급되는 자격증명 자체는 이미 시한부라, 회전은 비밀이
> 유출됐을 때의 조치이지 일상 운영이 아니다.
