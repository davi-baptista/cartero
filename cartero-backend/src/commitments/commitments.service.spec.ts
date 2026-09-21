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
  isRefund?: boolean;
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
      isRefund: options.isRefund ?? false,
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

  it('não lista série estrutural sem occurrence futura', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'past',
          title: 'Compra 1/2',
          amount: '100',
          index: 1,
          count: 2,
          month: 1,
          year: 2020,
        }),
        row({
          id: 'past-child',
          parentId: 'past',
          title: 'Compra 2/2',
          amount: '100',
          index: 2,
          count: 2,
          month: 2,
          year: 2020,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.installments).toEqual([]);
  });

  it('conta somente rows futuras sobreviventes, sem renumerar a série', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'root',
          title: 'Compra 1/10',
          amount: '100',
          index: 1,
          count: 10,
          month: 1,
          year: 2020,
        }),
        row({
          id: 'next',
          parentId: 'root',
          title: 'Compra 8/10',
          amount: '99',
          index: 8,
          count: 10,
          ...FUTURE,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.installments[0]).toMatchObject({
      totalCount: 10,
      futureCount: 1,
      remaining: 99,
    });
    expect(result.installments[0].nextInstallment?.index).toBe(8);
  });

  it('ordena pela próxima competência e usa id como desempate', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'nov',
          title: 'Novembro 1/2',
          amount: '10',
          index: 1,
          count: 2,
          month: 11,
          year: 2099,
        }),
        row({
          id: 'out-b',
          title: 'Outubro B 1/2',
          amount: '10',
          index: 1,
          count: 2,
          month: 10,
          year: 2099,
        }),
        row({
          id: 'out-a',
          title: 'Outubro A 1/2',
          amount: '10',
          index: 1,
          count: 2,
          month: 10,
          year: 2099,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.installments.map((item) => item.id)).toEqual([
      'out-a',
      'out-b',
      'nov',
    ]);
  });

  it('não inclui refunds no read model nem no forecast', async () => {
    const db = prisma([
      row({
        id: 'refund',
        title: 'Estorno 1/2',
        amount: '500',
        index: 1,
        count: 2,
        isRefund: true,
        ...FUTURE,
      }),
    ]);
    const result = await new CommitmentsService(db).getCommitments(USER_ID);
    const calls = (db.transaction.findMany as any).mock.calls;
    expect(result.installments).toHaveLength(1);
    expect(calls[0][0].where).toMatchObject({
      isRefund: false,
      type: 'CREDIT_CARD',
    });
    expect(calls[1][0].where).toMatchObject({
      isRefund: false,
      type: 'CREDIT_CARD',
      personId: null,
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

  it('mantém séries distintas da mesma pessoa', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'one',
          title: 'Compra A 1/2',
          amount: '100',
          index: 1,
          count: 2,
          person: { id: 'p1', name: 'Eva' },
          ...FUTURE,
        }),
        row({
          id: 'two',
          title: 'Compra B 1/2',
          amount: '200',
          index: 1,
          count: 2,
          person: { id: 'p1', name: 'Eva' },
          ...FUTURE,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.othersInstallments).toHaveLength(2);
    expect(result.totals.othersRemaining).toBe(300);
  });

  it.each(['OPEN', 'CLOSED', 'PAID'] as const)(
    'preserva parcela da competência atual quando invoice está %s',
    async (status) => {
      const probe = await new CommitmentsService(prisma()).getCommitments(
        USER_ID,
      );
      const current = probe.forecast[0];
      const result = await new CommitmentsService(
        prisma(
          [],
          [
            {
              amount: money('250'),
              installmentIndex: 1,
              installmentCount: 2,
              invoice: { ...current, status },
            },
          ],
        ),
      ).getCommitments(USER_ID);
      expect(result.forecast[0].installments).toBe(250);
    },
  );

  it('usa amount real por occurrence no valor futuro', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'root',
          title: 'Guarda Roupa 1/10',
          amount: '219.75',
          index: 1,
          count: 10,
          ...FUTURE,
        }),
        row({
          id: 'next',
          parentId: 'root',
          title: 'Guarda Roupa 8/10',
          amount: '219.66',
          index: 8,
          count: 10,
          month: 7,
          year: 2099,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.installments[0].remaining).toBeCloseTo(439.41, 2);
    expect(result.installments[0].nextInstallment?.amount).toBe(219.75);
  });

  it('agrega no forecast o amount real de cada occurrence', async () => {
    const probe = await new CommitmentsService(prisma()).getCommitments(
      USER_ID,
    );
    const first = probe.forecast[0];
    const second = probe.forecast[1];
    const result = await new CommitmentsService(
      prisma(
        [],
        [
          {
            amount: money('219.75'),
            installmentIndex: 1,
            installmentCount: 10,
            invoice: first,
          },
          {
            amount: money('219.66'),
            installmentIndex: 2,
            installmentCount: 10,
            invoice: second,
          },
        ],
      ),
    ).getCommitments(USER_ID);
    expect(result.forecast[0].installments).toBe(219.75);
    expect(result.forecast[1].installments).toBe(219.66);
  });

  it('reconhece metadata estrutural sem suffix no título e ignora N/M isolado', async () => {
    const structural = row({
      id: 'structural',
      title: 'Compra sem sufixo',
      amount: '100',
      index: 1,
      count: 2,
      ...FUTURE,
    });
    const standalone = {
      ...makeTransaction({
        id: 'standalone',
        title: 'Aluguel 1/2',
        amount: money('100'),
        installmentIndex: null,
        installmentCount: null,
      }),
      invoice: { ...FUTURE },
      bank: { name: 'Cartão' },
      category: { name: 'Casa' },
      person: null,
    };
    const result = await new CommitmentsService(
      prisma([structural, standalone]),
    ).getCommitments(USER_ID);
    expect(result.installments.map((item) => item.title)).toEqual([
      'Compra sem sufixo',
    ]);
  });

  it('mantém o agrupamento quando a raiz foi deletada e só há child sobrevivente', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'survivor',
          parentId: 'deleted-root',
          title: 'Compra 8/10',
          amount: '100',
          index: 8,
          count: 10,
          ...FUTURE,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.installments[0]).toMatchObject({
      id: 'deleted-root',
      totalCount: 10,
      futureCount: 1,
    });
  });

  it('preserva survivor histórico sem tratá-lo como future row', async () => {
    const result = await new CommitmentsService(
      prisma([
        row({
          id: 'protected',
          title: 'Compra 4/10',
          amount: '100',
          index: 4,
          count: 10,
          month: 1,
          year: 2020,
        }),
        row({
          id: 'future',
          parentId: 'protected',
          title: 'Compra 8/10',
          amount: '120',
          index: 8,
          count: 10,
          ...FUTURE,
        }),
      ]),
    ).getCommitments(USER_ID);
    expect(result.installments[0]).toMatchObject({
      totalCount: 10,
      futureCount: 1,
      remaining: 120,
    });
  });
});
