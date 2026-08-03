# deploy

web·services 빌드/배포 자동화 (셸 스크립트 + Helm).

## 대상 구조

`<your-domain>`(nginx, TLS) →
`/` web(정적), `/auth` auth(kind NodePort 30000), `/api` api(kind NodePort 30001).
이미지는 레지스트리(`<your-registry>/prism-*`)에 푸시, kind가 pull.
자세한 그림은 [../architecture.drawio](../architecture.drawio).

## 구성

```text
infra/deploy/
├── config.sh         # 공통 설정 (env 기반, 기본값)
├── build-push.sh     # auth·api 이미지 빌드 + 레지스트리 푸시
├── install.sh        # Helm 차트 설치 (env 치환 → 임시 values → helm → 삭제)
├── deploy-web.sh     # 웹 prism 빌드 → 웹 루트 배포
├── deploy-all.sh     # 전체 (build-push → install auth/api → deploy-web)
└── charts/
    ├── prism-auth/   # Deployment + NodePort Service + Secret(jwt)
    └── prism-api/    # Deployment + NodePort Service
```

## 필요한 환경변수 (시크릿은 셸 env로만, 레포에 두지 않음)

| 변수                           | 용도                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| `PRISM_SERVICE_DOMAIN`         | 서비스 도메인 (web 빌드 + CORS)                               |
| `PRISM_JWT_SECRET_KEY`         | auth JWT 서명 키 → k8s Secret                                 |
| `PRISM_REGISTRY_PASSWORD`      | 레지스트리 push + k8s pull 시크릿                             |
| `PRISM_REGISTRY`               | 이미지 레지스트리 호스트                                      |
| `PRISM_REGISTRY_USER`          | 레지스트리 사용자명                                           |
| `PRISM_WEB_DEPLOYMENT_PATH`    | web 정적 빌드 배포 경로 (deploy-web.sh, 예: `/var/www/prism`) |
| `PRISM_REDIS_URL`              | 세션 저장소 접속 URL (`redis://user:password@host:port`) → k8s Secret. 세션이 여기에만 있으므로 필수 |

세션 수명(선택 — 미설정 시 기본값). 표기는 단위 없는 숫자면 **초**로 읽고(JWT `expiresIn`
관례), 접미사가 있으면 그 단위로 읽는다(`ms` · `s` · `m` · `h` · `d`). `900`과 `15m`이 같은 값이다.
형식이 어긋나면 부팅에 실패한다 — 오타가 기본값으로 흡수되면 "설정했는데 안 먹는" 상태가 드러나지 않는다:

| 변수                                  | 용도                                                                              | 기본값 |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| `PRISM_JWT_ACCESS_TOKEN_EXPIRES_IN`   | 액세스 토큰 수명. 짧을수록 탈취 시 사용 가능 시간이 줄고, 그만큼 갱신이 잦아진다  | `15m`  |
| `PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN`  | 리프레시 자격증명 수명 = 세션의 sliding idle 만료. 세션 쿠키 `maxAge`도 이 값     | `12h`  |

> 액세스 수명이 리프레시 수명보다 길면 부팅에 실패한다 — 세션이 끝난 뒤에도 액세스
> 토큰만으로 통과하는 구간이 생겨 갱신이라는 개념이 성립하지 않는다.
>
> 활동과 무관한 상한(absolute, 7일)은 env로 열지 않는다. 설정 한 줄로 "무한에 가까운
> 세션"을 만들 수 있어야 할 이유가 없고, 그건 배포 환경이 아니라 서비스의 정책이다.

쿠키 이름(선택):

| 변수                     | 용도                                                                    | 기본값 |
| ------------------------ | ----------------------------------------------------------------------- | ------ |
| `PRISM_COOKIE_NAMESPACE` | 쿠키 이름에 끼워 넣는 앱 구분자 (`prism_session` → `prism_admin_session`) | 없음   |

> **한 호스트에 앱을 둘 이상 얹을 때만** 설정한다. `__Host-` 접두어는 호스트 단위
> 격리까지만 해주므로(Domain 금지 + Path=/), 호스트가 갈리는 배포에서는 필요 없다.
> 소문자·숫자·하이픈만 허용하며 그 밖의 문자는 부팅에 실패한다(쿠키 이름에 그대로 들어간다).
>
> ⚠️ **운영 중에 바꾸면 쿠키 이름이 달라져 전원 로그아웃된다.** 앱을 새로 얹을 때
> 그 앱에만 붙이고, 기존 앱은 미설정으로 두는 것이 안전하다.

