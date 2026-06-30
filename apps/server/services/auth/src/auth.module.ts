import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

// JWT 시크릿은 환경변수에서. 개발용 fallback은 운영에서 절대 사용 금지.
// (refresh 토큰은 v1 미지원 — JWT_REFRESH_SECRET_KEY는 도입 시 사용)
const JWT_SECRET = process.env.JWT_SECRET_KEY ?? 'dev-insecure-secret-change-me';

@Module({
  imports: [
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: { algorithm: 'HS256', expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
