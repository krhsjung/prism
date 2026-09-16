import { Module } from '@nestjs/common';
import { PrismConfigModule } from '@app/config';
import { PushSender } from './push.sender';

// auth(푸시 화면)와 socket(통화 깨우기)이 **같은 전송기**를 쓴다.
@Module({
  imports: [PrismConfigModule],
  providers: [PushSender],
  exports: [PushSender],
})
export class PushModule {}
