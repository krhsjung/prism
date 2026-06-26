import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

// JWT 시크릿은 환경변수에서. 개발용 fallback은 운영에서 절대 사용 금지.
const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? 'dev-insecure-secret-change-me';

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
