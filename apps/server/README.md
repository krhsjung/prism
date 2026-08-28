# server

Prism 백엔드 — NestJS 기반 REST API, 도메인 소스 of truth.

서비스가 셋입니다 — `services/auth`(로그인·세션 발급), `services/api`(보호된 도메인 API),
`services/socket`(세션 presence WebSocket). 공유 코드는 `libs/`에 있고 `@app/*`로
참조합니다(`common` · `config` · `database` · `redis` · `session`).

## 실행

```bash
pnpm install
pnpm start:auth:dev   # auth 서비스 (watch)
pnpm start:socket:dev # socket 서비스 (watch)
pnpm start:dev        # api 서비스 (watch)
pnpm build            # api 프로덕션 빌드 → dist/
pnpm build:auth       # auth 프로덕션 빌드
```

저장소(PostgreSQL · Redis)가 먼저 떠 있어야 합니다 —
[../../infra/README.md](../../infra/README.md) 참고.

## 테스트

```bash
pnpm test         # 유닛 (Jest) — 300개
pnpm test:e2e     # E2E
```

Redis 통합 스펙(`libs/redis`, 26개)은 실제 Redis를 요구해 기본 실행에서는 skip됩니다.
`PRISM_REDIS_URL`을 주면 Lua 스크립트까지 함께 검증합니다 — `compareAndRenew`·
`slideSession`·`pruneExpired`는 **Redis 안에서** 실행되므로 메모리 구현으로는 확인되지
않습니다. 실제로 Lua의 변수 가림(`keep`)이나 `TTL == 0`에서 열려 버리는 분기는 이 스펙에서만
드러났습니다.

```bash
docker run -d --rm -p 6399:6379 redis:8.2
PRISM_REDIS_URL=redis://localhost:6399 pnpm test   # 326개 전부
```

## 세션

**토큰이 아니라 서버가 보유한 세션이 "로그인 상태"의 원천입니다.** 세션 행을 지우면
그 순간부터 발급된 토큰이 무효가 됩니다(즉시 폐기). 저장소는 Redis인데, 세션이
**만료가 본질인 데이터**라 본체가 키 TTL로 스스로 사라지기 때문입니다 — 만료된 행을
치우는 별도 작업이 필요 없습니다.

자격증명은 둘로 나뉩니다.

| | 무엇 | 수명 | 웹 | 네이티브 |
| --- | --- | --- | --- | --- |
| 액세스 토큰 | 서명된 JWT(세션 id만 담음) | 기본 15m | `HttpOnly` 쿠키 | Bearer |
| 리프레시 자격증명 | `<sessionId>.<secret>` — 저장소엔 해시만 | 기본 12h(sliding) | `HttpOnly` 쿠키 | body |

- **액세스 토큰은 "어느 세션인가"만 말합니다.** 사용자 정보는 세션 레코드에 있으므로
  토큰이 유출돼도 이름이 읽히지 않고, 폐기가 즉시 반영됩니다(stateless JWT라면 만료를
  기다려야 합니다).
- **리프레시는 1회용이라 쓰면 회전합니다.** 같은 값을 두 번 쓰면 실패하므로 탈취된
  자격증명의 병행 사용이 드러납니다 — 유예 창(30초) 밖의 재제시는 **재사용 탐지**로
  보고 세션을 폐기합니다. 창 안의 재제시는 탭 경합이라 세션을 유지합니다.
- **수명은 두 겹입니다** — 활동 기준 sliding idle(`PRISM_JWT_REFRESH_TOKEN_EXPIRES_IN`)
  과, 리프레시로도 넘을 수 없는 absolute 상한(7일). 상한은 env가 아니라 코드 상수입니다
  (`SESSION_ABSOLUTE_TTL_MS`) — "무한 연장 금지"는 배포 환경이 아니라 서비스의 정책입니다.
- 사용자별 인덱스(정렬 집합)가 "내 세션 목록 / 전체 로그아웃"을 받칩니다. 지나간 항목은
  접근할 때 걷어내고, 집합 키 자체도 마지막 항목의 만료 시각에 사라집니다 — 그러지 않으면
  다시 찾아오지 않는 사용자의 인덱스가 영영 남습니다.

### 유휴 창을 미는 것은 **활동**이지 회전이 아닙니다

