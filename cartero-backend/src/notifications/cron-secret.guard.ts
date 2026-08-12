import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-cron-secret'];
    const expected = this.configService.get<string>('CRON_SECRET');

    if (!expected || provided !== expected) {
      throw new UnauthorizedException('Segredo de cron inválido');
    }

    return true;
  }
}