인증 경계: auth 서비스가 세션을 발급하고 **api 서비스는 검증만** 한다(`@app/session` 공유).
api 서비스는 전역 가드가 걸려 있어 **모든 라우트가 기본 보호**이며, 공개 경로는
`@Public()`로 명시한다(현재는 `/healthz`뿐). 따라서 api 서비스도 auth와 동일하게
`PRISM_JWT_SECRET_KEY` · `PRISM_REDIS_URL` · `PRISM_DATABASE_URL`이 필요하다 —
키나 저장소가 갈리면 "발급은 되는데 검증은 실패하는" 상태가 된다.

소셜 로그인(미설정 시 해당 provider 비활성 — 데모 로그인은 그대로 동작):

| 변수                                                                                               | 용도                                                      |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `PRISM_GOOGLE_CLIENT_ID` / `PRISM_GOOGLE_CLIENT_SECRET`                                            | Google OAuth (web redirect)                               |
| `PRISM_APPLE_TEAM_ID` / `PRISM_APPLE_CLIENT_ID` / `PRISM_APPLE_KEY_ID` / `PRISM_APPLE_PRIVATE_KEY` | Apple Sign In (`PRISM_APPLE_BUNDLE_ID`는 네이티브용 옵션) |

데이터베이스(사용자 upsert). 표준 접속 URL(12-factor `DATABASE_URL`)로 지정한다:

| 변수                          | 용도                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `PRISM_DATABASE_URL`          | 마스터(쓰기) `postgres://user:pw@host:port/db` — 비밀번호 포함이므로 k8s Secret |
| `PRISM_DATABASE_REPLICA_URLS` | 슬레이브(읽기) URL 콤마 목록. **있으면 replica 토폴로지, 없으면 single**        |

> redirect URI(`/auth/{provider}/callback`)와 `PRISM_WEB_APP_URL`은 `PRISM_SERVICE_DOMAIN`
> 기준으로 차트가 자동 구성한다. Google/Apple 콘솔에는 `https://<도메인>/auth/google/callback`,
> `https://<도메인>/auth/apple/callback`을 등록한다.

DB 옵션: `PRISM_DATABASE_URL`(기본 `postgres://prism@host.docker.internal:5432/prism`) —
표준 접속 URL(비밀번호 포함 시 Secret으로 주입됨). 읽기 복제는 `PRISM_DATABASE_REPLICA_URLS`(콤마
목록)로 지정하며, 이 값이 있으면 replica 토폴로지·없으면 single로 동작한다.

옵션(기본값): `PRISM_IMAGE_TAG`(latest) · `PRISM_AUTH_NODEPORT`(30000) ·
`PRISM_API_NODEPORT`(30001) · `KIND_CLUSTER`(kind).

## 사용법

```bash
# 전체 배포
./infra/deploy/deploy-all.sh

# 개별
./infra/deploy/build-push.sh                 # 이미지 빌드/푸시
./infra/deploy/install.sh prism-auth          # Helm 설치/업그레이드
./infra/deploy/install.sh prism-api
./infra/deploy/install.sh prism-auth --template   # 렌더 미리보기 (클러스터 불필요)
./infra/deploy/install.sh prism-auth --uninstall
./infra/deploy/deploy-web.sh                  # 웹만
```

## 사전 준비

- kind 클러스터 가동 (`infra/docker/kind/create-cluster.sh`)
- 레지스트리 가동 + `docker login <your-registry>`
- nginx에 `/auth`·`/api` 프록시 location (이미 적용됨)

### nginx: `/auth/callback`은 SPA로 예외 처리

웹과 API가 한 도메인을 공유하므로 `/auth` 접두어가 겹친다. OAuth 성공 착지점
`/auth/callback`은 **웹 SPA 라우트**인데, `location /auth`가 이를 auth 서비스로
프록시해버리면 `GET /auth/:provider`에 흡수돼 `SIGNIN_FAILED`로 튕긴다.
exact match로 먼저 가로챈다(우선순위: `=` > 접두어):

```nginx
location = /auth/callback {
    root <web-root>;              # PRISM_WEB_DEPLOYMENT_PATH
    try_files /index.html =404;
}

location /auth { proxy_pass http://localhost:30000; ... }
```

> 웹에 `/auth` 하위 라우트를 새로 추가하면 같은 예외가 하나씩 더 필요하다.
