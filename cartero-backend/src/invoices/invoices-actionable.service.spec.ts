import { describe, expect, it, vi } from 'vitest';
import { InvoiceStatus } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { money, USER_ID, utcDate } from 'src/common/testing/fixtures';

/**
 * `findActionable` — isolamento de usuário e formato da query (A21-A23).
 *
 * A authority (`selectActionableInvoices`) já é testada em
 * `common/helpers/actionable-invoices.spec.ts` como função pura, sem noção
 * de usuário. O que falta provar aqui é que o SERVICE nunca deixa vazar
 * invoice de outra conta — a query do Prisma precisa carregar `userId` no
 * `where`, e a authority não teria como filtrar isso sozinha.
 */

function buildPrismaDouble(invoices: unknown[], reimbursableRows: unknown[] = []) {
  const findManyCalls: unknown[] = [];
  const groupByCalls: unknown[] = [];

  const prisma = {
    invoice: {
      findMany: vi.fn(async (args: unknown) => {
        findManyCalls.push(args);
        return invoices;
      }),
    },
    transaction: {
      groupBy: vi.fn(async (args: unknown) => {
        groupByCalls.push(args);
        return reimbursableRows;
      }),
    },
  };

  return { prisma, findManyCalls, groupByCalls };
}

function invoice(over: {
  id: string;
  bankId?: string;
  bankName: string;
  status: InvoiceStatus;
  totalAmount: string;
  closeDate: Date;
  dueDate: Date;
  year?: number;
  month?: number;
}) {
  return {
    id: over.id,
    userId: USER_ID,
    // Default = o próprio nome, como no fixture do helper puro — cada teste
    // pré-existente já tratava nomes distintos como bancos distintos.
    bankId: over.bankId ?? over.bankName,
    bank: { name: over.bankName },
    status: over.status,
    totalAmount: money(over.totalAmount),
    // M5A.2: desempate por competência exige year/month reais — default
    // coerente com o mês de `closeDate` para os testes que não os informam.
    year: over.year ?? over.closeDate.getUTCFullYear(),
    month: over.month ?? over.closeDate.getUTCMonth() + 1,
    closeDate: over.closeDate,
    dueDate: over.dueDate,
  };
}

describe('InvoicesService.findActionable — isolamento (A21-A23)', () => {
  it('a query sempre inclui o userId do chamador no where', async () => {
    const { prisma, findManyCalls } = buildPrismaDouble([]);
    const service = new InvoicesService(prisma as never, {} as never);

    await service.findActionable(USER_ID, 3);

    expect(findManyCalls).toHaveLength(1);
    const args = findManyCalls[0] as { where: { userId: string } };
    expect(args.where.userId).toBe(USER_ID);
  });

  it('a agregação de reimbursable também é escopada pelo userId', async () => {
    const inv = invoice({
      id: 'inv-1',
      bankName: 'Banco A',
      status: InvoiceStatus.OVERDUE,
      totalAmount: '500',
      closeDate: utcDate(2026, 9, 3, 3),
      dueDate: utcDate(2026, 9, 10, 3),
    });
    const { prisma, groupByCalls } = buildPrismaDouble([inv]);
    const service = new InvoicesService(prisma as never, {} as never);

    await service.findActionable(USER_ID, 3);

    expect(groupByCalls).toHaveLength(1);
    const args = groupByCalls[0] as { where: { userId: string } };
    expect(args.where.userId).toBe(USER_ID);
  });

  it('nenhum parâmetro do chamador pode substituir o userId autenticado', async () => {
    // A assinatura do método não aceita um segundo `userId` — só `limit`.
    // Este teste é uma garantia estrutural: `findActionable` tem exatamente
    // dois parâmetros, e o segundo é validado como inteiro pelo DTO, não uma
    // string de identidade.
    const service = new InvoicesService({} as never, {} as never);
    expect(service.findActionable.length).toBe(2);
  });

  it('devolve { items: [] } quando o usuário não tem invoice actionable', async () => {
    const { prisma } = buildPrismaDouble([]);
    const service = new InvoicesService(prisma as never, {} as never);

    const result = await service.findActionable(USER_ID, 3);
    expect(result).toEqual({ items: [] });
  });

  it('produz itens com a authority canônica a partir da query', async () => {
    const inv = invoice({
      id: 'inv-1',
      bankName: 'Banco A',
      status: InvoiceStatus.OVERDUE,
      totalAmount: '1000',
      closeDate: utcDate(2026, 9, 3, 3),
      dueDate: utcDate(2026, 9, 10, 3),
    });
    const { prisma } = buildPrismaDouble(
      [inv],
      [{ invoiceId: 'inv-1', _sum: { amount: money('300') } }],
    );
    const service = new InvoicesService(prisma as never, {} as never);

    const result = await service.findActionable(USER_ID, 3);
    expect(result.items).toEqual([
      {
        bankName: 'Banco A',
        status: InvoiceStatus.OVERDUE,
        closeDate: '2026-09-03',
        dueDate: '2026-09-10',
        actionDate: '2026-09-10',
        ownAmountCents: 70000,
      },
    ]);
  });

  it('M5A.1: agrupa por bankId fim-a-fim — banco com 2 invoices actionable produz 1 item', async () => {
    const overdue = invoice({
      id: 'inv-overdue',
      bankId: 'bank-a',
      bankName: 'Banco A',
      status: InvoiceStatus.OVERDUE,
      totalAmount: '500',
      closeDate: utcDate(2026, 8, 3, 3),
      dueDate: utcDate(2026, 8, 10, 3),
    });
    const openSameBank = invoice({
      id: 'inv-open',
      bankId: 'bank-a', // MESMO banco
      bankName: 'Banco A',
      status: InvoiceStatus.OPEN,
      totalAmount: '300',
      closeDate: utcDate(2026, 9, 20, 3),
      dueDate: utcDate(2026, 9, 27, 3),
    });
    const { prisma } = buildPrismaDouble([overdue, openSameBank]);
    const service = new InvoicesService(prisma as never, {} as never);

    const result = await service.findActionable(USER_ID, 3);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe(InvoiceStatus.OVERDUE);
  });
});
