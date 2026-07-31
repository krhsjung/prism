import { Module } from '@nestjs/common';
import { PrismConfigModule } from '@app/config';
import { AppController } from './app.controller';

// auth는 별도 앱(services/auth)으로 분리되어 독립 실행된다.
// 실제 도메인 기능이 들어오기 전까지 health 응답만 제공한다.
@Module({
  imports: [PrismConfigModule],
  controllers: [AppController],
})
export class AppModule {}
