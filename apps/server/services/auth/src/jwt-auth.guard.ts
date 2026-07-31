import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_ERROR_CODES, type User } from '@app/common';
import { AuthTokenService } from './session/auth-token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: AuthTokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: User }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token)
      throw new HttpException({ error: AUTH_ERROR_CODES.UNAUTHORIZED }, 401);
    try {
      req.user = this.tokens.verifySession(token);
      return true;
    } catch {
      throw new HttpException({ error: AUTH_ERROR_CODES.UNAUTHORIZED }, 401);
    }
  }
}
