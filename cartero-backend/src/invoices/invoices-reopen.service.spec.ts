import { describe, expect, it, vi } from 'vitest';
import { InvoicesService } from './invoices.service';
import { makeInvoice, USER_ID } from 'src/common/testing/fixtures';

/**
 * TZ6.1 §7/§11 — `reopen`/`reopenAllPaid` precisam derivar o status pela
 * MESMA authority que o scheduler usa para a conta (`User.timeZone`), nunca
 * UTC fixo para contas com timezone configurada. Sem esta cobertura, o
 * parâmetro `timeZone` de ambos os métodos poderia ser ignorado
 * silenciosamente sem que nenhum teste falhasse (P3 do TZ6.1).
 */

function buildPrismaDouble(invoice: unknown, paidInvoices: unknown[] = []) {
  const updateCalls: unknown[] = [];

  const prisma = {
    invoice: {
      findUnique: vi.fn(async () => invoice),
      findMany: vi.fn(async () => paidInvoices),
      update: vi.fn(async (args: unknown) => {
        updateCalls.push(args);
        return args;
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { prisma, updateCalls };
}

// closeDate/dueDate no dia 17/09. No instante de teste (16/09 23:30 UTC):
// Fortaleza (UTC-3) ainda está em 16/09 20h30 — closeDate não chegou (OPEN).
// Tokyo (UTC+9) já está em 17/09 08h30 — closeDate já passou (CLOSED).
const now = new Date('2026-09-16T23:30:00.000Z');
const closesToday = {
  closeDate: new Date('2026-09-17T03:00:00.000Z'),
  dueDate: new Date('2026-09-20T03:00:00.000Z'),
};

describe('InvoicesService.reopen — timezone da conta (TZ6.1 §11)', () => {
  it('conta America/Fortaleza: closeDate ainda não chegou — reabre como OPEN', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const invoice = makeInvoice({
        id: 'inv-1',
        status: 'PAID',
        ...closesToday,
      });
      const { prisma, updateCalls } = buildPrismaDouble(invoice);
      const service = new InvoicesService(prisma as any, {} as any);

      await service.reopen('inv-1', USER_ID, 'America/Fortaleza');

      expect((updateCalls[0] as any).data.status).toBe('OPEN');
    } finally {
      vi.useRealTimers();
    }
  });

  it('conta Asia/Tokyo: closeDate já passou — reabre como CLOSED (mesma conclusão do scheduler)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const invoice = makeInvoice({
        id: 'inv-1',
        status: 'PAID',
        ...closesToday,
      });
      const { prisma, updateCalls } = buildPrismaDouble(invoice);
      const service = new InvoicesService(prisma as any, {} as any);

      await service.reopen('inv-1', USER_ID, 'Asia/Tokyo');

      expect((updateCalls[0] as any).data.status).toBe('CLOSED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('P3 (mutação real, não fabricada): omitir timeZone preserva a derivação UTC legada, não Fortaleza/Tokyo', async () => {
    vi.useFakeTimers();
    // UTC-dia do `now` ainda é 16/09 — closeDate (17/09) ainda não chegou.
    vi.setSystemTime(now);
    try {
      const invoice = makeInvoice({
        id: 'inv-1',
        status: 'PAID',
        ...closesToday,
      });
      const { prisma, updateCalls } = buildPrismaDouble(invoice);
      const service = new InvoicesService(prisma as any, {} as any);

      // Sem terceiro argumento — chamador legado (nenhum User.timeZone).
      await service.reopen('inv-1', USER_ID);

      expect((updateCalls[0] as any).data.status).toBe('OPEN');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('InvoicesService.reopenAllPaid — timezone da conta (TZ6.1 §11)', () => {
  it('conta Asia/Tokyo: recalcula todas as faturas pagas pela timezone da conta', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const paid = [
        makeInvoice({ id: 'inv-1', status: 'PAID', ...closesToday }),
      ];
      const { prisma, updateCalls } = buildPrismaDouble(null, paid);
      const service = new InvoicesService(prisma as any, {} as any);

      await service.reopenAllPaid(USER_ID, 'Asia/Tokyo');

      expect((updateCalls[0] as any).data.status).toBe('CLOSED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('conta America/Fortaleza: mesma fatura, mesmo instante, resultado diferente de Tokyo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const paid = [
        makeInvoice({ id: 'inv-1', status: 'PAID', ...closesToday }),
      ];
      const { prisma, updateCalls } = buildPrismaDouble(null, paid);
      const service = new InvoicesService(prisma as any, {} as any);

      await service.reopenAllPaid(USER_ID, 'America/Fortaleza');

      expect((updateCalls[0] as any).data.status).toBe('OPEN');
    } finally {
      vi.useRealTimers();
    }
  });
});
