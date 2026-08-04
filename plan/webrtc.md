# WebRTC — 1:1 화상 통화 기획 (제안)

Prism의 두 번째 수직 슬라이스. 인증 슬라이스가 "로그인 → 세션 → 배포"를 4플랫폼에
걸쳐 **구현 품질·일관성**으로 보여줬다면, 이 슬라이스는 거기에 **실시간(RTC)** 이라는
난이도 있는 축을 더한다 — 같은 백엔드/계약을 web·iOS·Android가 공유하는 그림은 그대로.

개인정보 미저장·원클릭 데모 원칙([auth.md](./auth.md))은 여기서도 유지된다: **미디어는
P2P로만 흐르고 서버를 거치지 않으며, 녹화·저장하지 않는다.** 방은 일시적(ephemeral)이고,
리뷰어는 로그인한 상태에서 **탭 두 개 또는 기기 두 대**로 혼자서도 통화를 시연할 수 있다.

> **상태: 확정.** §9 결정(1:1 화상/음성 콜 · TURN 포함 · `ws`)을 마쳤고, 다음은
> Figma 시안 → 구현이다.

---

## 1. 기능 요약 (Feature Log)

기능이 붙을 때마다 한 항목씩 쌓는다(형식은 [dashboard.md §1](./dashboard.md) 규칙과 동일).

```md
### <기능명> — <상태: 기획 | 구현 중 | 배포됨>
- 요약 / 화면 / 데이터·API / 관련 / 추가일
```

<!-- ▼ 최신 항목을 이 아래에 쌓는다 ▼ -->

### 1:1 화상 통화 — 기획

- 요약: 로그인 사용자가 일시적 방을 만들고 링크를 공유해 **1:1 P2P 화상/음성 통화**를
  한다. 미디어는 서버를 거치지 않으며(P2P), 녹화·저장 없음.
- 화면: Lobby(장치 미리보기 + 방 생성/참여) · In-call(2 타일 + 컨트롤) · 상태들
- 데이터/API: `POST /api/rooms`(방 발급) + **WS 시그널링**(offer/answer/ICE 릴레이)
- 관련: 기획 문서 최초 작성
- 추가: 2026-08-04

---

## 2. 범위

### 넣는 것 (v1)

- **1:1 P2P 화상/음성 통화** — mesh/SFU 없이 두 피어가 직접 연결.
- **일시적 방** — `POST /api/rooms`로 추측 불가한 id 발급, 링크/코드로 참여. TTL 후 소멸.
- **시그널링 게이트웨이** — api 서비스의 WebSocket. SDP offer/answer·ICE 후보를 방의
  두 피어 사이에서 **릴레이만** 한다(미디어는 안 지나간다). 세션으로 인증([auth.md §6.2]).
- **통화 컨트롤** — 마이크 음소거 · 카메라 on/off · 종료(hang up).
- **연결 가시화** — 연결 상태(connecting/connected/reconnecting/failed) + `getStats()`
  기반 RTT·비트레이트 등 간단 지표(실시간 엔지니어링 깊이를 화면에 드러낸다).
- **원클릭 데모** — "Start a call" 한 번으로 방+링크. 리뷰어가 탭 2개로 혼자 시연 가능.

### 의도적 제외

- **다자(N-party)·SFU/미디어 서버** — 1:1엔 불필요하고, 미디어 서버는 슬라이스 취지
  (도메인 복잡도 X, 구현 품질 O)와 인프라 비용을 키운다. 필요해지면 별도 슬라이스.
- **녹화·저장·자막** — PII·저장 유발. 미저장 원칙과 충돌.
- **채팅/파일 전송(데이터 채널)** — v1은 미디어에 집중(§9에서 대안으로 논의).

---

## 3. 사용자 흐름

### 3.1 Happy Path

1. 로그인 사용자가 `WebRTC` 진입 → **Lobby**. 카메라/마이크 권한 요청 + 셀프 프리뷰.
2. `Start a call` → `POST /api/rooms`로 방 id 발급 → In-call(대기: "링크를 공유하세요").
3. 상대가 링크로 참여 → WS로 `peer-joined` → **offer/answer/ICE 교환** → P2P 연결.
4. 두 타일(self·peer)에 미디어 표시. 컨트롤로 음소거/카메라/종료.
5. 한쪽이 종료 → `peer-left` → 상대는 Lobby로 복귀(또는 재시작 안내).

