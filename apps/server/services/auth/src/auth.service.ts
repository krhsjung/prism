import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload, User } from '@app/common';

// 시드된 데모 계정(provider='demo', provider_id='demo-001')에 대응하는 세션 정체성.
// 표시 이름은 저장하지 않고 서버가 상수로 부여한다. (plan/auth.md)
const DEMO_USER: User = {
  id: '00000000-0000-7000-8000-0000000000de',
  provider: 'demo',
  displayName: 'Demo User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  // AUTH_DEMO_ENABLED=false 이면 데모 로그인 비활성화.
  get demoEnabled(): boolean {
    return process.env.AUTH_DEMO_ENABLED !== 'false';
  }

  issueDemoSession(): { accessToken: string; user: User } {
    return { accessToken: this.sign(DEMO_USER), user: DEMO_USER };
  }

  userFromPayload(payload: JwtPayload): User {
    return {
      id: payload.sub,
      provider: payload.provider,
      displayName: payload.name,
      createdAt: payload.createdAt,
    };
  }

  private sign(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      provider: user.provider,
      name: user.displayName,
      createdAt: user.createdAt,
    };
    return this.jwt.sign(payload);
  }
}
