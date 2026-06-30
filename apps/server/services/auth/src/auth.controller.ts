import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { User } from '@app/common';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // 원클릭 데모 로그인 — 외부 OAuth 없이 시드된 데모 계정으로 세션 발급.
  @Post('demo')
  demo(): { accessToken: string; user: User } {
    if (!this.auth.demoEnabled) {
      throw new HttpException({ error: 'DEMO_DISABLED' }, 503);
    }
    return this.auth.issueDemoSession();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request & { user: User }): User {
    return req.user;
  }

  // Stateless — 클라이언트가 토큰을 폐기한다.
  @Post('logout')
  @HttpCode(204)
  logout(): void {}
}