sliding idle을 "리프레시가 돌면 민다"로 구현하면, 사람이 손대지 않아도 도는 회전이 전부
세션을 연장합니다. 실제로 그 구멍이 있었습니다 — 소켓이 "목록이 바뀌었다"를 뿌리면 각
기기가 목록을 다시 가져오고, 액세스 토큰이 짧아 그 재조회가 거의 매번 회전을 태웠습니다.
신호는 다른 기기가 붙거나 끊길 때마다 나가므로 **기기 둘이 서로의 세션을 영원히 살려내어**
유휴 만료가 사실상 사라집니다.

그래서 두 가지를 분리했습니다.

- **회전은 절대 밀지 않습니다.** `rotate()`는 `SET ... KEEPTTL`로 자격증명만 갈아 끼우고
  남은 수명을 그대로 물려줍니다. 남은 수명을 `PTTL`로 먼저 확인해 **없으면 실패**합니다 —
  이 자리는 fail-open이 곧 "만료된 세션의 무한 연장"이라 안전한 쪽이 거절입니다.
- **미는 것은 활동뿐입니다.** 클라이언트가 `X-Prism-Activity: 1`을 단 요청만 `JwtAuthGuard`가
  `SessionsRepository.touch()`로 창을 밉니다. 표식이 없으면 밀지 않습니다.

표식을 **없을 때 미는 쪽**이 아니라 **있을 때만 미는 쪽**으로 잡은 것이 핵심입니다. 웹의
쿠키는 `SameSite=Lax`라 같은 사이트의 이미지 태그·링크 하나로도 인증된 GET이 나갈 수 있는데,
"표식이 없으면 활동"이었다면 그 요청들이 전부 세션을 연장합니다. 커스텀 헤더는 단순 요청으로
붙일 수 없어(프리플라이트 대상) 남이 대신 붙여 줄 수 없습니다.

미는 일 자체는 Lua 하나(`slideSession`)로 원자적으로 처리합니다.

- 세션 본체·리프레시 키·사용자 인덱스 score를 **함께** 밉니다. 하나라도 빠지면 목록이
  실제 수명과 어긋나고, 전체 폐기가 살아 있는 세션을 놓칩니다.
- 밀지 말지는 **가장 적게 남은 키**로 정합니다(10초 최소 간격). 한 키만 보면 그 키만
  넉넉할 때 만료가 임박한 다른 키를 두고 건너뜁니다.
- 건너뛸 때도 **인덱스는 점검**해 어긋나 있으면 바로잡습니다. 건너뛴다는 것은
  "TTL을 안 민다"이지 "인덱스를 방치한다"가 아닙니다.
- 시각은 전부 **Redis의 시계**(`TIME`)로 찍습니다 — 생성·밀기·정리(`pruneExpired`)가
  같은 시계를 봐야 서버 시계가 흔들려도 목록이 흔들리지 않습니다.

밀기가 실패해도 요청은 성공합니다(경고만 남깁니다). 실패의 결과는 "세션이 예정대로 만료됨"
이고, 그것 때문에 사용자의 요청을 막을 이유가 없습니다.

쿠키는 운영에서 전부 `__Host-` 접두어가 붙습니다(Domain 금지 + Path=/ + Secure).
자세한 근거는 `libs/session/src/session-cookie.ts`, 정책은
[plan/auth.md](../../plan/auth.md) §6.

## 세션 presence 소켓 (`services/socket`)

대시보드의 세션 목록에는 HTTP만으로는 채울 수 없는 칸이 둘 있습니다 — **지금 실제로 붙어
있는가**(폴링 없이), 그리고 **다른 기기에서 방금 바뀌었는가**(내 화면이 어떻게 아는가).

- **연결이 곧 presence입니다.** 붙어 있는 동안만 `PRESENCE_TTL_MS`(60초)짜리 흔적을 남기고
  `PRESENCE_RENEW_MS`(20초)마다 갱신합니다. 파드가 죽으면 흔적이 스스로 사라지므로
  "붙어 있음"이 남아 거짓말을 하지 않습니다(정상 종료에서는 즉시 걷어냅니다).
- **소켓은 데이터를 나르지 않습니다.** 보내는 것은 `{ type: 'sessionsChanged' }` 하나이고,
  목록은 클라이언트가 기존 `GET /auth/sessions`로 다시 가져옵니다. 소켓이 목록을 직접 밀어
  넣으면 회전·401 처리·활동 표식이 전부 걸려 있는 그 HTTP 경로를 통째로 우회하게 되고,
  특히 **세션 N이 연 소켓이 세션 N+1의 화면에 목록을 주입하는** 경로가 열립니다.
