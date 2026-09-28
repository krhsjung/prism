# environment

프로젝트가 읽는 **환경 변수의 단일 목록**입니다. 각 항목은 세 가지를 정합니다 —
**누가 읽는가 · 없으면 무엇이 일어나는가 · 기본값은 무엇인가**.

값은 여기 적지 않습니다. 도메인·비밀·경로는 셸 환경에서만 오고, 저장소에 추적되는
`.env` 파일들은 `${VAR}` 자리표시자만 담습니다.

깊은 설명은 그 변수가 사는 문서에 있습니다 — 배포 절차는
[infra/deploy/README.md](../infra/deploy/README.md), TURN 운영은
[infra/README.md](../infra/README.md), 세션 수명의 근거는 [auth.md](auth.md) §6,
ICE·푸시 결정은 [webrtc.md](webrtc.md) §7 · [push.md](push.md) §5입니다.

## 1. 규칙 넷

1. **값은 저장소에 두지 않습니다.** 추적되는 `.env`
   ([apps/web/.env](../apps/web/.env) · [infra/docker/*/.env](../infra/docker/redis/.env))는
   `${VAR}` 자리표시자만 담고, compose와 vite가 셸 환경에서 채웁니다(dotenv-expand).
   실제 값이 들어간 파일은 gitignore 대상입니다.

2. **서버는 `.env`를 읽지 않습니다.** `process.env`에서 직접 읽습니다
   ([config.module.ts](../apps/server/libs/config/src/config.module.ts)) — 주입 경로가
   k8s Secret과 셸 하나뿐이라 매핑 계층을 두지 않았습니다. 로컬에서도 셸에 실어 줍니다.

3. **조용히 기본값으로 흡수되지 않습니다.** 형식이 어긋난 값은 **부팅에서 실패**합니다 —
   `15min` 같은 수명 오타, `stun.example:3478`처럼 스킴 없는 ICE URL, postgres/redis가
   아닌 접속 URL, 쿠키 이름에 못 쓰는 문자. "설정했는데 안 먹는" 상태가 운영에서
   가장 늦게 드러나기 때문입니다(파싱은 전부
   [app-config.ts](../apps/server/libs/config/src/app-config.ts)에 모여 있습니다).

4. **반쯤 설정된 상태는 없습니다.** 묶음으로 검증해, 하나만 온 설정은 부팅에서 막습니다 —
   TURN(`PRISM_TURN_URLS` + `PRISM_TURN_SECRET`)과 FCM(세 개)이 그렇습니다. 반쯤 켜진
   채로 뜨면 "TURN을 켰다고 믿는데 대칭 NAT에서만 실패" · "푸시를 켰다고 믿는데 알림만
   안 옴"이 되고, 둘 다 통화가 깨져야만 드러납니다.

## 2. 최소 집합 — 로컬에서 띄우기

데모 로그인은 소셜 크리덴셜 없이 동작하므로, 아래가 전부입니다. 웹은 아무것도 필요
없습니다(주소 기본값이 `localhost:3000` · `ws://localhost:3002`입니다).

```bash
# 저장소 컨테이너 (infra/docker/postgres · redis)
export PRISM_POSTGRES_DB=prism PRISM_POSTGRES_USER=prism PRISM_POSTGRES_PASSWORD=…
export POSTGRES_PRIMARY_USER=postgres POSTGRES_PRIMARY_PASSWORD=…
export POSTGRES_STANDBY_USER=postgres POSTGRES_STANDBY_PASSWORD=…
export POSTGRES_REPLICATION_USER=replicator POSTGRES_REPLICATION_PASSWORD=…
export REDIS_PASSWORD=… PRISM_REDIS_USER=prism PRISM_REDIS_PASSWORD=…

# 서버 (apps/server)
export PRISM_DATABASE_URL="postgres://prism:…@localhost:5432/prism"
export PRISM_REDIS_URL="redis://prism:…@localhost:6379"
export PRISM_JWT_SECRET_KEY=…          # openssl rand -hex 32
```

> 비밀은 `openssl rand -hex 32`(JWT·TURN)나 `-hex 16`(DB 비밀번호)으로 만듭니다.
> `PRISM_JWT_SECRET_KEY`는 운영에서 **32바이트 미만이면 부팅에 실패**합니다 — HS256 키가
> 짧으면 토큰이 새어 나갔을 때 오프라인 추측이 됩니다.

## 3. 서버 — auth · api · socket

세 서비스가 **같은 설정 로더**를 씁니다. 그래서 "api는 쓰지 않지만 검증은 하는" 값이
있습니다(`PRISM_WEB_APP_URL`). 아래 "서비스" 열은 **값이 실제로 쓰이는 곳**입니다.

`NODE_ENV`는 이미지에 `production`으로 박혀 있습니다
([Dockerfile](../apps/server/Dockerfile)) — 로컬에서는 미설정이 개발 모드이고, 운영 전용
검증(아래 "운영 필수")은 이 값으로 갈립니다.

### 3-1. 필수

| 변수 | 서비스 | 기본값 | 없으면 |
| --- | --- | --- | --- |
| `PRISM_JWT_SECRET_KEY` | auth · api · socket | `dev-insecure-secret-change-me` | **운영 부팅 실패**. 셋이 같은 값이어야 합니다 — 갈리면 로그인은 되는데 api가 전부 401, 소켓은 전부 닫힙니다 |
| `PRISM_REDIS_URL` | auth · api · socket | `redis://localhost:6379` | **운영 부팅 실패**. 세션과 presence가 여기에만 있습니다 |
| `PRISM_CORS_ORIGIN` | auth · api · socket | 없음(전체 허용) | **운영 부팅 실패** — 미설정이 fail-open이라서입니다. 콤마 구분 목록 |
| `PRISM_WEB_APP_URL` | auth (검증은 세 서비스 모두) | `http://localhost:5173` | **운영 부팅 실패**. 로그인을 마친 브라우저가 돌아갈 주소 |

### 3-2. 세션·쿠키

수명 표기는 단위 없는 숫자면 **초**로 읽고(JWT `expiresIn` 관례), 접미사가 있으면 그
단위입니다(`ms`·`s`·`m`·`h`·`d`) — `900`과 `15m`이 같은 값입니다.

| 변수 | 서비스 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN` | auth | `15m` | 액세스 토큰 수명. **리프레시 수명보다 길면 부팅 실패** |
| `PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN` | auth | `12h` | 세션의 sliding idle 만료. 세션 쿠키 `maxAge`도 이 값 |
| `PRISM_COOKIE_NAMESPACE` | auth · api · socket | 없음 | 쿠키 이름 구분자. **한 호스트에 앱이 둘 이상일 때만**. 소문자·숫자·하이픈만 |
| `PRISM_NATIVE_AUTH_CALLBACK` | auth | `prism://auth/callback` | 네이티브 웹-redirect 로그인의 앱 콜백 스킴 |
| `PRISM_AUTH_DEMO_ENABLED` | auth | 켜짐 | `false`일 때만 꺼집니다(`/auth/demo*`가 503) |

> `PRISM_COOKIE_NAMESPACE`는 세 서비스가 **같아야** 합니다 — 발급(auth)과 읽기(api·socket)가
> 갈리면 쿠키를 못 찾아 인증이 전부 실패합니다. ⚠️ 운영 중에 바꾸면 전원 로그아웃됩니다.
>
> 활동과 무관한 절대 상한(7일)은 env로 열지 않습니다. 설정 한 줄로 "무한에 가까운
> 세션"을 만들 수 있어야 할 이유가 없고, 그건 배포 환경이 아니라 서비스의 정책입니다.

### 3-3. 데이터베이스

| 변수 | 서비스 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `PRISM_DATABASE_URL` | auth · api | `postgres://prism@localhost:5432/prism` | 마스터(쓰기). 비밀번호를 포함하므로 k8s Secret |
| `PRISM_DATABASE_REPLICA_URLS` | auth · api | 없음 | 읽기 복제 URL 콤마 목록. **있으면 replica 토폴로지, 없으면 single** |
| `PRISM_DB_REQUIRED` | auth · api | 코드 `false` / **차트 `true`** | `true`면 마스터 연결 실패가 부팅 실패 |
| `PRISM_DB_CONNECT_TIMEOUT_MS` | auth · api | `5000` | |
| `PRISM_DB_QUERY_TIMEOUT_MS` | auth · api | `10000` | |
| `PRISM_REDIS_REQUIRED` | auth · api · socket | `true` | `false`로만 끕니다 |
| `PRISM_REDIS_CONNECT_TIMEOUT_MS` | auth · api · socket | `5000` | |
| `PRISM_REDIS_COMMAND_TIMEOUT_MS` | auth · api · socket | `3000` | |

> socket은 **Postgres를 쓰지 않습니다** — 세션도 presence도 Redis에만 있습니다.
>
> 접속 URL 검증 실패 메시지에는 URL 원문이 들어가지 않습니다(비밀번호 노출 방지).

### 3-4. ICE — STUN · TURN (socket)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PRISM_STUN_URLS` | `stun:stun.l.google.com:19302` | 콤마 목록. `stun:`/`stuns:` 스킴이어야 합니다 |
| `PRISM_TURN_URLS` | 없음 | 콤마 목록. `turn:`/`turns:` |
| `PRISM_TURN_SECRET` | 없음 | coturn의 `COTURN_AUTH_SECRET`과 **같은 값**. 클라이언트에게 나가지 않습니다 |
| `PRISM_TURN_TTL` | `12h` | 발급하는 시한부 자격증명의 수명 |

> **URL과 비밀은 함께 있거나 함께 없습니다**(§1-4). 둘 다 없으면 공개 STUN 하나로
> 떨어지고, 통화는 대칭 NAT·엄격한 방화벽에서만 실패합니다.
>
> 수명이 짧을수록 새어 나간 값의 가치가 줄지만, 자격증명은 통화 수락 때 **한 번만**
> 발급되고 재협상과 릴레이 갱신이 같은 값을 다시 씁니다 — 통화보다 짧으면 멀쩡한
> 통화가 도중에 끊깁니다. 그래서 "어떤 통화보다 길되 무한하지 않은" 12시간입니다.

### 3-5. 푸시 — FCM (auth · socket)

| 변수 | 설명 |
| --- | --- |
| `PRISM_FCM_PROJECT_ID` | Firebase 프로젝트 id — `messages:send` 주소에 들어갑니다 |
| `PRISM_FCM_CLIENT_EMAIL` | 서비스 계정 이메일 — 액세스 토큰을 받을 때의 `iss` |
| `PRISM_FCM_PRIVATE_KEY` | 서비스 계정 비공개 키(PEM). 개행은 `\n`으로 눌러 넣으면 서버가 되돌립니다 |

> **셋은 함께 있거나 함께 없습니다**(§1-4). 미설정이면 푸시만 꺼지고 나머지는 그대로
> 동작하며, 목록의 `pushRegistered`가 전부 false로 접혀 화면이 거짓말하지 않습니다.
>
> auth는 푸시 화면의 전송을, socket은 소켓 없는 기기의 통화 깨우기를 맡습니다 —
> **두 서비스 모두** 필요합니다. 비공개 키는 클라이언트에게 나가지 않습니다.

### 3-6. 소셜 로그인 (auth)

미설정이면 그 provider만 비활성이고 데모 로그인은 그대로 동작합니다.
redirect URI는 배포에서 `PRISM_SERVICE_DOMAIN` 기준으로 차트가 자동 구성하므로,
아래 `*_REDIRECT_URI`는 로컬에서만 의미가 있습니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PRISM_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET` | 없음 | Google OAuth(웹 redirect) |
| `PRISM_GOOGLE_REDIRECT_URI` | `http://localhost:3000/auth/google/callback` | |
| `PRISM_GOOGLE_NATIVE_AUDIENCES` | 없음 | 네이티브 id_token의 추가 audience(콤마). 웹 clientId는 자동 포함 |
| `PRISM_APPLE_TEAM_ID` / `_CLIENT_ID` / `_KEY_ID` / `_PRIVATE_KEY` | 없음 | Apple Sign In. 비공개 키는 `.p8` 내용(개행 `\n` 허용) |
| `PRISM_APPLE_BUNDLE_ID` | 없음 | 네이티브 id_token의 audience |
| `PRISM_APPLE_REDIRECT_URI` | `http://localhost:3000/auth/apple/callback` | |
| `PRISM_KAKAO_CLIENT_ID` | 없음 | Kakao 로그인(웹 redirect) |
| `PRISM_KAKAO_CLIENT_SECRET` | 없음 | 콘솔에서 "client secret 사용"을 켠 경우만 |
| `PRISM_KAKAO_APP_ID` | 없음 | 숫자 app_id — 네이티브 로그인 토큰 대조 |
| `PRISM_KAKAO_REDIRECT_URI` | `http://localhost:3000/auth/kakao/callback` | |

### 3-7. 포트

| 변수 | 기본값 |
| --- | --- |
| `PRISM_AUTH_PORT` | `3000` |
| `PRISM_API_PORT` | `3001` |
| `PRISM_SOCKET_PORT` | `3002` |

> 배포에서는 세 컨테이너가 모두 3000으로 듣고 NodePort로 갈립니다(§6).

## 4. 클라이언트 빌드

세 클라이언트가 **같은 두 가지**를 받습니다 — API 주소와 소켓 주소. 이름만 플랫폼
관례를 따릅니다. 배포 스크립트는 이 둘을 `PRISM_SERVICE_DOMAIN`에서 만들고
(`https://<도메인>` · `wss://<도메인>/socket`), 다른 주소가 필요할 때만 덮어씁니다.

### 웹 (Vite)

빌드 시점에 번들에 박힙니다. `.env`가 셸의 `PRISM_*`를 `VITE_*`로 옮깁니다.

| 빌드 변수 | 셸 변수 | 기본값 | 비고 |
| --- | --- | --- | --- |
| `VITE_API_URL` | `PRISM_SERVICE_DOMAIN` | `http://localhost:3000` | `.env.prism` — prism 빌드에서만 |
| `VITE_SOCKET_URL` | `PRISM_SERVICE_DOMAIN` | `ws://localhost:3002/socket` | **`wss`여야 합니다** — 세션 쿠키가 `__Host-` 접두어라 Secure를 요구합니다 |
| `VITE_FIREBASE_API_KEY` | `PRISM_FIREBASE_API_KEY` | 없음 | 개발·배포가 같은 Firebase 프로젝트라 `.env`에 있습니다 |
| `VITE_FIREBASE_PROJECT_ID` | `PRISM_FIREBASE_PROJECT_ID` | 없음 | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `PRISM_FIREBASE_MESSAGING_SENDER_ID` | 없음 | |
| `VITE_FIREBASE_APP_ID` | `PRISM_FIREBASE_APP_ID` | 없음 | |
| `VITE_FIREBASE_VAPID_KEY` | `PRISM_FIREBASE_VAPID_KEY` | 없음 | 웹 푸시 인증서의 공개 키 |

> Firebase 값이 없으면 `firebaseWebConfig()`가 null을 돌려주고 **푸시만 꺼진 앱**이
> 됩니다 — 화면이 그 사실을 말합니다.

### iOS

| 변수 | 기본값 | 비고 |
| --- | --- | --- |
| `PRISM_API_URL` | 개발 서버 | 빌드 환경변수 → `Info.plist` → `APIEndpoint`. 릴리스는 `https://`여야 합니다 |
| `PRISM_SOCKET_URL` | 개발 서버 | 릴리스는 `wss://`여야 합니다 |

> 나머지(Google 클라이언트 ID·Kakao 네이티브 앱 키)는 env가 아니라
> [Config/Secrets.xcconfig](../apps/ios/Config/Secrets.example.xcconfig)에 둡니다 —
> ⚠️ xcconfig는 `//`를 주석으로 잘라먹으므로 **주소는 여기 두면 안 됩니다**.

### Android

우선순위는 **gradle 프로퍼티(`-P…`) > 환경변수 > `secrets.properties`**입니다 — 명령줄과
CI가 로컬 파일에 발목 잡히지 않게 한 순서입니다.

| 변수 | 프로퍼티 | 기본값 | 비고 |
| --- | --- | --- | --- |
| `PRISM_API_URL` | `prismApiUrl` | debug는 개발 서버 / **release는 빈 값** | 릴리스는 유효한 `https`가 아니면 **Gradle이 빌드 시점에 거절**합니다 |
| `PRISM_SOCKET_URL` | `prismSocketUrl` | debug는 개발 서버 / **release는 빈 값** | 같은 이유로 `wss` 검사 |
| `PRISM_GOOGLE_SERVER_CLIENT_ID` | `prismGoogleServerClientId` | 없음 | Google Cloud OAuth **웹(서버)** 클라이언트 ID |
| `PRISM_KAKAO_NATIVE_APP_KEY` | `prismKakaoNativeAppKey` | 없음 | Kakao SDK 초기화 + 복귀 스킴 |

> 릴리스의 기본값이 빈 값인 것은 **의도**입니다. 개발 서버를 기본으로 두면 설정을
> 빠뜨린 릴리스가 조용히 개발 서버에 붙습니다 — 빌드에서 막는 편이 낫습니다.
>
> 서명 키는 env가 아니라 [keystore.properties](../apps/android/keystore.example.properties)에서
> 옵니다(레포 밖 키스토어를 가리킵니다).

## 5. 저장소·TURN 컨테이너

값은 셸 → `.env` → compose → 컨테이너로 흐릅니다. 기본값이 적힌 것은 `.env`가 채웁니다.

### PostgreSQL ([infra/docker/postgres](../infra/docker/postgres/.env))

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `POSTGRES_PRIMARY_USER` / `_PASSWORD` | `postgres` / 없음 | primary 슈퍼유저 |
| `POSTGRES_STANDBY_USER` / `_PASSWORD` | `postgres` / 없음 | standby 슈퍼유저 |
| `POSTGRES_REPLICATION_USER` / `_PASSWORD` | `replicator` / 없음 | 스트리밍 복제 계정 |
| `PRISM_POSTGRES_DB` / `_USER` / `_PASSWORD` | `prism` / `prism` / 없음 | 앱이 쓰는 DB와 계정. 마이그레이션이 이 계정을 만듭니다 |
| `POSTGRES_PRIMARY_PORT` / `POSTGRES_STANDBY_PORT` | `5432` / `5433` | |
| `POSTGRES_REPLICATION_SLOT` / `_TYPE` | `replication_slot` / `physical` | |

마이그레이션([infra/postgres/migrate.sh](../infra/postgres/migrate.sh))은 위의
`POSTGRES_PRIMARY_USER`와 `PRISM_POSTGRES_DB`·`_USER`·`_PASSWORD`를 그대로 읽고,
컨테이너 이름만 `POSTGRES_PRIMARY_CONTAINER`(기본 `postgres-primary`)로 바꿉니다.

### Redis ([infra/docker/redis](../infra/docker/redis/.env))

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `REDIS_PASSWORD` | 없음 | `default`(관리) 사용자 |
| `PRISM_REDIS_USER` / `PRISM_REDIS_PASSWORD` | 없음 | 앱 전용 ACL 사용자 — 키는 `prism:*`로 격리됩니다 |
| `REDIS_PORT` | `6379` | |

### coturn ([infra/docker/coturn](../infra/docker/coturn/.env))

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PRISM_SERVICE_DOMAIN` | 없음 | `COTURN_REALM`이 됩니다 |
| `PRISM_TURN_SECRET` | 없음 | `COTURN_AUTH_SECRET` — 서버와 **같은 값**(§3-4) |
| `COTURN_EXTERNAL_IP` | 비움(자동 탐지) | **도메인이 아니라 공인 IP** — coturn이 조회 없이 그대로 후보에 싣습니다 |
| `COTURN_RELAY_IP` | 비움(자동 탐지) | 릴레이 소켓을 묶을 주소 |
| `COTURN_LISTENING_PORT` / `COTURN_TLS_PORT` | `3478` / `5349` | |
| `COTURN_MIN_PORT` / `COTURN_MAX_PORT` | `49100` / `49200` | 릴레이 범위 — 공유기에서 UDP로 열어야 합니다 |
| `COTURN_ALLOW_PRIVATE_PEERS` | `false` | 사설 대역 릴레이 허용(= SSRF 방어 해제). **로컬 시험에서만** |
| `COTURN_VERBOSE` | `false` | |

## 6. 배포 ([infra/deploy](../infra/deploy/README.md))

`config.sh`가 읽고 나머지 스크립트가 물려받습니다. `:?`가 붙은 것은 없으면 스크립트가
즉시 멈춥니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PRISM_SERVICE_DOMAIN` | **필수** | 웹·앱 빌드 주소, CORS, redirect URI, coturn realm의 원천 |
| `PRISM_REGISTRY` / `PRISM_REGISTRY_USER` | **필수** | 이미지 레지스트리 |
| `PRISM_REGISTRY_PASSWORD` | **필수** | push + k8s pull 시크릿 |
| `PRISM_WEB_DEPLOYMENT_PATH` | **필수** | 정적 웹 루트(예: `/var/www/prism`) |
| `PRISM_IMAGE_TAG` | `latest` | |
| `PRISM_AUTH_NODEPORT` / `PRISM_API_NODEPORT` / `PRISM_SOCKET_NODEPORT` | `30000` / `30001` / `30002` | nginx가 넘기는 포트 |
| `PRISM_NAMESPACE` | `prism` | |
| `PRISM_DEPLOY_REVISION` | 커밋 해시(dirty면 `-dirty-<epoch>`) | 파드 템플릿 애노테이션 — `latest` 태그에서 롤아웃이 조용히 무시되는 것을 막습니다 |
| `KIND_CLUSTER` | `kind` | |

> §3의 서버 변수는 **전부** 이 스크립트를 통해 k8s Secret·env로 흘러갑니다. 어느
> 서비스가 무엇을 받는지의 원천은 각 차트의 `templates/deployment.yaml`입니다.
>
> 차트는 값이 비어 있어도 **키를 항상 내보냅니다**(`value: ""`). 그래서 기본값을 차트에
> 복제하지 않습니다 — 두 곳에 적으면 언젠가 갈리고, 그때 어느 쪽이 사는지 배포를 봐야만
> 압니다. "빈 문자열은 미설정과 같다"는 계약은 스펙으로 고정돼 있습니다
> ([app-config.spec.ts](../apps/server/libs/config/src/app-config.spec.ts)).
> 예외는 `PRISM_DB_REQUIRED` 하나입니다 — 운영 정책이 코드 기본값과 달라 차트가 뒤집습니다.

## 7. 스토어 배포

### iOS — TestFlight

서명은 키체인이, 배포 API는 `.p8` 키가 맡습니다(그래서 `testflight-distribute.sh`는
GUI 세션이 아니어도 돕니다).

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PRISM_ASC_KEY_DIR` | `~/certs/apple/app-store-connect-api` | `AuthKey_<KEYID>.p8`이 사는 곳 |
| `PRISM_ASC_KEY_PATH` | 디렉터리에서 자동 탐색 | 키가 여럿일 때 직접 지정 |
| `PRISM_ASC_KEY_ID` | 파일명에서 유도 | |
| `PRISM_ASC_ISSUER_ID` | 키 옆 `issuer-id` 파일 | |
| `PRISM_TESTFLIGHT_GROUPS` | 앱의 모든 그룹 | 콤마 구분 |
| `PRISM_IOS_BUNDLE_ID` | `kr.hs.jung.prism` | |

### Android — Play

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PRISM_PLAY_SERVICE_ACCOUNT` | `~/certs/google/play-service-account.json` | Play Developer API 서비스 계정 키 |
| `PRISM_PLAY_TRACK` | `internal` | `alpha`=비공개, `beta`=공개 |
| `PRISM_ANDROID_PACKAGE` | `kr.hs.jung.prism` | |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | SDK 기본 경로 | APK 서명 확인(`apksigner`)에 씁니다 |

## 8. 테스트에서만 보는 변수

없으면 해당 스위트를 **건너뜁니다**(실패가 아닙니다). 프록시·서버까지 함께 있어야
드러나는 동작은 가짜 서버로 확인되지 않기 때문에 남겨 둔 자리입니다.

| 변수 | 무엇이 열리는가 |
| --- | --- |
| `PRISM_REDIS_URL` | 서버 통합 스펙 28개 — Lua 스크립트(`compareAndRenew` 등)까지 실제 Redis로 검증 |
| `PRISM_API_URL` | 실제 서버에 붙는 iOS UI 테스트 |
| `PRISM_LIVE_API_URL` | Android 라이브 프로브(`SessionLifetimeLiveTest`) |
