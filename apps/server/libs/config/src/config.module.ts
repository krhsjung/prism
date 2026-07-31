import { Global, Module } from '@nestjs/common';
import { PrismConfigService } from './config.service';

// 전역 설정 모듈. 앱 루트에서 한 번 import하면 어디서나 PrismConfigService 주입 가능.
// env는 process.env에서 직접 읽는다(.env 파일 미사용 — k8s/셸 주입 방식이라 매핑 계층 불필요).
@Global()
@Module({
  providers: [PrismConfigService],
  exports: [PrismConfigService],
})
export class PrismConfigModule {}
