// @app/redis 계약 — 세션처럼 수명이 짧고 만료가 본질인 데이터를 담는 저장소.
// 도메인 코드는 이 인터페이스에만 의존하므로 구현체 교체가 도메인에 영향을 주지 않는다.
// (@app/database와 같은 구조: 인터페이스 + DI 토큰 + forRoot(Async))

// 표준 접속 URL(redis://user:password@host:port). 12-factor DATABASE_URL 관례와 맞춘다.
export interface RedisConfig {
  url: string;
  // true면 부팅 시 연결 실패를 치명적으로 간주해 throw(=세션 저장소 필수).
  // 세션이 여기에만 있으므로 운영에서는 true여야 한다.
  required: boolean;
  // 네트워크 장애 시 명령이 무한 대기하지 않도록 두는 상한(ms).
  connectTimeoutMs: number;
  commandTimeoutMs: number;
}

// compareAndRenew 입력. 도메인 이름을 쓰지 않는다 — 이 라이브러리는 도메인 비의존이다.
export interface CompareAndRenew {
  // 비교·교체 대상.
  key: string;
  expected: string;
  next: string;
  ttlSeconds: number;
  // 값은 교체하되 **수명은 밀지 않는다**(남은 TTL을 그대로 쓴다).
  //
  // 세션의 유휴 창은 "사용자가 손을 뗀 지 얼마나 됐나"를 재는 값인데, 서버가 밀어 준
  // 신호 때문에 도는 배경 회전까지 창을 밀면 그 값이 사용자 활동을 말하지 않게 된다
  // (기기가 둘이면 서로가 서로의 세션을 영원히 살려낸다 — plan/auth.md §6).
  // 그렇다고 회전을 건너뛸 수는 없다: 자격증명은 1회용이라 교체 자체는 일어나야 한다.
  keepTtl?: boolean;
  // 같은 TTL로 함께 밀 키들.
  renewKeys: string[];
  // 함께 갱신할 정렬 집합 항목(선택).
  index?: { key: string; member: string; score: number };
  // 교체에 성공했을 때 "방금 소비된 값"을 남길 정렬 집합(선택).
  //
  // score를 소비 시각(epoch ms)으로 두는 것이 핵심이다. 나중에 어떤 값이 제시됐을 때
  // "한 번도 발급된 적 없는 값"과 "언제 소비된 값"을 구분할 수 있어야, 호출부가
  // 찰나의 경합과 뒤늦은 재사용을 다르게 다룰 수 있다.
  //
  // keep은 남길 최근 항목 수 — 이력이 세션 수명 내내 무한정 쌓이지 않게 자른다.
  consumed?: { key: string; member: string; score: number; keep: number };
}

/**
 * 세션의 유휴 창을 **민다**(sliding idle).
 *
 * 회전(compareAndRenew)과 분리되어 있는 것이 핵심이다 — 창을 미는 것은 자격증명 교체가
 * 아니라 **사용자 활동**이기 때문이다(plan/auth.md §6). 회전은 활동일 수도, 서버가 밀어 준
 * 신호 때문일 수도 있어 그 자리에서 판단할 수 없다.
 */
export interface SlideSession {
  /** 함께 밀 키들(세션 본체 · 리프레시 자격증명). 하나라도 없으면 아무것도 하지 않는다. */
  keys: string[];
  /** 새 수명(ms). 부르는 쪽이 absolute 상한으로 이미 잘라서 준다. */
  ttlMs: number;
  /**
   * 사용자 인덱스 — score가 만료 시각이므로 함께 밀어야 목록·전체 폐기가 맞는다.
   *
   * score는 **Redis가 자기 시계로** 계산한다(여기서 주지 않는다). 앱 시계로 찍으면
   * 왕복 시간만큼 실제 키 수명보다 이른 값이 남고, 그 틈에 목록·전체 폐기가 살아 있는
   * 세션을 놓친다 — 둘 다 인덱스만 보기 때문이다.
   */
  index: { key: string; member: string };
  /**
   * 마지막으로 민 뒤 이만큼도 지나지 않았으면 건너뛴다.
   *
   * 정확성이 아니라 **쓰기 절약**이다: 활동마다 미는 규칙을 그대로 두면 요청 하나에
   * 쓰기가 셋씩 붙는다. 창이 이 값만큼 줄어든 뒤에만 밀어도 유휴 만료의 의미는 같다.
   */
  minIntervalMs: number;
}

export const REDIS = Symbol('REDIS');
export const REDIS_CONFIG = Symbol('REDIS_CONFIG');

// 정렬 집합의 한 항목. 세션 인덱스에서 member=sessionId, score=만료 epoch(ms)로 쓴다.
export interface ScoredMember {
  member: string;
  score: number;
}

// 도메인 코드(리포지토리)의 유일한 Redis 의존점.
// 필요한 명령만 노출한다 — 클라이언트 전체를 흘리면 경계가 사라진다.
export interface RedisClient {
  // 값 + TTL(초). 세션 본체는 TTL로 자연 소멸한다.
  setEx(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  // 값을 읽으면서 **원자적으로** 지운다(GETDEL) — 일회용 토큰/코드의 소비에 쓴다.
  // get 후 del로 나누면 그 틈에 두 요청이 같은 값을 읽어 한 번만 유효해야 할 코드가
  // 두 번 소비될 수 있다.
  getDel(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;

  // 사용자별 세션 인덱스(정렬 집합).
  // ⚠️ score는 **만료 시각(epoch ms)** 으로 다룬다 — 항목을 넣으면서 집합 키의 수명을
  // 가장 늦게 만료되는 항목에 맞춘다. 그래야 마지막 항목이 사라질 때 키도 사라진다.
  zAdd(key: string, score: number, member: string): Promise<void>;
  zRem(key: string, ...members: string[]): Promise<number>;
  // score 구간을 잘라낸다 — 만료된 항목 정리에 쓴다.
  zRemRangeByScore(key: string, min: number, max: number): Promise<number>;
  zRangeWithScores(key: string): Promise<ScoredMember[]>;
  // 항목 하나의 score. 없으면 null — "집합에 없다"와 "score가 0이다"를 구분한다.
  zScore(key: string, member: string): Promise<number | null>;

  // 값이 expected와 같을 때만 교체하고, 그에 딸린 키들의 수명까지 **한 번에** 갱신한다.
  //
  // 원자성이 필요한 이유가 두 겹이다:
  //  1) 비교와 교체 — 동시 요청 중 하나만 성공해야 하고(회전된 토큰의 병행 사용 차단),
  //     틀린 값을 제시한 요청이 저장된 값을 건드리면 안 된다(읽고-지우고-비교하는
  //     방식은 아무나 남의 세션을 갱신 불가로 만들 수 있다)
  //  2) 딸린 갱신 — 교체만 성공하고 나머지가 누락되면 자격증명은 새것인데 본체는
  //     옛 수명이거나, 살아 있는데 인덱스에 없는 세션이 생긴다(목록·전체 폐기에서 누락)
  compareAndRenew(input: CompareAndRenew): Promise<boolean>;

  // 유휴 창을 민다(위 SlideSession). 밀었으면 true, 건너뛰었거나 세션이 없으면 false.
  slideSession(input: SlideSession): Promise<boolean>;

  // 지나간 정렬 집합 항목을 **Redis 시계 기준으로** 걷어낸다. score를 Redis가 찍으므로
  // 자르는 기준도 같은 시계여야 한다(앱 시계와 섞으면 시계 차이만큼 어긋난다).
  pruneExpired(key: string): Promise<number>;

  // 연결 확인(readiness).
  ping(): Promise<void>;
}
