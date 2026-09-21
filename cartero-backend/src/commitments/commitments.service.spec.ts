import { describe, expect, it, vi } from 'vitest';
import { CommitmentsService as CommitmentsServiceImpl } from './commitments.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeTransaction, money } from 'src/common/testing/fixtures';

class CommitmentsService extends CommitmentsServiceImpl {
  override getCommitments(
    userId: string,
    timeZone: string | null = 'America/Fortaleza',
  ) {
    return super.getCommitments(userId, timeZone);
  }
}

function row(options: {
  id: string;
  parentId?: string | null;
  title: string;
  amount: string;
  month: number;
  year: number;
  index: number;
  count: number;
  person?: { id: string; name: string } | null;
}) {
  return {
    ...makeTransaction({
      id: options.id,
      parentId: options.parentId ?? null,
      title: options.title,
      amount: money(options.amount),
      installmentIndex: options.index,
      installmentCount: options.count,
    }),
    invoice: { month: options.month, year: options.year },
    bank: { name: 'Cartão Teste' },
    category: { name: 'Compras' },
    person: options.person ?? null,
  };
}

function prisma(installments: any[] = [], forecastRows: any[] = []) {
  return {
    transaction: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce(installments)
        .mockResolvedValueOnce(forecastRows),
    },
  } as unknown as PrismaService;
}

const FUTURE = { month: 6, year: 2099 };

describe('CommitmentsService — Parcelas', () => {
  it('retorna somente o read model de parcelas', async () => {
    const result = await new CommitmentsService(prisma()).getCommitments(
      USER_ID,
    );
    expect(result).toEqual(
      expect.objectContaining({
        installments: [],
        othersInstallments: [],
        totals: expect.any(Object),
        forecast: expect.any(Array),
      }),
    );
    expect(result).not.toHaveProperty('subscriptions');
    expect(result.totals).not.toHaveProperty('monthlySubscriptions');
  });

  it('agrupa por parentId ?? id e preserva contagem original', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'root',
          title: 'Notebook 1/3',
          amount: '100',
          index: 1,
          count: 3,
          ...FUTURE,
        }),
        row({
          id: 'child',
          parentId: 'root',
          title: 'Notebook 2/3',
          amount: '99.99',
          index: 2,
          count: 3,
          ...FUTURE,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.installments).toHaveLength(1);
    expect(result.installments[0]).toMatchObject({
      id: 'root',
      totalCount: 3,
      futureCount: 2,
      remaining: 199.99,
    });
  });

  it('separa terceiros da própria parte sem duplicar valores', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'own',
          title: 'Minha 1/2',
          amount: '300',
          index: 1,
          count: 2,
          ...FUTURE,
        }),
        row({
          id: 'other',
          title: 'Show 1/2',
          amount: '200',
          index: 1,
          count: 2,
          person: { id: 'p1', name: 'Eva' },
          ...FUTURE,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.installments.map((item) => item.title)).toEqual(['Minha']);
    expect(result.othersInstallments[0]).toMatchObject({
      title: 'Show',
      personId: 'p1',
      personName: 'Eva',
    });
    expect(result.totals).toEqual({
      installmentsRemaining: 300,
      othersRemaining: 200,
    });
  });

  it('expõe a próxima ocorrência real e não um valor fixo da série', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'root',
          title: 'Compra 1/2',
          amount: '219.75',
          index: 1,
          count: 2,
          month: 10,
          year: 2099,
        }),
        row({
          id: 'child',
          parentId: 'root',
          title: 'Compra 2/2',
          amount: '219.66',
          index: 2,
          count: 2,
          month: 11,
          year: 2099,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.installments[0].nextInstallment).toMatchObject({
      amount: 219.75,
      month: 10,
      year: 2099,
    });
  });

  it('só mostra end month quando a última parcela original existe', async () => {
    const complete = await new CommitmentsService(
      prisma([
        row({
          id: 'root',
          title: 'Compra 1/2',
          amount: '100',
          index: 1,
          count: 2,
          month: 10,
          year: 2099,
        }),
        row({
          id: 'child',
          parentId: 'root',
          title: 'Compra 2/2',
          amount: '100',
          index: 2,
          count: 2,
          month: 11,
          year: 2099,
        }),
      ]),
    ).getCommitments(USER_ID);
    const incomplete = await new CommitmentsService(
      prisma([
        row({
          id: 'root',
          title: 'Compra 1/3',
          amount: '100',
          index: 1,
          count: 3,
          ...FUTURE,
        }),
        row({
          id: 'child',
          parentId: 'root',
          title: 'Compra 2/3',
          amount: '100',
          index: 2,
          count: 3,
          ...FUTURE,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(complete.installments[0].endsAt).toEqual({ month: 11, year: 2099 });
    expect(incomplete.installments[0].endsAt).toBeNull();
  });

  it('gráfico inclui own current/future rows and excludes third-party rows', async () => {
    const probe = await new CommitmentsService(prisma()).getCommitments(
      USER_ID,
    );
    const first = probe.forecast[0];
    const result = await new CommitmentsService(
      prisma(
        [],
        [
          {
            amount: money('250'),
            installmentIndex: 1,
            installmentCount: 2,
            invoice: first,
          },
          {
            amount: money('999'),
            personId: 'p1',
            installmentIndex: 1,
            installmentCount: 2,
            invoice: first,
          },
        ],
      ),
    ).getCommitments(USER_ID);
    expect(result.forecast[0].installments).toBe(250);
  });
});
