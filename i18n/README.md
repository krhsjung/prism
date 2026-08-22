# i18n

번역 소스 of truth — 마스터 CSV 하나에서 플랫폼별 번역 파일을 생성합니다.

문구를 각 앱에 흩어 두면 같은 문장이 플랫폼마다 갈라지고, 언어를 하나 추가할 때
네 곳을 따로 손봐야 합니다. 여기서는 마스터만 고치고 생성기를 돌립니다.

## 구조

```text
i18n/
├── locales.json          # 지원 언어 목록 (코드 · 표시 이름 · 쓰기 방향)
├── client.csv            # 클라이언트(web · iOS · Android) 문구 마스터
├── server.csv            # 서버가 직접 그리는 문구 마스터
├── scripts/generate.js   # CSV → 플랫폼별 산출물
└── package.json
```

## 사용

```bash
node scripts/generate.js            # 전체 생성
node scripts/generate.js client     # 한 서비스만
node scripts/generate.js --check    # 커밋된 산출물이 마스터와 일치하는지 검사
```

의존성이 없어 `install` 없이 바로 실행됩니다(`pnpm generate` / `pnpm check`도 동일).

## 산출물

| 서비스 | 플랫폼 | 경로 | 형식 |
| --- | --- | --- | --- |
| client | web | `apps/web/src/lib/i18n/` | `messages.gen.ts` + `locales/{lang}.gen.ts` |
| client | iOS | `apps/ios/prism/Resources/Localization/` | `{Module}.xcstrings` + `Messages.gen.swift` |
| client | Android | `apps/android/app/src/generated/res/values[-{lang}]/` | `strings_{module}.xml` |
| server | server | `apps/server/libs/common/src/i18n/` | `messages.gen.ts` + `locales/{lang}.gen.ts` |

산출물은 전부 **커밋합니다**. 컴파일·번들 대상이라 없으면 빌드가 되지 않고, 계약
파일(`contracts.gen.ts`)과 같은 이유로 저장소에 있는 것이 실제로 도는 것과 같아야
합니다. 새 플랫폼을 추가할 때는 `scripts/generate.js`의 `TARGETS`에 `dir`·`suffix`를
더하면 잔재 정리·`--check`가 함께 걸립니다.

> **iOS** — `.xcstrings`를 앱 타깃 폴더 안에 두면 충분합니다(Xcode의 파일 시스템 동기화
> 그룹이라 놓으면 빌드에 들어갑니다). 타입 안전 키(`MessageKey`)도 함께 생성합니다.
> 언어를 늘릴 때는 `prism.xcodeproj`의 `knownRegions`에도 코드를 더해야 그 언어의
> `.lproj`가 번들에 생성됩니다.
>
> **Android** — 전용 생성 소스셋(`app/src/generated/res`)에 넣고 `build.gradle.kts`의
> `sourceSets`에서 `res.srcDir`로 등록합니다. 손으로 쓴 `res/`와 섞이지 않아 잔재
> 정리가 안전합니다. 리소스 이름은 `[a-zA-Z0-9_]`만 되므로 키의 점을 언더스코어로
> 바꿉니다(`auth.welcome_back` → `R.string.auth_welcome_back`). R.string 자체가
> 컴파일 타임에 검증되므로 별도 키 열거형은 만들지 않습니다.

## 마스터 포맷

```csv
module,key,en,ko,ja
auth,# 로그인 화면,,,
auth,welcome_back,Welcome back,다시 오셨네요,おかえりなさい
```

- **module**: 화면·영역 단위 묶음. 산출물의 파일 분할 기준이 됩니다(iOS/Android).
- **key**: `snake_case`. 최종 키는 `{module}.{key}`(예: `auth.welcome_back`).
- **주석 행**: key 칸을 `#`으로 시작하면 그 자리에 주석으로 옮겨집니다.
- **열 구성**: `locales.json`의 코드 순서와 정확히 같아야 합니다(다르면 생성 실패).
- 값에 쉼표가 있으면 `"..."`로 감싸고, 줄바꿈은 `\n`으로 적습니다(한 줄 = 한 키).

## 규칙

- 마스터가 진실의 원천 — **산출물은 직접 고치지 않습니다**(헤더에도 명시됩니다).
- 키를 더하거나 지울 때는 모든 언어 열을 함께 손봅니다. 빈 칸은 원본 언어(첫 열)로
  채워 생성하고 누락 목록을 경고로 출력합니다 — 언어마다 키 집합이 달라지면
  생성된 타입(`Messages`)이 성립하지 않기 때문입니다.
- 문장을 조각내지 않습니다. 언어마다 어순이 달라 이어 붙이면 번역이 불가능해집니다
  (`Signed in as {name}` ↔ `{name} 님으로 로그인했습니다`).
- 변수는 두 종류이고 서로 겹치지 않습니다.
  - `{name}` — 런타임 값. 클라이언트가 그릴 때 채웁니다.
  - `{{platform}}` — 빌드 시점 값. 생성기가 플랫폼 이름(Web · iOS · Android)으로
    바꾸고, 서버 산출물에서는 지웁니다.
- 로고 워드마크("Prism")는 번역 대상이 아닙니다 — 마스터에 넣지 않습니다.
- **브랜드명은 옮기지 않습니다.** 마스터에 들어가더라도 모든 언어 열에 같은 값을 둡니다
  (`iPhone`·`Galaxy`·`Windows`…). 고유명사라 옮기면 오히려 못 알아보고, 한쪽 언어만
  옮기면 같은 목록 안에서 `iPhone`과 `갤럭시`가 섞여 규칙이 없어 보입니다.

## 언어 추가

1. `locales.json`에 `{ code, label, dir }` 추가 (label은 **그 언어로** 표기).
2. 두 CSV에 같은 코드의 열을 추가하고 값을 채웁니다.
3. `node scripts/generate.js` 실행 후 산출물까지 함께 커밋합니다.

웹은 기본 언어만 번들에 정적으로 포함하고 나머지는 동적 import로 나누므로, 언어가
늘어도 초기 번들은 커지지 않습니다.

## drift 방지

산출물을 커밋하는 만큼 마스터와 어긋날 수 있습니다. `--check`가 재생성 결과와 파일을
대조해 불일치·누락·마스터에 없는 잔재를 잡아냅니다(계약의 drift 테스트와 같은 역할).

## 사용하는 쪽

- 웹 런타임(언어 감지 · 선택 저장 · `t()`): [../apps/web/README.md](../apps/web/README.md)
- 서버(Accept-Language 해석): `apps/server/libs/common/src/i18n/`
