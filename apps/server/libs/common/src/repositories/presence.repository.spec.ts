import { FakeRedis } from '@app/redis/testing/fake-redis';
import { PRESENCE_TTL_MS, PresenceRepository } from './presence.repository';

const KEY = 'prism:user_presence:u-1';

describe('PresenceRepository (Redis)', () => {
  let redis: FakeRedis;
  let repo: PresenceRepository;

  beforeEach(() => {
    jest.useFakeTimers();
    redis = new FakeRedis();
    repo = new PresenceRepository(redis);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const connected = () => repo.connectedSessionIds('u-1');

  it('연결을 등록하면 그 세션이 연결된 것으로 보인다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');
    expect([...(await connected())]).toEqual(['s-1']);
  });

  it('붙은 적 없는 사용자는 빈 집합이다', async () => {
    expect((await connected()).size).toBe(0);
  });

  // 탭 여러 개. 연결 단위로 세고 세션 단위로 읽으므로 한 번만 나와야 한다.
  it('한 세션이 소켓을 여럿 열어도 한 번만 나온다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');
    await repo.touch('u-1', 's-1', 'c-2');
    expect([...(await connected())]).toEqual(['s-1']);
  });

  // 이것이 member에 connectionId를 붙이는 이유다 — sessionId만 담으면 탭 하나를 닫을 때
  // 나머지 탭이 붙들고 있는 presence까지 사라진다.
  it('두 연결 중 하나가 끊겨도 나머지가 있으면 연결된 상태다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');
    await repo.touch('u-1', 's-1', 'c-2');

    await repo.remove('u-1', 's-1', 'c-1');

    expect([...(await connected())]).toEqual(['s-1']);
  });

  it('마지막 연결이 끊기면 연결 목록에서 사라진다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');
    await repo.touch('u-1', 's-1', 'c-2');

    await repo.remove('u-1', 's-1', 'c-1');
    await repo.remove('u-1', 's-1', 'c-2');

    expect((await connected()).size).toBe(0);
  });

  // 정상 종료는 TTL을 기다리지 않는다 — 기다리면 앱을 닫은 뒤에도 다른 기기의 목록에
  // 최대 1분간 Active로 남는다.
  it('정상 종료는 TTL을 기다리지 않고 즉시 사라진다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');
    await repo.remove('u-1', 's-1', 'c-1');
    expect((await connected()).size).toBe(0);
  });

  // 하드 크래시 — remove가 불릴 기회 없이 프로세스가 죽은 경우.
  it('하트비트가 끊기면 TTL이 지난 뒤 스스로 사라진다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');

    jest.advanceTimersByTime(PRESENCE_TTL_MS - 1);
    expect([...(await connected())]).toEqual(['s-1']);

    jest.advanceTimersByTime(2);
    expect((await connected()).size).toBe(0);
  });

  it('하트비트가 만료를 뒤로 민다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');

    // TTL 직전에 한 번 더 두드린다 — 같은 member의 score를 덮어쓴다.
    jest.advanceTimersByTime(PRESENCE_TTL_MS - 1);
    await repo.touch('u-1', 's-1', 'c-1');

    // 원래대로면 만료됐을 시점을 지나도 살아 있다.
    jest.advanceTimersByTime(2);
    expect([...(await connected())]).toEqual(['s-1']);
  });

  it('한 사용자의 여러 세션이 각각 보인다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');
    await repo.touch('u-1', 's-2', 'c-2');
    expect([...(await connected())].sort()).toEqual(['s-1', 's-2']);
  });

  // 키가 사용자별로 갈려 있어야 남의 연결이 내 목록에 섞이지 않는다.
  it('다른 사용자의 연결은 섞이지 않는다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');
    await repo.touch('u-2', 's-9', 'c-9');

    expect([...(await connected())]).toEqual(['s-1']);
    expect([...(await repo.connectedSessionIds('u-2'))]).toEqual(['s-9']);
  });

  // 저장소에 우리가 쓰지 않은 값이 들어와도 목록 전체가 무너지면 안 된다.
  it('우리 형식이 아닌 member는 조용히 버린다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');
    await redis.zAdd(KEY, Date.now() + PRESENCE_TTL_MS, 'no-separator');
    await redis.zAdd(KEY, Date.now() + PRESENCE_TTL_MS, ':leading-colon');

    expect([...(await connected())]).toEqual(['s-1']);
  });

  // 읽을 때 지나간 항목을 걷어내므로 인덱스가 스스로 정리된다.
  it('만료된 항목은 읽을 때 저장소에서도 걷힌다', async () => {
    await repo.touch('u-1', 's-1', 'c-1');
    jest.advanceTimersByTime(PRESENCE_TTL_MS + 1);

    await connected();

    expect(redis.indexSize(KEY)).toBe(0);
  });
});