### 3.2 상태 / 오류

- **권한 거부** — Lobby에 안내 + 재요청 버튼(브라우저 권한 필요)
- **방 대기** — "이 링크를 공유하세요" + 복사 버튼, 셀프 프리뷰만 표시
- **방 꽉 참(3번째)** — `room-full` → 입장 거부 안내
- **연결 실패** — `failed` → ICE restart/재시도. TURN을 포함해 드물지만, 실패는 정직하게 노출
- **상대 이탈** — `peer-left` → 원격 타일 정리 + "상대가 나갔습니다"
- **네트워크 끊김** — `disconnected` → `reconnecting` 표시, ICE restart 시도

---

## 4. 화면 (Figma — 착수 예정)

Auth·Dashboard와 동일 파일/디자인 시스템을 쓴다. 테마는 변수 모드로 대응(별도 다크 시안 X).

- **Lobby** — 셀프 프리뷰(비디오) + 장치 선택 + `Start a call` / 코드로 참여
- **In-call** — self·peer 2 타일, 하단 컨트롤 바(음소거·카메라·종료), 연결 상태 배지,
  대기 시 링크 공유 카드
- **상태 시안** — 권한 거부 · 대기 · 연결 실패/재연결 · 상대 이탈

> 사이드바의 `WebRTC` 항목(현재 "준비 중")을 이 슬라이스가 배포될 때 활성 라우트로 바꾼다.

---

## 5. 기술 아키텍처

```text
 web/iOS/Android (피어 A)                     web/iOS/Android (피어 B)
        │  ┌───── WS 시그널링(SDP·ICE) ─────┐        │
        │  ▼                                ▼        │
        │  ┌──────────────────────────────────────┐ │
        │  │  api 서비스 (NestJS) — WebSocket G/W  │ │  ← 세션으로 인증(@app/session)
        │  │  방 상태·릴레이만. 미디어는 안 지남    │ │
        │  └──────────────────────────────────────┘ │
        └──────────  P2P 미디어(직접, 서버 미경유)  ─┘
                      STUN(공개) / TURN(coturn·env)
```

- **시그널링 = api 서비스의 WebSocket 게이트웨이.** api는 "도메인 기능" 담당이고
  기본이 보호(APP_GUARD)다 — WS 연결도 **세션 쿠키로 인증**해 로그인 사용자만 방을
  만들고 참여한다(`@app/session`의 검증 로직 재사용). 서버는 **SDP·ICE만 릴레이**하며
  미디어 트랙은 절대 지나가지 않는다.
- **방 상태**는 프로세스 메모리로 시작(단일 kind 노드). 다중 인스턴스로 가면 `@app/redis`
  pub/sub으로 승격(세션 저장소가 이미 redis라 결이 맞는다).
- **STUN/TURN**: 공개 STUN + **TURN(coturn)을 v1부터 포함**(대칭 NAT/방화벽에서도 연결).
  TURN 호스트·자격증명은 **env로만** 주입한다(레포에 금지, no-secrets 원칙). ICE 서버
  목록은 서버가 방 발급 시 내려주거나 설정에서 읽는다.
- **신규 의존성**: `@nestjs/websockets` + 전송(`ws` 권장 — 얕고 계약을 우리가 쥔다;
  socket.io는 재연결/룸이 편하지만 클라 런타임이 붙는다). 클라는 브라우저 표준
  `RTCPeerConnection`/`getUserMedia`(추가 라이브러리 없음).
- **nginx**: `/api` location에 **WebSocket Upgrade** 헤더 프록시 추가(또는 `/rtc` 전용
  location). 배포 문서([infra/deploy/README.md])에 WS 예외를 한 줄 더한다.

---

## 6. 시그널링 계약 (초안)

