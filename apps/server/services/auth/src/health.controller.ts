import { Controller, Get, HttpException, Inject } from '@nestjs/common';
import { DATABASE, type DatabaseClient } from '@app/database';
import { REDIS, type RedisClient } from '@app/redis';
import { PrismConfigService } from '@app/config';

// k8s 프로브용. liveness는 healthz(프로세스 생존), readiness는 readyz —
// 의존 저장소가 필수인 배포에선 응답까지 확인해 장애 시 Pod가 트래픽에서 빠지게 한다.
// 세션이 Redis에만 있으므로 Redis가 죽으면 모든 인증이 실패한다 — DB와 같이 확인한다.
@Controller()
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly config: PrismConfigService,
  ) {}

  @Get('healthz')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready(): Promise<{ status: string }> {
    if (this.config.postgresConfig.required) {
      try {
        await this.db.query('SELECT 1');
      } catch {
        throw new HttpException({ status: 'db_unavailable' }, 503);
      }
    }
    if (this.config.redisConfig.required) {
      try {
        await this.redis.ping();
      } catch {
        throw new HttpException({ status: 'session_store_unavailable' }, 503);
      }
    }
    return { status: 'ok' };
  }
}
