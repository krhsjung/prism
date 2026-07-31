import { Controller, Get, HttpException, Inject } from '@nestjs/common';
import { DATABASE, type DatabaseClient } from '@app/database';
import { PrismConfigService } from '@app/config';

// k8s 프로브용. liveness는 healthz(프로세스 생존), readiness는 readyz —
// DB가 필수(PRISM_DB_REQUIRED=true)인 배포에선 master 응답까지 확인해,
// DB 장애 시 Pod가 트래픽에서 빠지게 한다. 데모(DB 비필수) 배포는 항상 ready.
@Controller()
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
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
    return { status: 'ok' };
  }
}
