# Dashboard — 대시보드 기획

로그인 성공 후 진입하는 랜딩 화면. auth vertical slice에서 **인증 이후의 유일한
화면**이며, 현재 범위는 "**활성 세션 관리**"에 집중한다(내 계정이 지금 어디에서
로그인돼 있는지 보고, 원격으로 끊는다). 개인정보 미저장 원칙([auth.md](./auth.md))은
여기서도 그대로 유지된다 — 대시보드는 세션 메타(발급/만료 시각)만 다루고 PII는 담지 않는다.

> **다음 수직 슬라이스는 WebRTC.** 사이드바에 `WebRTC` 항목을 미리 예약해 두었고,
> 해당 슬라이스를 시작할 때 화면을 붙인다. 지금은 비활성(내비게이션 자리만).

---

## 1. 기능 요약 (Feature Log)

대시보드는 기능이 하나씩 붙는 화면이다. **기능을 추가할 때마다 여기에 한 항목을
남긴다.** 아래 상세 섹션(범위·흐름·API…)이 "지금의 전체 설계"라면, 이 로그는
"**무엇이 언제 왜 추가됐는지**"의 시간순 요약이다 — 최신 항목을 위에 쌓는다.

**항목 템플릿** (복사해서 맨 위에 붙인다)

```md
### <기능명> — <상태: 기획 | 구현 중 | 배포됨>
- 요약: 한 줄로 "무엇을 / 왜"
- 화면: Figma 노드 또는 링크 (없으면 —)
- 데이터/API: 관련 엔드포인트·모델 (없으면 —)
- 관련: 커밋 / PR / 이슈 (없으면 —)
- 추가: YYYY-MM-DD
```

> 규칙: 한 항목은 **사용자가 체감하는 기능 단위**로 남긴다(토큰 보정·리팩터 같은
> 내부 작업은 로그가 아니라 커밋으로 충분하다). 상태가 바뀌면 그 항목의 상태 표기만
> 갱신하고, 상세 설계 변화는 해당 섹션(§2~§9)에 반영한다.

<!-- ▼ 최신 항목을 이 아래에 쌓는다 ▼ -->

### 세션 기기 종류 — 구현 (server · web)

- 요약: 목록에서 "이 세션이 어떤 기기인가"를 알 수 있게 기기 **종류**(폰·태블릿·
  데스크톱·모름)를 표시한다. 기기명·브라우저·위치는 담지 않는다 — UA 원문과 IP를
  저장하지 않고 로그인 시점에 enum 하나로 접는다(§5).
- 화면: `Dashboard / Desktop · Mobile` — SessionRow의 제목 줄
- 데이터/API: `SessionInfo.device` 추가(`GET /auth/sessions`)
- 구현: `services/auth/src/session/device.ts`(UA → enum) · 세션 레코드에 enum 저장 ·
  `apps/web` 행 라벨/아이콘 · iOS·Android는 자기 기기가 보이도록 표준 토큰이 든
  User-Agent를 보낸다
- 추가: 2026-08-21

### 활성 세션 관리 — 구현 (web)

- 요약: 내 계정의 활성 세션을 조회하고, 개별/전체로 원격 폐기한다(다른 기기에서
  로그인된 세션 끊기 + 현재 세션 로그아웃).
