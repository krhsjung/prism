import type { INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'http';
import { PrismConfigService } from './config.service';

export interface BootstrapOptions {
  // listen 직전, HTTP 서버가 만들어진 뒤에 한 번 불린다 — WebSocket처럼 **같은 서버에
  // 얹히는 것**을 붙이는 자리다. 넘기지 않은 서비스(api·auth)에는 아무 일도 일어나지
  // 않으므로, 이 훅이 생겼다고 기존 부팅 경로가 달라지지 않는다.
  onHttpServer?: (server: Server, app: INestApplication) => void;
}

// 서비스 공통 HTTP 부팅 — CORS·포트 정책을 PrismConfigService(PRISM_* env)로 일원화한다.
// 전제: appModule이 PrismConfigModule을 import하고 있어야 한다.
export async function bootstrapHttpApp(
  appModule: Type<object>,
  portOf: (config: PrismConfigService) => number,
  options: BootstrapOptions = {},
): Promise<void> {
  // 상세 흐름 로그(logger.debug)는 **개발에서만** 남긴다 — 운영/공개 로그가 흐름·타이밍을
  // 흘려 활동 추적에 쓰이지 않도록(포트폴리오 리뷰어 상관관계 방지). error/warn/log만 운영에.
  const isProduction = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(appModule, {
    logger: isProduction
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const config = app.get(PrismConfigService);
  // 클라이언트(dev) 교차 출처 허용. 운영에서는 PRISM_CORS_ORIGIN으로 제한.
  app.enableCors({ origin: config.corsOrigins ?? true, credentials: true });
  // SIGTERM에 onModuleDestroy가 돌게 한다.
  //
  // 소켓 서비스에는 이것이 **정확성** 문제다: 롤아웃으로 파드가 내려갈 때 presence를
  // 걷어내지 않으면 다른 기기의 목록에 최대 PRESENCE_TTL_MS 동안 "붙어 있음"이 남는다.
  // (api·auth에서는 Redis 연결을 얌전히 닫는 정도의 차이다)
  app.enableShutdownHooks();
  options.onHttpServer?.(app.getHttpServer() as Server, app);
  await app.listen(portOf(config));
}
