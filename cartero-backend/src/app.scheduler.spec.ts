import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppScheduler } from './app.scheduler';
import type { PrismaService } from './prisma/prisma.service';
import { makeBank, makeInvoice } from './common/testing/fixtures';

// O scheduler loga a cada execução; nos testes isso só polui a saída.
beforeAll(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

/**
 * O cron diário é o único mecanismo que avança o status das faturas pelo tempo.
 * PAID nunca é atribuído aqui — é sempre ação do usuário.
 *
 * `syncInvoiceStatus` usa `new Date()` internamente, então os testes controlam
 * o tempo com `vi.useFakeTimers`, nunca dependendo do relógio real.
 */

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

/** Fatura de agosto/2026: fecha 03/08 às 3h, vence 10/08 às 3h. */
function augustInvoice(overrides: Parameters<typeof makeInvoice>[0] = {}) {
  return {
    ...makeInvoice({ month: 8, year: 2026, ...overrides }),
    bank: makeBank({ invoiceDueDate: 10, invoiceDueDaysAfterClose: 7 }),
  };
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

describe('AppScheduler.syncInvoiceStatus', () => {
  it(
    'mantém OPEN antes da data de fechamento',
    at('2026-08-01T12:00:00.000Z', async () => {
      const harness = buildHarness([
        augustInvoice({ id: 'i1', status: 'OPEN' }),
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'move OPEN para CLOSED a partir do fechamento',
    at('2026-08-04T12:00:00.000Z', async () => {
      const harness = buildHarness([
        augustInvoice({ id: 'i1', status: 'OPEN' }),
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toEqual([{ id: 'i1', status: 'CLOSED' }]);
    }),
  );

  it(
    'move CLOSED para OVERDUE depois do vencimento',
    at('2026-08-11T12:00:00.000Z', async () => {
      const harness = buildHarness([
        augustInvoice({ id: 'i1', status: 'CLOSED' }),
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toEqual([{ id: 'i1', status: 'OVERDUE' }]);
    }),
  );

  it(
    'mantém CLOSED no dia do vencimento — vencer hoje não é estar vencida',
    at('2026-08-10T02:00:00.000Z', async () => {
      const harness = buildHarness([
        augustInvoice({ id: 'i1', status: 'CLOSED' }),
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'uma execução atrasada leva a fatura OPEN direto a OVERDUE',
    at('2026-08-20T12:00:00.000Z', async () => {
      // O caso que motivou a correção: scheduler indisponível por dias.
      // Antes a fatura parava em CLOSED e só ficaria OVERDUE no dia seguinte.
      const harness = buildHarness([
        augustInvoice({ id: 'i1', status: 'OPEN' }),
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toEqual([{ id: 'i1', status: 'OVERDUE' }]);
    }),
  );

  it(
    'não reescreve uma fatura que já está no status correto',
    at('2026-08-20T12:00:00.000Z', async () => {
      const harness = buildHarness([
        augustInvoice({ id: 'i1', status: 'CLOSED' }),
      ]);

      await harness.scheduler.syncInvoiceStatus();

      // CLOSED → OVERDUE é uma escrita legítima; o que não pode haver é
      // escrita quando o status já corresponde ao calendário.
      expect(harness.updates).toEqual([{ id: 'i1', status: 'OVERDUE' }]);
    }),
  );

  it(
    'é idempotente: a segunda execução no mesmo dia não escreve nada',
    at('2026-08-20T12:00:00.000Z', async () => {
      const invoice = augustInvoice({ id: 'i1', status: 'OPEN' });
      const harness = buildHarness([invoice]);

      await harness.scheduler.syncInvoiceStatus();
      expect(harness.updates).toHaveLength(1);

      // Simula o registro já persistido com o novo status.
      invoice.status = 'OVERDUE';
      harness.updates.length = 0;
      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'uma fatura PAID não é tocada mesmo depois do vencimento',
    at('2026-09-30T12:00:00.000Z', async () => {
      // PAID nem sequer entra na consulta, mas o teste fixa a garantia:
      // pagamento é estado manual e final para o cron.
      const harness = buildHarness([]);

      await harness.scheduler.syncInvoiceStatus();

      const where = (harness.prisma.invoice.findMany as any).mock.calls[0][0]
        .where;
      expect(where.status.in).not.toContain('PAID');
      expect(harness.updates).toHaveLength(0);
    }),
  );

  it('consulta apenas faturas OPEN e CLOSED — PAID e OVERDUE ficam de fora', async () => {
    const harness = buildHarness([]);

    await harness.scheduler.syncInvoiceStatus();

    const where = (harness.prisma.invoice.findMany as any).mock.calls[0][0]
      .where;
    expect(where.status).toEqual({ in: ['OPEN', 'CLOSED'] });
  });

  it(
    'nunca atribui PAID',
    at('2026-09-01T12:00:00.000Z', async () => {
      const harness = buildHarness([
        augustInvoice({ id: 'i1', status: 'OPEN' }),
        augustInvoice({ id: 'i2', status: 'CLOSED' }),
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates.map((u) => u.status)).not.toContain('PAID');
    }),
  );

  it(
    'respeita o calendário de cada banco',
    at('2026-08-04T12:00:00.000Z', async () => {
      // Cartão que vence dia 28 (fecha 21/08) ainda está aberto em 04/08,
      // enquanto o que vence dia 10 (fecha 03/08) já fechou.
      //
      // O calendário agora vem da PRÓPRIA fatura, não do banco anexado: é
      // essa mudança que impede uma reconfiguração do cartão de alterar o
      // estado de faturas históricas durante o cron.
      const harness = buildHarness([
        augustInvoice({ id: 'fecha-cedo', status: 'OPEN' }),
        makeInvoice({
          id: 'fecha-tarde',
          month: 8,
          year: 2026,
          status: 'OPEN',
          schedule: { invoiceDueDate: 28, invoiceDueDaysAfterClose: 7 },
        }),
      ]);

      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toEqual([{ id: 'fecha-cedo', status: 'CLOSED' }]);
    }),
  );

  it(
    'trata a virada de ano: fatura de janeiro que fecha em dezembro',
    at('2026-01-02T12:00:00.000Z', async () => {
      const harness = buildHarness([
        makeInvoice({
          id: 'jan',
          month: 1,
          year: 2026,
          status: 'OPEN',
          schedule: { invoiceDueDate: 5, invoiceDueDaysAfterClose: 7 },
        }),
      ]);

      await harness.scheduler.syncInvoiceStatus();

      // Fecha 29/12/2025 — em 02/01/2026 já passou.
      expect(harness.updates).toEqual([{ id: 'jan', status: 'CLOSED' }]);
    }),
  );
});
