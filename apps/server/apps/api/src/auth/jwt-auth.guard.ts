import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { JwtPayload } from '@app/common';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpException({ error: 'UNAUTHORIZED' }, 401);
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      req.user = this.auth.userFromPayload(payload);
      return true;
    } catch {
      throw new HttpException({ error: 'UNAUTHORIZED' }, 401);
    }
  }
}
