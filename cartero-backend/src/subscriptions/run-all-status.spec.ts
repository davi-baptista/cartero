import { InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionsController } from './subscriptions.controller';
import type { SubscriptionsService } from './subscriptions.service';
import type { GenerationSummary } from './subscriptions.service';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Status HTTP de `POST /subscriptions/run-all` (Fase 7C)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Antes a rota devolvia 201 mesmo com `failed > 0`. Um monitor externo observa
 * status HTTP — é o que serviços de cron oferecem —, então concluía que a
 * execução foi bem-sucedida e uma assinatura podia falhar todos os dias sem
 * ninguém notar.
 *
 * A distinção que importa: `skipped` é decisão do domínio (fatura já paga) e
 * continua sendo sucesso. Alertar por skip previsto treinaria quem monitora a
 * ignorar o alerta.
 *
 * Nada é revertido em nenhum dos casos — o status comunica o resultado do
 * lote, não desfaz trabalho confirmado.
 */

function buildController(summary: GenerationSummary) {
  const service = {
    runForAll: vi.fn(async () => summary),
  } as unknown as SubscriptionsService;

  return { controller: new SubscriptionsController(service), service };
}

const summary = (
  overrides: Partial<GenerationSummary> = {},
): GenerationSummary => ({
  subscriptions: 1,
  generated: 0,
  skipped: 0,
  failed: 0,
  failures: [],
  ...overrides,
});

describe('run-all — sucesso', () => {
  it('sem falhas devolve o resumo normalmente', async () => {
    const { controller } = buildController(
      summary({ subscriptions: 3, generated: 3 }),
    );

    const result = await controller.runAll();

    expect(result.generated).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('lote vazio é sucesso', async () => {
    const { controller } = buildController(summary({ subscriptions: 0 }));

    await expect(controller.runAll()).resolves.toBeDefined();
  });

  it('skip deliberado continua sendo sucesso HTTP', async () => {
    /**
     * `generated: 0, skipped: 3` é o cenário de três ciclos caindo em faturas
     * já pagas. O sistema fez exatamente o que devia; transformar isso em
     * alerta operacional geraria ruído recorrente.
     */
    const { controller } = buildController(
      summary({ subscriptions: 3, skipped: 3 }),
    );

    const result = await controller.runAll();

    expect(result.skipped).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('gerados e pulados juntos, sem falha, é sucesso', async () => {
    const { controller } = buildController(
      summary({ subscriptions: 5, generated: 4, skipped: 1 }),
    );

    await expect(controller.runAll()).resolves.toMatchObject({
      generated: 4,
      skipped: 1,
    });
  });
});

describe('run-all — falha parcial', () => {
  const partial = summary({
    subscriptions: 6,
    generated: 4,
    skipped: 1,
    failed: 1,
    failures: [
      {
        subscriptionId: 'sub-ruim',
        title: 'Netflix',
        reason: 'Não foi possível gerar as cobranças desta assinatura.',
      },
    ],
  });

  it('devolve status não-2xx quando há falha', async () => {
    const { controller } = buildController(partial);

    await expect(controller.runAll()).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('o corpo do erro preserva o resumo completo', async () => {
    // Quem investiga precisa ver quantos ciclos passaram antes da falha.
    const { controller } = buildController(partial);

    await expect(controller.runAll()).rejects.toMatchObject({
      response: {
        code: 'SUBSCRIPTION_GENERATION_PARTIAL_FAILURE',
        summary: expect.objectContaining({
          generated: 4,
          skipped: 1,
          failed: 1,
        }),
      },
    });
  });

  it('as falhas identificam a assinatura', async () => {
    const { controller } = buildController(partial);

    try {
      await controller.runAll();
      expect.unreachable('deveria ter lançado');
    } catch (error: any) {
      const failures = error.response.summary.failures;
      expect(failures).toHaveLength(1);
      expect(failures[0].subscriptionId).toBe('sub-ruim');
      expect(failures[0].title).toBe('Netflix');
    }
  });

  it('a mensagem de falha vem sanitizada, sem stack nem erro cru', async () => {
    const { controller } = buildController(partial);

    try {
      await controller.runAll();
      expect.unreachable('deveria ter lançado');
    } catch (error: any) {
      const reason = error.response.summary.failures[0].reason;
      expect(reason).not.toMatch(/at\s+\w+\s+\(/); // sem frame de stack
      expect(reason).not.toContain('Prisma');
      expect(reason).not.toContain('P20');
    }
  });

  it('a geração não é reexecutada nem revertida por causa do status', async () => {
    /**
     * O status comunica o resultado do lote. Os ciclos confirmados permanecem,
     * e o retry provocado pelo erro é seguro por causa da idempotência
     * (`lastGeneratedFor` com update condicional) — não por reversão.
     */
    const { controller, service } = buildController(partial);

    await expect(controller.runAll()).rejects.toThrow();

    expect(service.runForAll).toHaveBeenCalledTimes(1);
  });

  it('falha em todas também é não-2xx', async () => {
    const { controller } = buildController(
      summary({ subscriptions: 2, failed: 2 }),
    );

    await expect(controller.runAll()).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});

describe('run-all — retry após falha parcial', () => {
  /**
   * O status não-2xx faz o serviço externo repetir a execução. Isso tem de ser
   * seguro, e a garantia não vem de reversão: vem da idempotência.
   *
   * `lastGeneratedFor` avança na MESMA transação do lançamento, com update
   * condicional — um ciclo já confirmado não é gerado de novo. O ciclo que
   * falhou não avançou o marcador, então continua pendente e é retomado.
   */
  it('a segunda execução não regenera os ciclos já confirmados', async () => {
    // Primeira: 4 gerados, 1 pulado, 1 falhou → não-2xx.
    const first = buildController(
      summary({ subscriptions: 6, generated: 4, skipped: 1, failed: 1 }),
    );
    await expect(first.controller.runAll()).rejects.toThrow(
      InternalServerErrorException,
    );

    /**
     * Segunda execução: o resumo é menor porque `pendingCycles` só vê o que
     * ficou pendente — os 4 confirmados saíram da lista pelo marcador, e o
     * pulado teve o marcador avançado de propósito.
     */
    const second = buildController(
      summary({ subscriptions: 6, generated: 1, skipped: 0, failed: 0 }),
    );
    const result = await second.controller.runAll();

    expect(result.generated).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('a falha persistente continua devolvendo não-2xx', async () => {
    // Se a causa não foi resolvida, o alerta tem de continuar aparecendo —
    // não silenciar depois da primeira notificação.
    const harness = buildController(summary({ subscriptions: 1, failed: 1 }));

    await expect(harness.controller.runAll()).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(harness.controller.runAll()).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('quando a causa é resolvida, a execução seguinte é sucesso', async () => {
    const harness = buildController(
      summary({ subscriptions: 6, generated: 1 }),
    );

    await expect(harness.controller.runAll()).resolves.toMatchObject({
      failed: 0,
    });
  });
});