- 화면: `Dashboard / Desktop · Mobile` — Active sessions 카드
  ([Figma](https://www.figma.com/design/sTDo6HDslOcRmWL78klk1I/Prism?node-id=2480-60))
- 데이터/API: `GET /auth/sessions` · `POST /auth/sessions/:id/revoke` ·
  `POST /auth/sessions/revoke-all` · `POST /auth/logout`
- 구현: `apps/web` — 앱 셸(사이드바 + 상단 바) + 세션 목록 · Revoke · Sign out all ·
  Log out, 로딩·빈·오류 상태. 각 행은 "기기 종류 + 현재/로그인된 세션 + 짧은 세션 id +
  시작·만료 시각"으로 표시한다 — 기기명·브라우저·위치는 담지 않는다(§5).
- 관련: `feat(web)` 세션 관리 구현 · i18n 문자열 추가(`i18n/client.csv`)
- 추가: 2026-08-03

---

## 2. 범위

- **앱 셸** — 좌측 사이드바(`Prism` 브랜드 · `Dashboard`(활성) · `WebRTC`(예약)) +
  상단 바(페이지 라벨 · 테마 스위처 · 언어 스위처 · 사용자 칩 · Log out)
  - 모바일(≤720px)에선 사이드바가 숨겨져 기능 이동 수단이 없었다 → 상단 바 햄버거로
    여는 **네비 드로어**(사이드바 슬라이드인 + 스크림)로 대체. 같은 nav 마크업을 재사용하고,
    Esc·스크림·닫기 버튼으로 닫으며 열림 시 포커스 이동·배경 스크롤 잠금(Figma `Dashboard /
    Mobile / Drawer (open)` 시안).
- **활성 세션 관리**
  - 세션 목록 조회 (`GET /auth/sessions`)
  - 개별 세션 원격 폐기 (Revoke)
  - 전체 세션 폐기 (Sign out all)
  - 현재 세션 로그아웃 (상단 바 Log out)

### 의도적 제외 (현재 슬라이스에서 빼는 것)

로그인 직후 대시보드 초안에는 인사말·통계 카드·계정 상세·프라이버시 카드가 있었으나
**모두 제거**하고 활성 세션 하나로 좁혔다.

- **통계/차트** — auth 슬라이스에는 집계할 도메인 데이터가 없다(허수 지표는 감점).
- **계정 상세/프로필 편집** — 개인정보 미저장 원칙상 편집·저장할 PII가 없다.
- **프라이버시 안내 카드** — 로그인 화면 문구로 이미 커버된다.

> 필요해지면 후속 슬라이스에서 다시 붙인다. v1은 "세션 관리"라는 **하나의 완결된
> 기능**으로 둔다.

---

## 3. 사용자 흐름

### 3.1 Happy Path

1. 로그인 성공 → Dashboard 진입
2. 세션 목록 로드 (`GET /auth/sessions`) — 현재 세션은 `isCurrent`로 표시
3. 다른 기기 세션의 `Revoke` 클릭 → 해당 행 폐기 → 목록에서 제거
4. `Sign out all` → 내 모든 세션 폐기 → 로그인 화면으로
5. 상단 바 `Log out` → **현재 세션만** 폐기 → 로그인 화면으로

### 3.2 상태 (Empty / Loading / Error)

| 상태    | 처리                                                                            |
| ------- | ------------------------------------------------------------------------------- |
| Loading | 세션 테이블 자리에 스켈레톤 행(3개) — 셸(사이드바·상단 바)은 먼저 그린다         |
| Empty   | 현재 세션 1개뿐 → "이 기기에서만 로그인돼 있어요" 안내(빈 표 대신 한 줄 문구)     |
| Error   | 테이블 영역에 `Molecule/Alert` Variant=Error + `다시 시도` (셸은 유지)           |

> 현재 세션은 항상 최소 1개 존재하므로 "0건" 진짜 빈 상태는 없다. Empty는 "나 혼자"다.

---

## 4. 화면 (Figma)

[Dashboard 페이지](https://www.figma.com/design/sTDo6HDslOcRmWL78klk1I/Prism?node-id=2480-60)
— `Dashboard / Desktop / Default`, `Dashboard / Mobile / Default` 2개 시안.

- **테마는 시안을 나누지 않는다.** 색이 전부 Colors 변수(Light/Dark 모드)에 바인딩돼
  있어, 프레임의 적용 모드만 바꾸면 다크가 나온다(웹은 `<html data-theme>`). 별도
  "Dark" 시안을 두지 않는다 — 관리 포인트만 늘고 값은 토큰이 쥔다.
- **콘텐츠는 Active sessions 카드 하나.** 데스크톱은 테이블, 모바일은 스택 카드.

각 행(row)의 구성:

- **Session** — 기기 종류 라벨 + 아이콘, 부제에 현재/로그인된 세션 + 짧은 id (§5)
- **Started** — 세션 시작 시각 (`startedAt`)
- **Expires** — 만료 시각 (`expiresAt`)
- **Status** — `Current`(Success) / `Active`(Info) 배지
- **(action)** — `Revoke` (현재 세션 행은 미노출)

### 컴포넌트 의존성

| 화면 요소       | 디자인 시스템 매핑                                          |
| --------------- | ---------------------------------------------------------- |
| 사이드바        | `Organism/Sidebar` (브랜드 + `Atom/NavItem` Active/Default) |
| 테마 스위처     | `Molecule/ThemeSelector`                                   |
| 언어 스위처     | `Molecule/LanguageSelector`                                |
| 사용자 아바타   | `Atom/Avatar` (Size=sm)                                    |
| Log out / Revoke| `Atom/Button` — Variant=Outline / Ghost                    |
| 상태 배지       | `Atom/Badge` — Variant=Success(Current) · Info(Active)      |
| 카드/행/아이콘  | 토큰: `Card` · `Border` · `Soft Blue` · `elevation/sm`, 아이콘 stroke=`Text Strong` |

> **다크 대비 보정(적용 완료)** — 다크 `Primary`를 `#5F92D8`로 밝혀 어두운 배경에서도
> 보이게 했고, 제목·기기명·아이콘은 `Navy`(다크 배경용) 대신 **`Text Strong`**
> 토큰(Light `#162338` / Dark `#FFFFFF`)에 바인딩해 다크에서 묻히지 않게 했다.

---

## 5. 데이터 / API 컨트랙트

세션 API는 auth 서비스에 이미 존재한다([auth.controller.ts](../apps/server/services/auth/src/auth.controller.ts)).
api 서비스가 아니라 auth 서비스가 발급/폐기의 원천이다([auth.md §6.2](./auth.md)).

### `GET /auth/sessions`

**Response 200**: `SessionListItem[]`

```ts
interface SessionInfo {
  id: string;
  startedAt: string; // ISO
  expiresAt: string; // ISO
}
interface SessionListItem extends SessionInfo {
  isCurrent: boolean; // 서버가 요청의 sessionId와 대조해 계산
}
```

### `POST /auth/sessions/:id/revoke`

소유자 범위 확인 후 해당 세션 폐기(`revokeOwnedSession`). 남의 세션 id를 넣어도
자기 것이 아니면 폐기되지 않는다(폐기 DoS 방지, [auth.md §6.2](./auth.md)).
**Response**: 성공 시 폐기, 대상 없음/미소유 시 실패 응답.

### `POST /auth/sessions/revoke-all`

내 **모든** 세션 폐기(`revokeAllSessions`) → 화면은 로그인으로.

### `POST /auth/logout`

**현재 세션만** 폐기(`revokeSession(sessionId)`) → **Response 204**.

> **정적 경로 우선** — 컨트롤러 선언 순서상 `sessions/revoke-all`을
> `sessions/:id/revoke`보다 **먼저** 둔다. 아니면 `revoke-all`이 `:id`에 흡수된다.
> `/auth/sessions`도 `/auth/:provider`보다 뒤에 두면 provider로 먹힌다.

### 결정됨: 기기 **종류만** — 기기명·브라우저·위치는 담지 않는다

Figma 시안은 `MacBook Pro · Chrome · Seoul, KR`을 보여준다. 그대로 담으려면 UA 원문과
IP를 저장해야 하는데, 그러면 개인정보 미저장 원칙이 깨진다. 그렇다고 아무것도 주지
않으면 "이 세션이 내 폰인지 회사 PC인지"를 알 수 없어, 목록의 본래 목적(모르는 세션을
찾아 끊기)이 흐려진다.

→ **가운데를 택한다.** 계약에 `device: 'phone' | 'tablet' | 'desktop' | 'unknown'`
하나만 더한다.

- **원문은 저장하지 않는다.** 로그인 요청의 User-Agent를 그 자리에서 네 갈래로 접고
  버린다(`services/auth/src/session/device.ts`). 저장소에 남는 것은 enum 하나뿐이라,
  저장소가 통째로 유출돼도 브라우저·OS 버전·기기 모델이 새어 나가지 않는다.
- **IP는 읽지도 않는다.** 위치는 이 슬라이스에서 다루지 않는다 — 국가만 담아도 geo-IP
  의존이 생기고, 로그인 화면의 "개인정보를 저장하지 않습니다"와 부딪힌다.
- **모르면 좁히지 않는다.** UA가 없거나 알아볼 수 없으면 `unknown`이다. 라벨이 조금 덜
  친절한 것이, 없는 정보를 지어내는 것보다 낫다.
- **앱도 같은 규칙으로 읽힌다.** iOS·Android가 브라우저와 같은 토큰(`iPhone`/`iPad`/
  `Android`+`Mobile`)이 든 User-Agent를 보내, 서버는 분류 규칙 하나만 갖는다.
- **예전 세션은 목록에서 사라지지 않는다.** 이 필드가 생기기 전에 만들어진 세션은
  값이 없다 — 거부하지 않고 `unknown`으로 접는다.

> 시안의 `Chrome · Seoul, KR` 자리에는 "현재 세션/로그인된 세션 + 짧은 세션 id"를 둔다.
> 기기명 대신 종류 라벨(휴대폰·태블릿·데스크톱)이 제목 줄에 온다.

---

## 6. 접근성 / i18n

- 테마(라이트/다크/시스템) · 언어 스위처는 로그인 화면과 동일 컴포넌트 재사용
- 다크 대비: 위 §4 보정으로 텍스트/아이콘/버튼 모두 대비 확보
- `Revoke`/`Sign out all`은 파괴적 액션 — 키보드 포커스 가시성 + 스크린리더 라벨
  (예: "Revoke session on phone") 필요. 라벨의 기기 부분은 §5의 종류 enum을 쓴다.

---

## 7. 개발 마일스톤

1. ✅ Figma 시안 (Desktop/Mobile · 테마 변수 대응, 별도 다크 시안 없음)
2. ✅ 디자인 토큰 sync — 다크 `Primary` 보정 + `Text Strong` 토큰 도입 (web 반영/배포)
3. ✅ 기기 메타 컨트랙트 결정 (§5) — **기기 종류만** 담는다(UA 원문·IP 미저장)
4. ✅ `apps/web` Dashboard UI — 셸 + 세션 목록 · Revoke · Sign out all
5. ✅ 서버 연동 (`GET /auth/sessions`, `POST .../revoke`, `.../revoke-all`, `logout`)
6. ✅ 상태 처리 (Loading · Empty · Error)
7. ⏳ iOS / Android 세션 화면 (동일 컨트랙트 재사용)
8. ⏳ WebRTC 슬라이스 착수 시 사이드바 `WebRTC` 활성화

---

## 8. 오픈 이슈

- ~~기기/브라우저/위치 표기~~ — **해결(§5)**: 기기 **종류**(폰·태블릿·데스크톱·모름)만
  계약에 담는다. UA 원문·IP는 저장하지 않으므로 기기명·브라우저·위치는 표시하지 않는다.
- **현재 세션의 Revoke** — 현재 세션 행은 `Revoke` 대신 상단 바 `Log out`으로 처리
  (자기 세션을 표에서 끊는 동작이 로그아웃과 중복되지 않게). v1 확정.
- **Sign out all 확인** — 즉시 실행 vs 확인 모달(`Organism/Modal`). 파괴적·비가역이므로
  확인 모달 권장. 문구 확정 필요.
- **세션 정렬** — 현재 세션 최상단 고정, 그다음 `startedAt` 최신순(제안).
- **WebRTC 진입점** — 사이드바 항목만 둘지, 대시보드에 카드형 바로가기도 둘지.
