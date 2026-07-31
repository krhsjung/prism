import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  // 실제 도메인이 들어오기 전까지의 유일한 엔드포인트 — 동작 확인용.
  @Get('healthz')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
