import { Controller, Get } from '@nestjs/common';
import { Public } from '@app/session';

@Controller()
export class AppController {
  // 실제 도메인이 들어오기 전까지의 유일한 엔드포인트 — 동작 확인용.
  //
  // k8s 프로브가 부르는 경로라 인증 대상이 아니다. 전역 가드(app.module.ts) 때문에
  // **명시적으로 열어야** 하고, 그래서 "여기가 공개다"라는 사실이 코드에 남는다.
  @Public()
  @Get('healthz')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
