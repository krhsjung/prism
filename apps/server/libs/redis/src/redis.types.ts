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

  // 연결 확인(readiness).
  ping(): Promise<void>;
}
