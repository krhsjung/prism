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