- **같은 20초 스윕이 세션을 다시 검증합니다.** 몇 시간 살아 있는 연결이라 붙을 때 한 번
  본 것으로는 부족합니다 — 그사이 폐기된 세션의 소켓은 여기서 닫힙니다(`1008`). 그래서
  다른 기기에서 해제하면 **사용자가 아무것도 하지 않아도** 한 바퀴 안에 로그인 화면으로
  돌아갑니다.
- 스윕은 같은 자리에서 **하트비트**도 보냅니다. 클라이언트는 이것으로 "조용히 죽은 소켓"을
  알아챕니다(TCP는 상대가 사라진 것을 알려 주지 않습니다).
- 브로드캐스트는 50ms 모아 보냅니다. 탭 둘이 같은 창에서 동시에 붙는 흔한 경우에 알림이
  두 번 가지 않게 하되, **원인이 둘일 때는 아무도 제외하지 않습니다** — 각자를 자기 것에서
  빼면 서로의 접속을 아무도 모르게 됩니다.
- 업그레이드 인증은 HTTP와 **같은 규칙**입니다(`@app/session`의 `SessionAuthenticator`).
  브라우저는 쿠키로, 네이티브는 `Authorization` 헤더로 붙습니다. 5초 안에 인증되지 않으면
  끊습니다.

이 신호가 부른 재조회는 **활동이 아닙니다**(위 활동 표식). 그래서 화면을 열어 두기만 해도
세션이 무한히 연장되던 문제 없이, 목록만 실시간으로 맞춰집니다.

기획은 [plan/dashboard.md](../../plan/dashboard.md) §1.

## 인증 경계

`services/auth`가 세션을 **발급**하고, 나머지 서비스는 **검증만** 합니다.
검증에 쓰이는 것(토큰 서명 규칙 · 쿠키 이름 · 가드)은 전부 `@app/session`에 있습니다 —
서비스마다 따로 두면 인증의 원천이 둘이 되고, 한쪽만 고쳐지는 순간 구멍이 됩니다.

`services/api`는 전역 가드가 걸려 **모든 라우트가 기본 보호**입니다. 새 엔드포인트는
아무것도 하지 않아도 인증을 요구하고, 공개 경로만 `@Public()`로 표시합니다.

```typescript
@Public()          // 이게 없으면 인증 필요
@Get('healthz')
health() { ... }
```

정책 전반은 [plan/auth.md](../../plan/auth.md) §6 참고.

## 계약

`libs/common/src/types/contracts.ts`가 **모든 클라이언트가 공유하는 계약의 원천**입니다.
타입·순수 상수·디코더만 두고 프레임워크 의존은 넣지 않습니다 — 세 플랫폼이 그대로
컴파일하기 때문입니다.

```bash
pnpm sync:contracts    # 웹 사본 + iOS/Android 생성물 재생성
pnpm check:contracts   # 재생성 결과와 커밋된 파일 대조 (drift 검사)
```

| 대상 | 산출물 | 손으로 유지하는 것 |
| --- | --- | --- |
| 웹 | `apps/web/src/lib/contracts.gen.ts` | — (통째로 생성) |
| iOS | `Domain/Models/Auth/Contracts.gen.swift` | 모델 struct·디코더 (`AuthContracts.swift`) |
| Android | `domain/model/Contracts.gen.kt` | 모델·디코더 (`Contracts.kt`) |

## 다국어

서버는 오류 **코드**만 반환하고 문구는 클라이언트가 고릅니다(`contracts.ts`의
`AUTH_ERROR_CODES`). 번역이 필요한 것은 서버가 직접 그리는 화면 — OAuth 콜백
종료 페이지뿐이고, 그 문구는 `i18n/server.csv`에서 생성됩니다.

요청 언어는 `Accept-Language`로 정합니다(`libs/common/src/i18n/`). 웹이 고른 언어는
`localStorage`에 있어 출처가 다른 서버에서는 읽을 수 없습니다.

`libs/common/src/i18n/**/*.gen.ts`는 생성 파일이라 lint·prettier 대상에서 제외합니다 —
재생성은 [../../i18n/](../../i18n/)에서 합니다.

## 관련 문서

- 번역 마스터 / 생성기: [../../i18n/README.md](../../i18n/README.md)
- 인증 흐름 기획: [../../plan/auth.md](../../plan/auth.md)
- DB 스키마 / 마이그레이션: [../../infra/postgres/README.md](../../infra/postgres/README.md)
