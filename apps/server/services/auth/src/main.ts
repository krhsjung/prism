import { NestFactory } from '@nestjs/core';
import { AuthModule } from './auth.module';

async function bootstrap() {
  const app = await NestFactory.create(AuthModule);
  // 클라이언트(dev) 교차 출처 허용. 운영에서는 CORS_ORIGIN으로 제한.
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });
  // auth는 3000, api는 3001로 독립 실행. 웹의 기본 호출 대상(:3000)이 auth다.
  await app.listen(process.env.AUTH_PORT ?? 3000);
}
void bootstrap();
