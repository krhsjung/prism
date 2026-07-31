import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule } from './database.module';
import { DATABASE, type PostgresConfig } from './database.types';
import { PostgresService } from './postgres';

// DATABASE 토큰 바인딩 계약: forRoot로 PostgresConfig를 넘기면
// PostgresService가 connect(풀 생성+연결 확인)된 상태로 바인딩된다.
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  })),
}));

// jest.mock이 Pool 생성자를 jest.fn으로 바꾸므로 mock 타입으로 본다(object 경유 캐스팅).
const PoolMock = Pool as object as jest.Mock;

const config: PostgresConfig = {
  mode: 'single',
  masterUrl: 'postgres://u@h:5432/d',
  required: false,
  connectTimeoutMs: 2_000,
  queryTimeoutMs: 3_000,
};

describe('DatabaseModule', () => {
  beforeEach(() => {
    PoolMock.mockClear();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('PostgresService가 DATABASE에 바인딩되고 master 풀이 생성된다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule.forRoot(config)],
    }).compile();

    expect(moduleRef.get(DATABASE)).toBeInstanceOf(PostgresService);
    expect(PoolMock).toHaveBeenCalledTimes(1); // single → master 풀만
  });
});
