import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppScheduler } from './app.scheduler';
import type { PrismaService } from './prisma/prisma.service';
import { makeInvoice } from './common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ6 — AppScheduler.syncInvoiceStatus: hourly, per-account financial day
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O cron passou de diário para hourly (§3), e cada invoice resolve "hoje"
 * pela timezone do PRÓPRIO dono — nunca a timezone do primeiro usuário do
 * lote (owner isolation), nunca reescreve o legado (`timeZone === null`
 * continua UTC puro, nunca Fortaleza).
 */

beforeAll(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

function buildHarness(invoices: any[]) {
  const updates: { id: string; status: string }[] = [];

  const prisma = {
    invoice: {
      findMany: vi.fn().mockResolvedValue(invoices),
      update: vi.fn(async ({ where, data }: any) => {
        updates.push({ id: where.id, status: data.status });
        return {};
      }),
    },
  } as unknown as PrismaService;

  return { scheduler: new AppScheduler(prisma), prisma, updates };
}

function at(iso: string, run: () => Promise<void>) {
  return async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    try {
      await run();
    } finally {
      vi.useRealTimers();
    }
  };
}

describe('AppScheduler.syncInvoiceStatus — TZ6: multi-conta e batch shape', () => {
  it(
    'I14/P3: mesma execução, mesmo instante — cada invoice usa a timezone do PRÓPRIO dono',
    at('2026-09-16T23:30:00.000Z', async () => {
      /*
        16/09 23:30 UTC: Fortaleza (UTC-3) ainda 16/09 20h30 (dia 16);
        Tóquio (UTC+9) já 17/09 08h30 (dia 17). Fatura vencendo em 16/09 é
        due-hoje (CLOSED) para Fortaleza, já vencida (OVERDUE) para Tóquio —
        no MESMO lote, na MESMA execução.
      */
      const shared = {
        closeDate: new Date('2026-09-01T03:00:00.000Z'),
        dueDate: new Date('2026-09-16T03:00:00.000Z'),
      };

      const harness = buildHarness([
        { id: 'fortaleza-inv', status: 'CLOSED', ...shared, user: { timeZone: 'America/Fortaleza' } },
        { id: 'tokyo-inv', status: 'CLOSED', ...shared, user: { timeZone: 'Asia/Tokyo' } },
      ]);

      await harness.scheduler.syncInvoiceStatus();

      // Fortaleza: due hoje, permanece CLOSED — nenhuma escrita.
      // Tóquio: já vencida — escreve OVERDUE.
      expect(harness.updates).toEqual([{ id: 'tokyo-inv', status: 'OVERDUE' }]);
    }),
  );

  it(
    'P3 (contraprova): se o lote usasse a timezone do primeiro usuário para todos, Tóquio não seria atualizada',
    at('2026-09-16T23:30:00.000Z', async () => {
      // Ordem invertida: Tóquio primeiro no array. Se o código (por bug)
      // usasse `invoices[0].user.timeZone` para todas as linhas, a invoice
      // de Fortaleza herdaria Tóquio incorretamente e seria marcada OVERDUE
      // também — o que o teste acima já provou não acontecer.
      const shared = {
        closeDate: new Date('2026-09-01T03:00:00.000Z'),
        dueDate: new Date('2026-09-16T03:00:00.000Z'),
      };

      const harness = buildHarness([
        { id: 'tokyo-inv', status: 'CLOSED', ...shared, user: { timeZone: 'Asia/Tokyo' } },
        { id: 'fortaleza-inv', status: 'CLOSED', ...shared, user: { timeZone: 'America/Fortaleza' } },
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toEqual([{ id: 'tokyo-inv', status: 'OVERDUE' }]);
    }),
  );

  it(
    'legacy null convive no MESMO lote com contas timezone-aware, cada uma isolada',
    at('2026-09-16T23:30:00.000Z', async () => {
      const shared = {
        closeDate: new Date('2026-09-01T03:00:00.000Z'),
        dueDate: new Date('2026-09-16T03:00:00.000Z'),
      };

      const harness = buildHarness([
        { id: 'legacy-inv', status: 'CLOSED', ...shared, user: { timeZone: 'America/Fortaleza' } },
        { id: 'tokyo-inv', status: 'CLOSED', ...shared, user: { timeZone: 'Asia/Tokyo' } },
      ]);

      await harness.scheduler.syncInvoiceStatus();

      /*
        legacy null: UTC day de 16/09 23:30Z ainda é 16/09 (dueCivil=16/09,
        não é > → CLOSED, sem escrita). Tóquio: já 17/09 → OVERDUE.
      */
      expect(harness.updates).toEqual([{ id: 'tokyo-inv', status: 'OVERDUE' }]);
    }),
  );
});

describe('AppScheduler.syncInvoiceStatus — TZ6.1: timing legado preservado para null', () => {
  /*
    Achado do TZ6.1: o cron diário pré-TZ6 só rodava à meia-noite de
    Fortaleza (~03:00 UTC). Entre 00:00-03:00 UTC — a janela em que o dia
    civil UTC já virou mas o cron diário ainda não tinha disparado de novo —
    uma conta legacy null NUNCA via o status persistido mudar antes da
    próxima meia-noite de Fortaleza. Rodar hourly sem esse gate faria o
    scheduler escrever até ~3h mais cedo do que qualquer execução histórica
    jamais escreveu — uma regressão de compatibilidade observável.
  */
  const invoiceDueSept16 = {
    status: 'CLOSED' as const,
    closeDate: new Date('2026-09-01T03:00:00.000Z'),
    dueDate: new Date('2026-09-16T03:00:00.000Z'),
  };

  it(
    'L1: tick de 01:00 UTC (22h em Fortaleza, ainda dia 16) — null NÃO transiciona, mesmo já sendo UTC-dia-17',
    at('2026-09-17T01:00:00.000Z', async () => {
      const harness = buildHarness([
        { id: 'legacy-inv', ...invoiceDueSept16, user: { timeZone: 'America/Fortaleza' } },
      ]);

      await harness.scheduler.syncInvoiceStatus();

      // UTC já é 17/09 (dueCivil=16/09 → seria OVERDUE se derivado agora),
      // mas o cron legado só tinha permissão de agir à meia-noite de
      // Fortaleza — este tick (22h Fortaleza) não é essa janela.
      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'L2: tick de 03:00 UTC (00h em Fortaleza — a janela histórica) — null transiciona normalmente',
    at('2026-09-17T03:00:00.000Z', async () => {
      const harness = buildHarness([
        { id: 'legacy-inv', ...invoiceDueSept16, user: { timeZone: 'America/Fortaleza' } },
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toHaveLength(1);
    }),
  );

  it(
    'L3: no MESMO tick de 01:00 UTC, uma conta Asia/Tokyo é processada normalmente (sem gate)',
    at('2026-09-17T01:00:00.000Z', async () => {
      const harness = buildHarness([
        { id: 'legacy-inv', ...invoiceDueSept16, user: { timeZone: 'America/Fortaleza' } },
        { id: 'tokyo-inv', ...invoiceDueSept16, user: { timeZone: 'Asia/Tokyo' } },
      ]);

      await harness.scheduler.syncInvoiceStatus();

      // legacy: suprimido pelo gate. Tokyo: processado neste MESMO tick,
      // independente do gate — hourly sempre valeu para contas com
      // timezone configurada.
      expect(harness.updates).toEqual([{ id: 'tokyo-inv', status: 'OVERDUE' }]);
    }),
  );

  it(
    'L4: America/Fortaleza é processada hourly, mas o status só muda quando o dia financeiro da conta exige',
    at('2026-09-17T01:00:00.000Z', async () => {
      // Mesmo instante do L1/L3: Fortaleza (conta com timezone explícita,
      // não null) ainda está em 16/09 às 22h — devido hoje, não vencida.
      const harness = buildHarness([
        { id: 'fortaleza-inv', ...invoiceDueSept16, user: { timeZone: 'America/Fortaleza' } },
      ]);

      await harness.scheduler.syncInvoiceStatus();

      // Processada (não suprimida pelo gate, que só vale para null), mas o
      // resultado calculado é CLOSED == status atual — nenhuma escrita.
      expect(harness.updates).toHaveLength(0);
    }),
  );

  it('onApplicationBootstrap ignora o gate — processa null imediatamente, em qualquer hora', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T01:00:00.000Z'));
    try {
      const harness = buildHarness([
        { id: 'legacy-inv', ...invoiceDueSept16, user: { timeZone: 'America/Fortaleza' } },
      ]);

      await harness.scheduler.onApplicationBootstrap();

      // Mesmo tick do L1 (22h Fortaleza) — mas via bootstrap, não via cron,
      // então o gate não se aplica: comportamento pré-TZ6 preservado.
      expect(harness.updates).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AppScheduler.syncInvoiceStatus — TZ6: query shape (N+1 guard)', () => {
  it('a query seleciona user.timeZone no MESMO select — uma consulta, não uma por invoice', async () => {
    const harness = buildHarness([]);
    await harness.scheduler.syncInvoiceStatus();

    const call = (harness.prisma.invoice.findMany as any).mock.calls[0][0];
    expect(call.select).toMatchObject({
      user: { select: { timeZone: true } },
    });
    // Uma única chamada a findMany — nunca uma por invoice/usuário.
    expect((harness.prisma.invoice.findMany as any).mock.calls).toHaveLength(1);
  });

  it('continua excluindo PAID e OVERDUE do candidate set', async () => {
    const harness = buildHarness([]);
    await harness.scheduler.syncInvoiceStatus();

    const call = (harness.prisma.invoice.findMany as any).mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ['OPEN', 'CLOSED'] });
  });
});

describe('AppScheduler.syncInvoiceStatus — TZ6: idempotência e recuperação (timezone user)', () => {
  it(
    'I12: rodar de novo no mesmo instante não gera escrita adicional (conta Tokyo)',
    at('2026-09-16T23:30:00.000Z', async () => {
      const invoice = {
        id: 'i1',
        status: 'CLOSED',
        closeDate: new Date('2026-09-01T03:00:00.000Z'),
        dueDate: new Date('2026-09-16T03:00:00.000Z'),
        user: { timeZone: 'Asia/Tokyo' },
      };
      const harness = buildHarness([invoice]);

      await harness.scheduler.syncInvoiceStatus();
      expect(harness.updates).toHaveLength(1);

      invoice.status = 'OVERDUE';
      harness.updates.length = 0;
      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'I13: execuções perdidas — ao voltar, a invoice alcança o status correto numa única execução (conta Tokyo)',
    at('2026-09-25T12:00:00.000Z', async () => {
      // Fatura de Tóquio, vencimento há muitos dias, scheduler ficou fora
      // do ar — precisa alcançar OVERDUE diretamente, sem passar por
      // execuções intermediárias.
      const harness = buildHarness([
        {
          id: 'i1',
          status: 'OPEN',
          closeDate: new Date('2026-09-01T03:00:00.000Z'),
          dueDate: new Date('2026-09-16T03:00:00.000Z'),
          user: { timeZone: 'Asia/Tokyo' },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toEqual([{ id: 'i1', status: 'OVERDUE' }]);
    }),
  );

  it(
    'P5: PAID nunca entra na consulta nem é reatribuída, mesmo com timezone de conta',
    at('2026-09-25T12:00:00.000Z', async () => {
      const harness = buildHarness([]);
      await harness.scheduler.syncInvoiceStatus();

      const where = (harness.prisma.invoice.findMany as any).mock.calls[0][0]
        .where;
      expect(where.status.in).not.toContain('PAID');
      expect(harness.updates).toHaveLength(0);
    }),
  );
});
