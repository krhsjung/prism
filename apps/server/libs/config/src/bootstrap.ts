import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismConfigService } from './config.service';

// 서비스 공통 HTTP 부팅 — CORS·포트 정책을 PrismConfigService(PRISM_* env)로 일원화한다.
// 전제: appModule이 PrismConfigModule을 import하고 있어야 한다.
export async function bootstrapHttpApp(
  appModule: Type<object>,
  portOf: (config: PrismConfigService) => number,
): Promise<void> {
  const app = await NestFactory.create(appModule);
  const config = app.get(PrismConfigService);
  // 클라이언트(dev) 교차 출처 허용. 운영에서는 PRISM_CORS_ORIGIN으로 제한.
  app.enableCors({ origin: config.corsOrigins ?? true, credentials: true });
  await app.listen(portOf(config));
}
