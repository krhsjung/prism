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
