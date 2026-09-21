import type { DatabaseClient } from '@app/database';
import { UsersRepository } from './users.repository';

// upsert 계약: master(query)로 가는 INSERT … ON CONFLICT + 행 → UserRecord 매핑.
describe('UsersRepository.upsert', () => {
  it('provider/provider_id 파라미터로 upsert하고 created_at을 ISO로 매핑한다', async () => {
    const createdAt = new Date('2026-07-02T00:00:00.000Z');
    const query = jest.fn().mockResolvedValue({
      rows: [{ id: 'u-1', provider: 'google', created_at: createdAt }],
      rowCount: 1,
    });
    const db: DatabaseClient = { query, read: jest.fn() };

    const user = await new UsersRepository(db).upsert('google', 'sub-123');

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO core\.users[\s\S]*ON CONFLICT/),
      ['google', 'sub-123'],
    );
    expect(user).toEqual({
      id: 'u-1',
      provider: 'google',
      createdAt: '2026-07-02T00:00:00.000Z',
    });
  });
});

// 계정 삭제 계약: master로 가는 DELETE + 지운 행이 있었는지.
describe('UsersRepository.deleteById', () => {
  it('id로 행을 지우고 true를 돌려준다', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const db: DatabaseClient = { query, read: jest.fn() };

    await expect(new UsersRepository(db).deleteById('u-1')).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM core\.users WHERE id = \$1/),
      ['u-1'],
    );
  });

  // 같은 요청이 두 번 와도 두 번째는 조용히 false — 지울 것이 없는 것은 오류가 아니다.
  it('이미 없는 id면 false', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const db: DatabaseClient = { query, read: jest.fn() };

    await expect(new UsersRepository(db).deleteById('gone')).resolves.toBe(false);
  });
});
