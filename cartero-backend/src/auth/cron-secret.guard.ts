import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Autentica os executores de cron por segredo compartilhado.
 *
 * Vive em `auth/` ao lado de `JwtAuthGuard` porque é a mesma natureza de
 * coisa: um guard de autenticação. Estava em `notifications/` e era importado
 * por `subscriptions/` — uma dependência invertida, com o módulo de
 * assinaturas atravessando o de notificações para pegar algo que não pertence
 * a nenhum dos dois.
 *
 * Protege dois endpoints, ambos chamados por cron externo e ambos lendo o
 * MESMO `CRON_SECRET`:
 *
 *   POST /subscriptions/run-all   — geração mensal de assinaturas
 *   POST /notifications/run       — alerta de vencimentos
 *
 * O contrato é header `x-cron-secret` com o valor CRU. Não é
 * `Authorization: Bearer` — a comparação é estrita, e um prefixo faria a
 * verificação falhar.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-cron-secret'];
    const expected = this.configService.get<string>('CRON_SECRET');

    // `!expected` mantém o fail-closed: sem segredo configurado, nada passa.
    // Desde que o env schema exige valor não vazio, chegar aqui sem ele
    // significa configuração ausente — e recusar é o comportamento correto.
    if (!expected || provided !== expected) {
      throw new UnauthorizedException('Segredo de cron inválido');
    }

    return true;
  }
}