`contracts.ts`(→ web `contracts.gen.ts`, [auth.md] 패턴)에 **타입 + 디코더**로 둔다.
경계에서 파싱·검증(parse, don't validate)해 형식이 어긋나면 무시/오류.

```ts
// 클라 → 서버
type ClientMsg =
  | { type: 'join'; roomId: string }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: string }
  | { type: 'leave' };

// 서버 → 클라
type ServerMsg =
  | { type: 'joined'; peerPresent: boolean } // 방 입장 성공(상대 유무)
  | { type: 'peer-joined' }                  // 상대 입장 → offer 시작 신호
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: string }
  | { type: 'peer-left' }
  | { type: 'room-full' }
  | { type: 'error'; code: string };
```

- **누가 offer를 내는가** — 나중에 들어온 피어가 아니라, 서버가 `peer-joined`를 받은
  **기존 피어**에게만 offer 시작을 지시한다(양쪽이 동시에 offer하는 glare 방지).
- **방당 2명 상한** — 3번째는 `room-full`. 상한은 서버가 강제(클라 신뢰 X).
- **REST 최소화** — `POST /api/rooms`로 id만 발급하고, 나머지는 WS. 방 존재/정원 검증은
  WS `join`에서 한다(REST와 WS 상태가 갈라지지 않게).

---

## 7. 보안 체크리스트

- [ ] WS 연결을 **세션으로 인증**(비로그인 차단) — `@app/session` 재사용
- [ ] 방 id는 **추측 불가**(난수) + TTL 소멸. 정원 2명 서버 강제
- [ ] 시그널링은 **릴레이만** — 서버가 미디어를 보지 않음(P2P). **녹화·저장 없음**
- [ ] TURN 자격증명·STUN/TURN 호스트는 **env로만**(레포 미포함)
- [ ] 방 생성 **레이트리밋**(로그인당/IP당) — 남용 방지
- [ ] SDP/ICE 페이로드 크기 상한 + 형식 검증(디코더) — 릴레이 남용/오염 방지
- [ ] `getUserMedia`는 **명시적 사용자 제스처** 후 요청, 권한 거부 우아하게 처리
- [ ] 데모 계정도 통화 가능하되 공유 계정임을 감안(민감정보 입력 유도 X)

---

## 8. 개발 마일스톤

1. ✅ 기획 확정 (§9)
2. ⏳ Figma 시안 (Lobby · In-call · 상태들, 테마 대응)
3. ⏳ 시그널링 게이트웨이 (api WS + 세션 인증 + 방 상태 + 계약 디코더)
4. ⏳ `apps/web` 구현 (`getUserMedia` · `RTCPeerConnection` · 시그널링 · 컨트롤 · stats)
5. ⏳ TURN(coturn) 프로비저닝 + ICE 서버 구성(env) — 시그널링과 함께
6. ⏳ nginx WS Upgrade + 배포 (사이드바 `WebRTC` 활성화)
7. ⏳ ICE restart 재연결 · 상태 마감
8. ⏳ iOS/Android 패리티 (동일 시그널링 계약 재사용)

---

## 9. 결정 (확정)

1. **미디어 콜 vs 데이터 채널** → **1:1 화상/음성 콜**로 확정(임팩트 큼).
2. **TURN** → **v1부터 TURN(coturn) 포함**(env 주입). 대칭 NAT/방화벽에서도 연결되게 한다.
3. **시그널링 전송** → **`ws`**(얕고 계약을 우리가 쥔다). socket.io 미사용.

## 10. 오픈 이슈

- **TURN 운영** — v1부터 TURN(coturn)을 포함하므로 대칭 NAT/방화벽도 뚫린다. 대신 coturn
  프로비저닝·자격증명 회전·대역폭이 운영 항목으로 추가된다(env·인프라 차트에서 관리).
- **탭 2개 셀프 시연** — 같은 계정으로 두 세션이 한 방에 들어오는 케이스 허용(리뷰어 편의).
  정원 2명·중복 세션 구분만 명확히.
- **모바일 권한/백그라운드** — iOS/Android는 권한·백그라운드·오디오 라우팅이 web과 다르다.
  패리티 단계에서 별도 처리(계약은 동일).
