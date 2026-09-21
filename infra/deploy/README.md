# deploy

web·services 빌드/배포 자동화 (셸 스크립트 + Helm).

## 대상 구조

`hsjung.asuscomm.com`(nginx, TLS) →
`/` web(정적), `/auth` auth(kind NodePort 30000), `/api` api(kind NodePort 30001),
`/socket` socket(kind NodePort 30002, WebSocket).
이미지는 레지스트리(`<your-registry>/prism-*`)에 푸시, kind가 pull.
자세한 그림은 Figma의 [Prism architecture](https://www.figma.com/design/APYl8ItHqxKabHaO7F4iCi/Prism-architecture).

## 구성

```text
infra/deploy/
├── config.sh         # 공통 설정 (env 기반, 기본값)
├── build-push.sh     # auth·api 이미지 빌드 + 레지스트리 푸시
├── install.sh        # Helm 차트 설치 (env 치환 → 임시 values → helm → 삭제)
├── deploy-web.sh     # 웹 prism 빌드 → 웹 루트 배포
├── deploy-all.sh     # 전체 (build-push → install auth/api → deploy-web)
├── ios-testflight.sh # iOS 아카이브 → App Store Connect(TestFlight) 업로드
├── android-bundle.sh # Android 서명된 AAB 빌드 (Play 내부 테스트에 올릴 파일)
├── android-apk.sh    # Android 서명된 APK 빌드 → 웹 루트 /dl/ (직접 설치용)
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

푸시 알림(미설정 시 푸시 비활성 — 나머지는 그대로 동작). **auth와 socket 두 서비스가
모두 필요하다**: auth는 푸시 화면의 전송을, socket은 소켓 없는 기기의 통화 깨우기를 맡는다:

| 변수                       | 용도                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `PRISM_FCM_PROJECT_ID`     | Firebase 프로젝트 id — `messages:send` 주소에 들어간다           |
| `PRISM_FCM_CLIENT_EMAIL`   | 서비스 계정 이메일 — 액세스 토큰을 받을 때의 `iss`               |
| `PRISM_FCM_PRIVATE_KEY`    | 서비스 계정 비공개 키(PEM). 개행은 `\n`으로 눌러 넣는다          |

> **셋은 함께 있거나 함께 없다** — 하나만 오면 부팅에 실패한다. 반쯤 설정된 채로 뜨면
> "푸시를 켰다고 믿는데 알림만 안 오는" 상태가 되고, 그건 통화가 `Call expired`로
> 끝나야만 드러난다(`PRISM_TURN_*`을 함께 묶는 것과 같은 이유).
>
> 미설정이면 목록의 `pushRegistered`가 **전부 false로 접힌다** — 화면이 `Will notify`라고
> 해 놓고 아무 일도 일어나지 않는 것보다, 처음부터 `Notifications off`라고 말하는 편이 정직하다.
>
> **비공개 키는 클라이언트에게 나가지 않는다.** 나가는 것은 이 키로 받아 온 액세스 토큰이
> 붙은 서버 → FCM 요청뿐이다. 앱 쪽 설정 파일(`google-services.json` ·
> `GoogleService-Info.plist`)과 웹 VAPID 키는 비밀이 아니지만 레포에 두지 않는다.

소셜 로그인(미설정 시 해당 provider 비활성 — 데모 로그인은 그대로 동작):

| 변수                                                                                               | 용도                                                      |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `PRISM_GOOGLE_CLIENT_ID` / `PRISM_GOOGLE_CLIENT_SECRET`                                            | Google OAuth (web redirect)                               |
| `PRISM_APPLE_TEAM_ID` / `PRISM_APPLE_CLIENT_ID` / `PRISM_APPLE_KEY_ID` / `PRISM_APPLE_PRIVATE_KEY` | Apple Sign In (`PRISM_APPLE_BUNDLE_ID`는 네이티브용 옵션) |
| `PRISM_KAKAO_CLIENT_ID` (`PRISM_KAKAO_CLIENT_SECRET`는 콘솔에서 켠 경우만)                         | Kakao 로그인 (web redirect)                               |
| `PRISM_KAKAO_APP_ID`                                                                               | Kakao 앱 숫자 app_id — 네이티브 로그인(`/auth/kakao/native`) 토큰 대조 |
| `PRISM_GOOGLE_NATIVE_AUDIENCES` (선택, 콤마 구분)                                                  | Google 네이티브 id_token 추가 audience (웹 clientId는 자동 포함)       |

네이티브 앱(선택):

| 변수                          | 용도                                                                                  | 기본값                   |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------ |
| `PRISM_NATIVE_AUTH_CALLBACK`  | 네이티브 웹-redirect 흐름(`flow=native`)의 콜백 주소. 앱이 여는 시스템 웹 세션이 여기로 돌아오고, 실린 일회용 코드를 `POST /auth/native/exchange`로 교환한다 | `prism://auth/callback`  |
| `PRISM_AUTH_DEMO_ENABLED`     | 원클릭 데모 로그인 스위치. `false`일 때만 꺼진다(`/auth/demo*`가 503)                   | 켜짐                     |

> 콜백 스킴을 바꾸면 **앱 쪽도 같이** 맞춰야 한다 — iOS는
> `ASWebAuthenticationSession`의 `callbackURLScheme`, Android는 `WebAuthActivity`의
> 인텐트 필터다. 한쪽만 바꾸면 로그인이 끝나고도 앱으로 돌아오지 못한다.

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
`PRISM_API_NODEPORT`(30001) · `PRISM_SOCKET_NODEPORT`(30002) · `KIND_CLUSTER`(kind).

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

### 배포해도 안 바뀌는 함정 — 이미지 태그와 롤아웃

이미지 태그는 `latest`로 고정이다(`PRISM_IMAGE_TAG` 기본값). 그래서 **새 이미지를 밀어
넣어도 Deployment 스펙은 그대로**이고, 쿠버네티스는 바뀐 게 없다고 보아 파드를 두 채로
둔다 — `helm upgrade`가 "Upgrade complete"를 내는데도 예전 코드가 계속 도는 상태가 된다.
실제로 겪었고, `kubectl get pods`의 AGE가 며칠 전인 것으로 드러났다.

`install.sh`가 배포 리비전을 계산해 파드 템플릿 애노테이션으로 심어 이 문제를 없앤다:

```yaml
template:
  metadata:
    annotations:
      prism.dev/revision: "a1b2c3d"   # install.sh가 채운다
```

- **시각이 아니라 커밋 해시다.** 시각으로 찍으면 코드가 그대로여도 `upgrade`마다 파드가
  죽었다 살아난다. 해시면 바뀌었을 때만 돌고, `kubectl describe`만으로 지금 무엇이 도는지
  알 수 있다 — `latest` 태그만으로는 알 수 없는 정보다.
- 커밋되지 않은 변경이 섞인 빌드는 해시가 같아도 내용이 다르므로 `-dirty-<epoch>`가 붙는다.
- `PRISM_DEPLOY_REVISION`으로 직접 줄 수도 있다(CI에서 빌드 번호 등).

> **한계 — 이건 롤백이 아니다.** 애노테이션은 "배포가 조용히 무시되는 것"만 막는다.
> `latest`는 여전히 움직이는 태그라 `helm rollback`을 해도 **이미지는 되돌아가지 않는다**
> (애노테이션만 예전 값이 되고 컨테이너는 그때의 `latest`를 받는다). 진짜 롤백이 필요하면
> `PRISM_IMAGE_TAG`에 커밋 해시를 넣어 이미지를 불변으로 만들어야 한다.

## 모바일 스토어 배포 (TestFlight · Play 내부 테스트)

두 스크립트 모두 앱이 붙을 주소를 `PRISM_SERVICE_DOMAIN`에서 만든다(`https://<도메인>` ·
`wss://<도메인>/socket` — 웹 빌드와 같은 규칙). 다른 주소가 필요할 때만 `PRISM_API_URL` ·
`PRISM_SOCKET_URL`로 덮어쓴다. 서명·업로드에 쓰는 설정 파일은 각 앱 안에 남아 있다.

```bash
./infra/deploy/ios-testflight.sh                 # 아카이브 → 업로드 → 베타 그룹 배정
./infra/deploy/ios-testflight.sh --export-only   # 지난 아카이브로 업로드만 다시
./infra/deploy/testflight-distribute.sh          # 이미 올라간 빌드를 그룹에 배정만
./infra/deploy/android-bundle.sh                 # 서명된 AAB 빌드 → Play 업로드
./infra/deploy/android-play-upload.sh            # 이미 만든 AAB를 트랙에 올리기만
```

### iOS — TestFlight

`ios-testflight.sh`가 Release 아카이브(`apps/ios/build/prism.xcarchive`)를 만들어
[apps/ios/Config/ExportOptions.plist](../../apps/ios/Config/ExportOptions.plist)(app-store-connect ·
destination=upload)로 곧장 올린다. 전체 출력은 `apps/ios/build/upload-testflight.log`에 남고,
실패하면 원인이 될 만한 줄을 끝에 뽑아 보여 준다.

- 서명 키와 App Store Connect 인증은 **로그인 키체인**에 있다. Terminal.app 같은 GUI 세션에서는
  처음 한 번 뜨는 키 접근 창에서 **항상 허용**을 누르면 되고, ssh·원격 터미널처럼 GUI 세션이
  아니면 키체인이 잠겨 있어 스크립트가 먼저 `security unlock-keychain`으로 잠금을 푼다(macOS
  로그인 비밀번호 입력). 그래도 `errSecInternalComponent`면 키 ACL을 한 번만 열어 준다:
  `security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db`.
  에이전트 셸처럼 비밀번호를 받을 터미널이 없는 곳에서는 실행되지 않는다.
- 서명은 자동(팀 `G9MQRF2U8G`)이다. 배포 인증서·App Store 프로파일이 없으면
  `-allowProvisioningUpdates`가 만들고, 빌드 번호는 이미 올라간 것과 겹치지 않게 Xcode가
  올린다(`manageAppVersionAndBuildNumber`). 마케팅 버전은 `MARKETING_VERSION`이다.
- App Store Connect에 번들 ID `kr.hs.jung.prism`의 앱 레코드가 먼저 있어야 한다 — 없으면
  업로드가 "App record … not found"로 거절된다. 사이트(My Apps ▸ +)에서 한 번 만들고
  `--export-only`로 업로드만 다시 하면 된다. 확장(`kr.hs.jung.prism.NotificationService`)은
  따로 만들지 않는다.
- `ITSAppUsesNonExemptEncryption = false`가 [apps/ios/Config/Info.plist](../../apps/ios/Config/Info.plist)에
  있어 올라간 빌드가 "Missing Compliance"에 멈추지 않는다(HTTPS·WSS·WebRTC의 표준 암호화만 씀).
- APNs 환경은 `aps-environment`를 Xcode가 배포 서명 때 `production`으로 바꾼다 — FCM은 APNs
  인증 키 하나로 두 환경에 다 보내므로 서버 쪽은 손댈 것이 없다.
- 업로드 끝에 `Upload Symbols Failed … dSYM for the WebRTC.framework` 경고가 난다. WebRTC는
  SPM이 받아 오는 미리 빌드된 바이너리라 dSYM이 없는 것이고, 앱 자체의 심볼은 올라간다 —
  크래시 로그에서 WebRTC 내부 프레임만 심볼이 안 풀릴 뿐이라 무시해도 된다.
- 공개 링크로 테스터를 받으려면 **External Testing** 그룹에서 Enable Public Link를 켠다.
  Test Information과 Beta App Review(첫 빌드는 보통 하루 안)가 필요하고, 심사 전에는 링크를
  열어도 "not accepting testers"다. Internal Testing은 심사가 없지만 이메일로만 초대한다.

#### 올린 빌드를 그룹에 넣는 것은 별도의 일이다

**외부 그룹에는 새 빌드가 저절로 들어가지 않는다.** 자동 배포 설정은 내부 그룹에만 있고,
외부 그룹의 "Automatically notify testers"는 심사 통과 후 알림만 정한다. 그래서 업로드마다
빌드를 그룹에 추가하는 단계가 필요하고, `testflight-distribute.sh`가 그것을 App Store
Connect API로 대신한다(`ios-testflight.sh`가 업로드 뒤 자동으로 부른다).

이 스크립트는 **서명 키가 아니라 API 키**를 쓰므로 키체인이 필요 없다 — GUI 세션이 아니어도
돈다. 자격증명은 레포에 두지 않고 키 디렉터리(기본 `~/certs/apple/app-store-connect-api`)에서
읽는다:

| 값 | 어디서 오는가 | 어떻게 준다 |
| -- | -- | -- |
| API 키(`.p8`) | App Store Connect ▸ Users and Access ▸ Integrations ▸ App Store Connect API (역할 App Manager) | 키 디렉터리에 `AuthKey_<KEYID>.p8`로 둔다(파일명이 곧 key id) |
| Issuer ID | 같은 화면 위쪽의 UUID | 키 옆에 `issuer-id` 파일로 두거나 `PRISM_ASC_ISSUER_ID` |

```bash
./infra/deploy/testflight-distribute.sh --list            # 앱의 베타 그룹과 공개 링크
./infra/deploy/testflight-distribute.sh                   # 최신 빌드 → 모든 그룹
./infra/deploy/testflight-distribute.sh --build 3 --group "Public"
```

- 그룹을 지정하지 않으면 앱의 **모든** 그룹을 훑는다. 기본값을 좁히려면
  `PRISM_TESTFLIGHT_GROUPS`에 콤마로 적는다. 키 디렉터리는 `PRISM_ASC_KEY_DIR`로 옮길 수 있다.
- 업로드 직후 빌드는 `PROCESSING`이라 배정이 거절된다 — 스크립트가 `VALID`가 될 때까지
  30초 간격으로 최대 30분 기다린다.
- **내부 그룹에는 배정하지 않고 확인만 한다.** 자동 배포가 켜진 내부 그룹은 처리가 끝난 빌드를
  스스로 받고, API로 넣으려 하면 422(`Cannot add internal group to a build`)로 거절된다.
- 외부 그룹 배정은 멱등이다(이미 있으면 204). 그래서 같은 빌드에 여러 번 돌려도 안전하다.
- 외부 그룹이 섞여 있으면 베타 심사까지 제출한다. 같은 마케팅 버전의 후속 빌드는 대개
  자동 승인이라 몇 분이면 풀리고(빌드 2는 실제로 그랬다), 버전을 올리면 다시 정식 심사를 받는다.

### Android — Play 내부 테스트

`android-bundle.sh`가 서명된 AAB(`apps/android/app/build/outputs/bundle/release/app-release.aab`)를
만들고, 서비스 계정 키가 있으면 `android-play-upload.sh`로 **업로드까지 이어서** 한다.

- **서명 키**: [apps/android/keystore.properties](../../apps/android/keystore.example.properties)가
  가리키는 업로드 키스토어(레포 밖, 예: `~/.android/prism-upload.jks`)로 서명한다. 파일이 없으면
  스크립트가 멈춘다. 키스토어와 비밀번호는 **백업**해 둔다 — 잃으면 Play Console의 업로드 키
  재설정 절차를 거쳐야 한다.
- **주소는 필수다.** 릴리스는 `PRISM_API_URL`(https)·`PRISM_SOCKET_URL`(wss)이 없거나 형태가
  틀리면 Gradle이 빌드 시점에 거절한다.
- **버전 코드**는 올릴 때마다 커져야 한다 — `apps/android/app/build.gradle.kts`의 `versionCode`.
- **첫 업로드는 Play Console 웹에서** 한다(API로는 앱을 만들 수 없다): 앱 만들기 → 테스트 ▸
  내부 테스트 ▸ 새 릴리스 만들기 → AAB 업로드 → 테스터 목록에 이메일 추가 → 옵트인 링크 복사.
  이때 **Play 앱 서명**이 켜지고, 올린 키가 업로드 키가 된다. 내부 테스트는 심사가 없지만
  이메일 목록(최대 100명)으로만 들어온다. 누구나 링크로 가입하는 것은 **공개 테스트**
  트랙이고, 스토어 등록정보·콘텐츠 등급과 Google 검토가 필요하다.
  두 번째 업로드부터는 `android-play-upload.sh`가 대신한다(아래).
- **소셜 로그인의 서명 지문을 추가로 등록한다**([apps/android/README.md](../../apps/android/README.md)
  "네이티브 로그인 설정"의 콘솔 등록 표). Play가 배포하는 APK는 **Play 앱 서명 키**로 다시
  서명되므로, Google Cloud의 Android OAuth 클라이언트에는 Play Console ▸ Google Play로 보호됨 ▸
  Play 스토어 배포 ▸ Play 앱 서명에 나오는 **앱 서명 키 SHA-1**을, Kakao에는 그 키 해시를 추가한다. 업로드 키 지문은 릴리스 APK를
  로컬에서 직접 설치할 때만 필요하다. 등록 전에는 Demo·redirect 로그인만 된다.
- 출시 노트는 언어당 500자다. 스크립트로 올릴 때는
  [release-notes/android](release-notes/android/README.md)의 `<언어>.txt` 파일이 그 자리다.

#### 업로드 자동화 — Play Developer API

`android-play-upload.sh`가 AAB를 트랙에 올리고 커밋한다. iOS의 `testflight-distribute.sh`와
같은 자리로, 서명 키가 아니라 **API 자격증명**만 쓰므로 키체인이 필요 없다.

```bash
./infra/deploy/android-play-upload.sh --list          # 트랙과 올라간 versionCode
./infra/deploy/android-play-upload.sh                 # 최신 AAB → internal 트랙
./infra/deploy/android-play-upload.sh --track alpha    # 비공개(closed) 테스트
```

준비는 한 번이다. **Play Console의 "API 액세스" 페이지는 없어졌다** — 예전에는 거기서 서비스
계정을 만들고 권한까지 한 번에 줬지만, 지금은 Google Cloud에서 만들어 Play Console에서
**사용자로 초대**한다:

```bash
# 1·2단계 (프로젝트는 prism = sturdy-torch-500911-r4)
gcloud services enable androidpublisher.googleapis.com --project <PROJECT>
gcloud iam service-accounts create prism-play --project <PROJECT>
gcloud iam service-accounts keys create ~/certs/google/play-service-account.json \
  --iam-account prism-play@<PROJECT>.iam.gserviceaccount.com
```

| 할 일 | 어디서 |
| -- | -- |
| Google Play Android Developer API 켜기 | Google Cloud ▸ API 및 서비스 (`androidpublisher.googleapis.com`) |
| 서비스 계정 + JSON 키 만들기 | Google Cloud ▸ IAM ▸ 서비스 계정. 키를 `~/certs/google/play-service-account.json`에 둔다(`PRISM_PLAY_SERVICE_ACCOUNT`로 경로 변경) |
| 그 계정을 **초대**하기 | Play Console ▸ 사용자 및 권한 ▸ 사용자 초대 → 서비스 계정 이메일 → 이 앱에 "릴리스" 권한(프로덕션·테스트 트랙 출시) |

> 초대 전에는 인증은 통과하고 **API 호출만 403**(`The caller does not have permission`)이다 —
> 키가 잘못된 것과 구분되는 신호다(키가 틀리면 토큰 발급에서 먼저 실패한다).

- 변경은 **edit** 안에 모였다가 커밋될 때 반영된다. 중간에 실패하면 아무것도 바뀌지 않는다.
- 트랙 기본값은 `internal`이다. `PRISM_PLAY_TRACK`으로 바꾸면 `android-bundle.sh`가 이어서
  부를 때도 그 트랙으로 간다.
- 서명되지 않은 AAB는 올리기 전에 걸러 낸다. `versionCode`가 이미 올라간 것과 같으면 Play가
  거절하므로 `apps/android/app/build.gradle.kts`에서 올린다. **한 번 쓴 버전 코드는 영구히
  못 쓴다** — 초안 릴리스를 지워도 그 번호는 돌아오지 않는다.
- 이미 올라간 빌드를 다른 트랙으로 옮길 때는 `--promote <versionCode>`를 쓴다(같은 AAB를 다시
  올릴 수 없기 때문이다). `--track alpha --promote 2`처럼 쓴다.

#### 스토어 등록정보 — android-play-listing.sh

등록정보의 **텍스트와 이미지는 API로 채운다.** 원천은 [store-listing/android](store-listing/android)다:

```text
store-listing/android/
├── <언어>/title.txt · short.txt · full.txt       # 제목 30자 · 간단한 설명 80자 · 자세한 설명 4000자
├── <언어>/_assets/screenshots/phone/*.png        # 그 언어의 스크린샷
└── _assets/
    ├── icon.png · feature-graphic.png            # 512x512 · 1024x500 (generate.sh가 앱 아이콘에서 만든다)
    ├── generate.sh                               # 위 두 장을 다시 만든다
    └── capture-screenshots.sh                    # 에뮬레이터에서 실제 화면을 찍는다
```

```bash
./infra/deploy/android-play-listing.sh --show     # 지금 Play에 있는 것
./infra/deploy/android-play-listing.sh            # 모든 언어의 텍스트 + 이미지
```

- 이미지는 **언어마다 따로** 올라간다. 언어 디렉터리에 파일이 있으면 그것을, 없으면 공용
  `_assets`를 쓴다(파일 단위로 고른다 — 스크린샷만 언어별로 두려고 아이콘까지 복사할 필요가 없다).
- 길이 상한은 **바이트가 아니라 글자**다. 넘으면 올리기 전에 막는다.
- 스크린샷은 `capture-screenshots.sh <언어>...`로 찍는다. 문구를 생성된 문자열 리소스에서 읽어
  **텍스트로 눌러** 좌표를 박지 않으므로, 해상도·언어가 달라도 같은 흐름이 돈다. 데모 로그인을
  쓰므로 서버가 떠 있어야 하고, 디버그 APK가 깔려 있어야 한다(`./gradlew :app:installDebug`).

> **설문은 API가 없다.** 콘텐츠 등급 · 데이터 보안 · 타겟 층 · 개인정보처리방침 · 국가 선택은
> Play Console에서만 채울 수 있다. 등록정보를 API로 다 채워도 첫 게시는 그 설문들 때문에
> 콘솔을 한 번 거쳐야 한다.

##### 초안 앱에서는 internal 트랙만 열린다

앱이 한 번도 게시된 적 없으면(Play의 **초안** 상태) `alpha`·`beta`·`production`에 정식
릴리스를 만들 수 없다 — 커밋이 `Only releases with status draft may be created on draft app`
으로 거절된다. `internal`만 예외로 바로 산다. 그래서 순서가 이렇게 된다:

1. `internal`로 올려 동작을 확인한다(지금 여기).
2. Play Console에서 **스토어 등록정보**(이름·설명·아이콘·스크린샷)와 **앱 콘텐츠**
   (개인정보처리방침·콘텐츠 등급·타겟 층·데이터 보안·광고 여부), 국가/지역을 채운다.
3. 첫 게시가 끝나면 `--track alpha`(비공개)·`--track beta`(공개)가 열린다.

그 전까지는 `--draft`로 빌드를 트랙에 걸어만 둘 수 있다 — 설정이 끝나는 대로 콘솔에서
게시만 누르면 된다. 트랙 이름과 콘솔 표기는 `internal`=내부, `alpha`=비공개, `beta`=공개다.

> 2023-11-13 이후에 만든 **개인** 개발자 계정은 프로덕션 접근 전에 **비공개 테스트에
> 12명 이상이 14일 연속 옵트인**해 있어야 한다. 그 전까지 `beta`(공개 테스트)는 열리지
> 않는다 — `internal`·`alpha`는 그대로 쓸 수 있다. 대시보드의 체크리스트가 남은 조건을
> 알려 준다. 그래서 지금 Android는 APK로 나간다([../../plan/distribution.md](../../plan/distribution.md)).

### Android — 설치용 APK (`/download`)

`android-apk.sh`가 **설치 가능한 APK**를 만들어 웹 루트의 `/dl/`에 놓는다. `android-bundle.sh`와
갈라 둔 이유는 산출물이 다르기 때문이다 — 저쪽은 Play에 올릴 **AAB**이고 **AAB는 설치할 수 없다.**

```bash
PRISM_SERVICE_DOMAIN=<도메인> PRISM_WEB_DEPLOYMENT_PATH=<웹 루트> \
  ./infra/deploy/android-apk.sh              # 빌드 → 서명 확인 → /dl/에 배치
./infra/deploy/android-apk.sh --no-publish   # 빌드만 (경로만 알려 준다)
```

- **`/dl/`은 웹 배포에서 제외된 자리다.** `deploy-web.sh`의 rsync가 `--delete`로 웹 루트를
  `dist/`와 맞추므로, 제외하지 않으면 웹을 배포할 때마다 APK가 조용히 사라진다.
- 파일은 둘로 놓인다 — `prism-<versionName>.apk`(이력)와 `prism.apk`(**고정 주소**). 안내
  페이지와 이력서가 가리키는 것은 뒤쪽이다. 링크는 한 번 나가면 못 고친다.
- **소셜 로그인 지문을 따로 등록해야 한다.** 이 APK는 업로드 키로 서명되므로 Play가 배포하는
  APK(Play 앱 서명 키)와 지문이 다르다. 스크립트가 빌드할 때마다 SHA-1·SHA-256을 찍어 주므로
  그 값을 Google Cloud의 Android OAuth 클라이언트와 Kakao에 등록한다. 등록 전에는 데모·
  리다이렉트 로그인만 된다.
- **nginx는 손댈 것이 없다.** `.apk`가 기본 mime.types에 없어 `application/octet-stream`으로
  나가는데, 브라우저는 그대로 내려받는다. 굳이 명시하려면
  `application/vnd.android.package-archive`지만 동작은 달라지지 않는다.
- 파일은 **약 52MB**다 — 직접 주는 APK는 모든 ABI를 담은 유니버설 APK여야 한다(AAB처럼
  기기별로 쪼개 줄 수 없다).
- 받는 사람이 보는 안내 페이지는 [apps/web/public/download/index.html](../../apps/web/public/download/index.html)
  (시안은 Figma `Download` 페이지). 웹 빌드에 실려 나가므로 `deploy-web.sh`가 배포한다.

## 사전 준비

- kind 클러스터 가동 (`infra/docker/kind/create-cluster.sh`)
- 레지스트리 가동 + `docker login <your-registry>`
- nginx에 `/auth`·`/api` 프록시 location (이미 적용됨) + `/socket` **WebSocket** location (아래)

### nginx: 정적 페이지는 **슬래시 없는 주소**로 서빙한다

`public/<이름>/index.html`로 둔 정적 페이지는 그냥 두면 `location /`의 `try_files $uri $uri/`가
**디렉터리로 잡아** `/<이름>/`로 301을 낸다. 이 주소들은 밖으로 나가는 주소라(이력서 ·
스토어 콘솔 · 로그인 화면의 링크) 사용자가 보는 주소가 적어 둔 주소와 달라지면 안 된다.
exact match(`=`)로 먼저 가로채 리다이렉트 없이 내보낸다:

```nginx
location = /download {
    root <web-root>;                      # PRISM_WEB_DEPLOYMENT_PATH
    add_header Cache-Control "no-cache";
    try_files /download/index.html =404;
}
```

> **정적 페이지를 새로 추가할 때마다 이 블록을 같이 추가한다.** 파일만 올리면 그 페이지만
> 슬래시가 붙는다. 현재 `/privacy` · `/account-deletion` · `/download` 셋이 이 패턴이다.
>
> `=`는 접두어보다 우선하므로 블록 위치는 상관없다. 리로드(`nginx -t` → `nginx -s reload`)
> 직후 한 번은 이전 워커가 옛 응답을 낼 수 있으니 확인은 한 박자 뒤에 다시 한다.
>
> ⚠️ 설정 **백업은 `servers/` 밖**에 둔다 — 아래 `include servers/*` 경고와 같은 이유다.

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

### nginx: `/socket`은 WebSocket으로 프록시한다

세션 소켓은 일반 프록시로는 **동작하지 않는다.** 업그레이드 헤더를 넘겨주지 않으면
nginx가 101을 평범한 응답으로 다뤄 핸드셰이크가 깨진다. (**적용 완료**)

`http` 블록에:

```nginx
# Connection 헤더는 업그레이드 요청일 때만 `upgrade`여야 한다 —
# 늘 붙이면 일반 요청의 keep-alive가 깨진다.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

`server` 블록에:

```nginx
location /socket {
    proxy_pass http://127.0.0.1:30002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    # 서버가 Origin 허용목록을 이 헤더로 검사한다(WebSocket은 CORS의 보호를 받지
    # 않으므로 서버가 막지 않으면 아무도 못 막는다).
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # 기본 60s면 유휴 소켓이 프록시에서 끊긴다. 서버가 20초마다 하트비트를 보내 실제로
    # 유휴는 아니지만, 수명을 프록시가 정하지 않게 상한을 넉넉히 둔다.
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    # 신호는 즉시 흘러야 한다 — 버퍼링하면 sessionsChanged가 묶여서 늦게 도착한다.
    proxy_buffering off;
}
```

- **접두어를 떼지 않는다**(`/api/`와 다르다). 서버가 경로를 `/socket`으로 검사해 우리 것이
  아닌 업그레이드를 404로 거절하기 때문이다(`services/socket/src/upgrade.ts`).
- **`localhost`가 아니라 `127.0.0.1`이다.** kind NodePort는 IPv4만 리스닝하는데 `localhost`는
  `::1`로 먼저 해석돼, 매 연결이 실패한 connect 한 번을 지불하고 에러 로그를 남긴다
  (`/auth`·`/api`가 같은 이유로 이미 그렇게 되어 있다).
- **운영에서는 반드시 `wss://`.** 세션 쿠키가 `__Host-` 접두어라 Secure를 요구하고,
  평문 `ws://`로는 쿠키가 실리지 않아 웹이 전부 인증에 실패한다.
- `/socket`은 웹 SPA 라우트·`/auth`·`/api`와 겹치지 않아 `/auth/callback` 같은 예외가 없다.

> ⚠️ **설정 백업을 `servers/` 안에 두지 말 것.** `include servers/*`가 `.bak` 파일까지
> 읽어 `duplicate upstream`으로 nginx가 뜨지 않는다(실제로 한 번 그렇게 멈췄다).
> 백업은 디렉터리 **밖**에 둔다.

### nginx: `index.html`은 캐시하지 않는다

자산은 파일명에 내용 해시가 붙으므로(`index-oq1YHm-B.css`) 영구 캐시가 안전하다. 반면
`index.html`은 **어느 해시의 번들을 쓸지 가리키는 파일**이라, 캐시되면 새로 배포해도
브라우저가 예전 번들을 계속 불러 배포가 반영되지 않는다. 기본 설정에는 `Cache-Control`이
없어 브라우저가 휴리스틱으로 캐시한다:

```nginx
location /assets/ {
    root <web-root>;              # PRISM_WEB_DEPLOYMENT_PATH
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}

location = /index.html {
    root <web-root>;
    add_header Cache-Control "no-cache";
}
```

- `no-store`가 아니라 `no-cache`다 — 받아 두되 쓸 때마다 ETag로 재검증한다.
- SPA 폴백(`try_files $uri $uri/ /index.html`)의 마지막 인자는 **내부 리다이렉트**라
  `location = /index.html`을 다시 탄다. 그래서 `/dashboard` 같은 경로도 헤더를 받는다.
- 반면 `location = /auth/callback`의 `try_files /index.html =404`는 리다이렉트 없이
  파일을 바로 내보내므로 그 위치에는 **같은 헤더를 따로 둬야 한다.**

> ⚠️ 백업 파일을 `servers/` 안에 두지 말 것 — `include servers/*`에 걸려 nginx가
> 중복 upstream으로 부팅에 실패한다(`nginx -t`로 먼저 확인).
