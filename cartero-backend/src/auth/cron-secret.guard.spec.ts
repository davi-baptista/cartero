import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CronSecretGuard } from './cron-secret.guard';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Guard de cron (Fase 7C)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Compartilhado por `POST /subscriptions/run-all` e `POST /notifications/run`,
 * ambos lendo o MESMO `CRON_SECRET`. Vive em `auth/` porque é um guard de
 * autenticação — estava em `notifications/` e era importado por
 * `subscriptions/`, uma dependência invertida.
 *
 * O contrato é header `x-cron-secret` com o valor CRU: não `Bearer`, sem
 * prefixo. A comparação é estrita.
 */

function buildContext(headers: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function buildGuard(expected: string | undefined) {
  const config = {
    get: () => expected,
  } as unknown as ConfigService;

  return new CronSecretGuard(config);
}

describe('CronSecretGuard', () => {
  it('permite quando o header traz o segredo correto', () => {
    const guard = buildGuard('segredo');

    expect(
      guard.canActivate(buildContext({ 'x-cron-secret': 'segredo' })),
    ).toBe(true);
  });

  it('recusa quando o header está ausente', () => {
    const guard = buildGuard('segredo');

    expect(() => guard.canActivate(buildContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('recusa quando o header traz valor errado', () => {
    const guard = buildGuard('segredo');

    expect(() =>
      guard.canActivate(buildContext({ 'x-cron-secret': 'outro' })),
    ).toThrow(UnauthorizedException);
  });

  it('recusa o formato Bearer — o contrato é o valor cru', () => {
    // Confundir os dois é o erro de configuração mais provável no painel do
    // cron, e o resultado seria 401 em toda chamada.
    const guard = buildGuard('segredo');

    expect(() =>
      guard.canActivate(buildContext({ 'x-cron-secret': 'Bearer segredo' })),
    ).toThrow(UnauthorizedException);
  });

  it('fail-closed: sem segredo configurado, nada passa', () => {
    const guard = buildGuard(undefined);

    expect(() =>
      guard.canActivate(buildContext({ 'x-cron-secret': 'qualquer' })),
    ).toThrow(UnauthorizedException);
  });

  it('header duplicado (array) é recusado', () => {
    // Express transforma header repetido em array, e a comparação estrita
    // falha — o que é o comportamento seguro.
    const guard = buildGuard('segredo');

    expect(() =>
      guard.canActivate(
        buildContext({ 'x-cron-secret': ['segredo', 'segredo'] }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('a mensagem de erro não revela o segredo esperado', () => {
    const guard = buildGuard('segredo-secreto');

    try {
      guard.canActivate(buildContext({ 'x-cron-secret': 'errado' }));
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(String(error)).not.toContain('segredo-secreto');
    }
  });
});
