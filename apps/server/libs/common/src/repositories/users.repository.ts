import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type DatabaseClient } from '@app/database';
import type { AuthProvider } from '../types/contracts';

// core.users 행. 개인정보 미저장 정책상 PII 컬럼은 없다(provider + provider_id만).
export interface UserRecord {
  id: string;
  provider: AuthProvider;
  createdAt: string;
}

interface UserRow {
  id: string;
  provider: AuthProvider;
  created_at: Date;
}

// 도메인 리포지토리(공유). 엔진 비의존: DATABASE 토큰(DatabaseClient)만 주입받는다.
// (SQL은 현재 postgres 방언 — mysql 도입 시 방언 분기 필요)
@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  // 첫 로그인 시 자동 생성, 재로그인 시 updated_at만 갱신(upsert). 쓰기이므로 master로 간다.
  async upsert(
    provider: AuthProvider,
    providerId: string,
  ): Promise<UserRecord> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO core.users (provider, provider_id)
       VALUES ($1, $2)
       ON CONFLICT (provider, provider_id) DO UPDATE SET updated_at = now()
       RETURNING id, provider, created_at`,
      [provider, providerId],
    );
    const row = rows[0];
    // RETURNING이 있으므로 정상 경로에선 항상 1행 — 없다면 드라이버/스키마 이상.
    if (!row) throw new Error('users upsert returned no row');
    return {
      id: row.id,
      provider: row.provider,
      createdAt: row.created_at.toISOString(),
    };
  }
}
