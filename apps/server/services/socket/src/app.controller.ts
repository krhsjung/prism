import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '@app/session';
import { REDIS, type RedisClient } from '@app/redis';

@Controller()
export class AppController {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  // ⚠️ 프로브 경로는 **반드시** @Public()이어야 한다 — 쿠버네티스는 자격증명을 붙이지
  // 않으므로, 전역 가드(socket.module.ts)에 걸리면 파드가 영영 Ready가 되지 않는다.
  @Public()
  @Get('healthz')
  health(): { status: string } {
    return { status: 'ok' };
  }

  // liveness와 나누는 이유: 이 서비스는 Redis 없이는 아무 일도 못 한다(presence가 거기 있다).
  // Redis가 끊겼을 때 트래픽을 받으면 모든 세션이 조용히 "연결 없음"으로 보인다 —
  // 프로세스는 살아 있으니 liveness로는 잡히지 않는다.
  @Public()
  @Get('readyz')
  async ready(): Promise<{ status: string }> {
    await this.redis.ping();
    return { status: 'ok' };
  }
}
