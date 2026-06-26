import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 웹 클라이언트(dev) 교차 출처 허용. 운영에서는 CORS_ORIGIN으로 제한.
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
