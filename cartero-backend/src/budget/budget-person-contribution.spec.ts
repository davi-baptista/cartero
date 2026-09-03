import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Uma obrigação com Pessoa entra no Orçamento UMA vez, pelo líquido
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O total do Orçamento já usava o netting por pessoa
 * (`payable = max(dívidas − recebíveis, 0)`), mas o progresso "R$ X pago" saía
 * de `paidInMonthTotal` — a soma BRUTA das dívidas quitadas, incluindo as
 * vinculadas a pessoa.
 *
 * Com R$ 30 devidos e R$ 50 a receber da mesma pessoa, a contribuição é ZERO:
 * a relação não é saída líquida nenhuma. Mas quitar a dívida somava R$ 30 ao
 * "pago" — um número sem origem visível na tela, porque a pessoa nem aparece
 * em "Acertos com pessoas".
 *
 * O `Math.min(..., totalToPay)` existente é um teto GLOBAL: impede o absurdo de
 * "pagou mais que o total", não o vazamento por pessoa.
 *
 * ── O que esta fase fixa ──
 *
 *   planned    max(dívidas − recebíveis, 0)     a saída líquida da relação
 *   paid       min(planned, dívidas quitadas)   nunca ultrapassa o planejado
 *   remaining  planned − paid
 *
 * E `planned = paid + remaining`, por construção.
 */

const EVA = { id: 'p-eva', name: 'Eva' };

interface Item {
  amount: number;
  dueDate: string;
  isPaid?: boolean;
  paidAt?: string | null;
  /** `false` para dívida SEM pessoa — a regra antiga, preservada. */
  comPessoa?: boolean;
}

function buildService(setup: { receivables?: Item[]; debts?: Item[] }) {
  const dia = (v: string) => new Date(`${v}T12:00:00.000Z`);

  /* O dublê honra o `where` — sem isso os filtros deixariam de ser testados. */
  const emJanela = (where: any, item: Item) => {
    if (where.isPaid !== undefined && where.isPaid !== (item.isPaid ?? false)) {
      return false;
    }
    if (where.personId?.not === null && item.comPessoa === false) return false;
    if (where.paidAt?.gte) {
      if (!item.paidAt) return false;
      const pago = dia(item.paidAt);
      if (pago < where.paidAt.gte) return false;
      if (where.paidAt.lt && pago >= where.paidAt.lt) return false;
      return true;
    }
    const due = dia(item.dueDate);
    if (where.dueDate?.gte && due < where.dueDate.gte) return false;
    if (where.dueDate?.lt && due >= where.dueDate.lt) return false;
    return true;
  };

  const linhas = (rows: Item[] | undefined, where: any, comTx = false) =>
    (rows ?? [])
      .filter((item) => emJanela(where, item))
      .map((item) => {
        const temPessoa = item.comPessoa !== false;
        return {
          amount: money(item.amount),
          isPaid: item.isPaid ?? false,
          paidAt: item.paidAt ? dia(item.paidAt) : null,
          title: 'Item',
          dueDate: dia(item.dueDate),
          personId: temPessoa ? EVA.id : null,
          person: temPessoa ? EVA : null,
          ...(comTx ? { transactionId: null } : {}),
        };
      });

  const receivableFind = vi.fn(async ({ where }: any) =>
    linhas(setup.receivables, where, true),
  );
  const debtFind = vi.fn(async ({ where }: any) => linhas(setup.debts, where));

  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    receivable: { findMany: receivableFind },
    debt: { findMany: debtFind },
  };

  const service = new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );

  return { service, receivableFind, debtFind };
}

const budgetOf = (setup: Parameters<typeof buildService>[0]) =>
  buildService(setup).service.getBudget(USER_ID, 9, 2026);

/** 15/09/2026, meio-dia em Fortaleza. */
const HOJE = new Date(Date.UTC(2026, 8, 15, 15));

function usarRelogio(quando: Date) {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(quando);
  });
  afterEach(() => vi.useRealTimers());
}

const pessoaDe = (budget: Awaited<ReturnType<typeof budgetOf>>) =>
  budget.peopleSettlements[0];

describe('C1-C4: a contribuição planejada', () => {
  usarRelogio(HOJE);

  it('C1: devo 30, ela me deve 50 → contribuição ZERO', () => {
    /*
      A relação não é saída líquida nenhuma. Quem me deve mais do que eu devo
      não vira crédito no orçamento — mas também não vira despesa.
    */
    return budgetOf({
      debts: [{ amount: 30, dueDate: '2026-09-10' }],
      receivables: [{ amount: 50, dueDate: '2026-09-10' }],
    }).then((b) => {
      expect(pessoaDe(b)?.budget.payable ?? 0).toBe(0);
    });
  });

  it('C2: devo 11, ela me deve 10 → contribuição 1', () => {
    return budgetOf({
      debts: [{ amount: 11, dueDate: '2026-09-10' }],
      receivables: [{ amount: 10, dueDate: '2026-09-10' }],
    }).then((b) => {
      expect(pessoaDe(b).budget.payable).toBe(1);
    });
  });

  it('C3: devo 100, sem recebível → contribuição 100', () => {
    return budgetOf({
      debts: [{ amount: 100, dueDate: '2026-09-10' }],
    }).then((b) => {
      expect(pessoaDe(b).budget.payable).toBe(100);
    });
  });

  it('C4: só recebível → contribuição ZERO', () => {
    return budgetOf({
      receivables: [{ amount: 100, dueDate: '2026-09-10' }],
    }).then((b) => {
      expect(pessoaDe(b)?.budget.payable ?? 0).toBe(0);
    });
  });
});

describe('L1-L3: a dívida bruta não vaza para o "pago"', () => {
  usarRelogio(HOJE);

  it('L1/§48: o R$ 30 fantasma', () => {
    /*
      A regressão relatada. Contribuição ZERO, dívida de R$ 30 quitada — e o
      summary anunciava "R$ 30 pago" sem nenhuma row de origem, porque a
      pessoa nem entra em "Acertos com pessoas" com contribuição zero.
    */
    return budgetOf({
      debts: [
        { amount: 30, dueDate: '2026-09-10', isPaid: true, paidAt: '2026-09-12' },
      ],
      receivables: [{ amount: 50, dueDate: '2026-09-10' }],
    }).then((b) => {
      expect(b.totalPaid).toBe(0);
      expect(b.totalToPay).toBe(0);
    });
  });

  it('L1b: o fantasma aparece quando há FOLGA no total', () => {
    /*
      O caso que revela o bug de verdade. Sozinho, o cenário 30/50 tem
      `totalToPay = 0` e o teto GLOBAL (`min(..., totalToPay)`) mascara o
      vazamento por acidente.

      Com outra despesa dando folga, os R$ 30 passavam: o total ficava certo
      (R$ 200 da dívida avulsa) e o pago vinha R$ 30 — sem nenhuma origem na
      tela, porque Eva não aparece em "Acertos com pessoas".
    */
    return budgetOf({
      debts: [
        { amount: 30, dueDate: '2026-09-10', isPaid: true, paidAt: '2026-09-12' },
        { amount: 200, dueDate: '2026-09-22', comPessoa: false },
      ],
      receivables: [{ amount: 50, dueDate: '2026-09-10' }],
    }).then((b) => {
      expect(b.totalToPay).toBe(200);
      expect(b.totalPaid).toBe(0);
      expect(b.totalPending).toBe(200);
    });
  });

  it('L1c: e some junto com a folga, em qualquer combinação', () => {
    /*
      Propriedade, não caso: a contribuição de Eva é zero, então nenhum valor
      de despesa avulsa faz os R$ 30 reaparecerem.
    */
    return Promise.all(
      [50, 200, 5000].map(async (avulsa) => {
        const b = await budgetOf({
          debts: [
            { amount: 30, dueDate: '2026-09-10', isPaid: true, paidAt: '2026-09-12' },
            { amount: avulsa, dueDate: '2026-09-22', comPessoa: false },
          ],
          receivables: [{ amount: 50, dueDate: '2026-09-10' }],
        });
        expect(b.totalPaid, `avulsa ${avulsa}`).toBe(0);
        expect(b.totalToPay, `avulsa ${avulsa}`).toBe(avulsa);
      }),
    );
  });

  it('L3: dívida SEM pessoa continua contando integralmente', () => {
    /*
      O contrapeso. O netting é por PESSOA; sem pessoa não há recebível com
      quem compensar, e a regra antiga vale sem alteração.
    */
    return budgetOf({
      debts: [
        {
          amount: 30,
          dueDate: '2026-09-10',
          isPaid: true,
          paidAt: '2026-09-12',
          comPessoa: false,
        },
      ],
    }).then((b) => {
      expect(b.totalToPay).toBe(30);
      expect(b.totalPaid).toBe(30);
    });
  });

  it('um recebível de OUTRA pessoa não compensa', () => {
    /*
      O netting é por pessoa: dinheiro que Eva me deve não paga uma obrigação
      com Fabrício. Aqui a dívida não tem pessoa, então nada compensa.
    */
    return budgetOf({
      debts: [
        { amount: 30, dueDate: '2026-09-10', comPessoa: false },
      ],
      receivables: [{ amount: 50, dueDate: '2026-09-10' }],
    }).then((b) => {
      expect(b.totalToPay).toBe(30);
    });
  });
});

describe('F1-F3: o caso Fabricio (11 / 10)', () => {
  usarRelogio(HOJE);

  const cenario = (debtPaidAt: string | null, recvPaidAt: string | null) => ({
    debts: [
      {
        amount: 11,
        dueDate: '2026-09-20',
        isPaid: debtPaidAt !== null,
        paidAt: debtPaidAt,
      },
    ],
    receivables: [
      {
        amount: 10,
        dueDate: '2026-09-20',
        isPaid: recvPaidAt !== null,
        paidAt: recvPaidAt,
      },
    ],
  });

  it('F1: tudo aberto → planejado 1, pago 0', () => {
    return budgetOf(cenario(null, null)).then((b) => {
      expect(pessoaDe(b).budget.payable).toBe(1);
      expect(b.totalToPay).toBe(1);
      expect(b.totalPaid).toBe(0);
      expect(b.totalPending).toBe(1);
    });
  });

  it('F2: dívida paga, recebível ABERTO → pago 1, não 11', () => {
    /*
      O contrato deliberado: a saída líquida planejada de R$ 1 já está
      coberta, mesmo com o recebível de R$ 10 em aberto. O Orçamento pergunta
      "quanto saiu do bolso", não "a relação terminou".
    */
    return budgetOf(cenario('2026-09-12', null)).then((b) => {
      expect(pessoaDe(b).budget.payable).toBe(1);
      expect(b.totalPaid).toBe(1);
      expect(b.totalPaid).not.toBe(11);
      expect(b.totalPending).toBe(0);
    });
  });

  it('F3: recebido depois → o Orçamento não muda de base', () => {
    return budgetOf(cenario('2026-09-12', '2026-09-18')).then((b) => {
      expect(pessoaDe(b).budget.payable).toBe(1);
      expect(b.totalPaid).toBe(1);
    });
  });
});

describe('M1-M3: o pago é limitado pelo planejado', () => {
  usarRelogio(HOJE);

  const multiplas = (pagas: Array<string | null>) => ({
    debts: [
      { amount: 30, dueDate: '2026-09-10', isPaid: !!pagas[0], paidAt: pagas[0] },
      { amount: 100, dueDate: '2026-09-14', isPaid: !!pagas[1], paidAt: pagas[1] },
    ],
    receivables: [{ amount: 80, dueDate: '2026-09-10' }],
  });

  it('M1: 130 devidos − 80 a receber → planejado 50', () => {
    return budgetOf(multiplas([null, null])).then((b) => {
      expect(pessoaDe(b).budget.payable).toBe(50);
      expect(b.totalPaid).toBe(0);
    });
  });

  it('M2: primeira dívida paga → pago 30', () => {
    return budgetOf(multiplas(['2026-09-05', null])).then((b) => {
      expect(b.totalPaid).toBe(30);
      expect(b.totalPending).toBe(20);
    });
  });

  it('M3: as duas pagas → pago LIMITADO a 50, nunca 130', () => {
    /*
      Sem o teto por pessoa, R$ 130 pagos de um planejado de R$ 50 diriam que
      se pagou mais do que havia a pagar.
    */
    return budgetOf(multiplas(['2026-09-05', '2026-09-12'])).then((b) => {
      expect(b.totalPaid).toBe(50);
      expect(b.totalPaid).not.toBe(130);
      expect(b.totalPending).toBe(0);
    });
  });
});

describe('R2/§23: planned = paid + remaining', () => {
  usarRelogio(HOJE);

  it('a identidade vale em todos os estados', () => {
    const casos: Array<[string, Parameters<typeof budgetOf>[0]]> = [
      ['nada pago', { debts: [{ amount: 11, dueDate: '2026-09-20' }], receivables: [{ amount: 10, dueDate: '2026-09-20' }] }],
      ['tudo pago', { debts: [{ amount: 11, dueDate: '2026-09-20', isPaid: true, paidAt: '2026-09-12' }], receivables: [{ amount: 10, dueDate: '2026-09-20' }] }],
      ['contribuição zero', { debts: [{ amount: 30, dueDate: '2026-09-10' }], receivables: [{ amount: 50, dueDate: '2026-09-10' }] }],
      ['sem pessoa', { debts: [{ amount: 40, dueDate: '2026-09-10', comPessoa: false }] }],
    ];

    return Promise.all(
      casos.map(async ([nome, setup]) => {
        const b = await budgetOf(setup);
        expect(b.totalPaid + b.totalPending, nome).toBeCloseTo(b.totalToPay, 2);
      }),
    );
  });

  it('R1: o total da seção reconcilia com a soma das contribuições', () => {
    return budgetOf({
      debts: [
        { amount: 11, dueDate: '2026-09-20' },
        { amount: 100, dueDate: '2026-09-21' },
      ],
      receivables: [{ amount: 10, dueDate: '2026-09-20' }],
    }).then((b) => {
      const soma = b.peopleSettlements.reduce(
        (t, p) => t + p.budget.payable,
        0,
      );
      expect(soma).toBe(b.breakdown.peopleSettlements);
    });
  });
});

describe('performance: nenhuma consulta por pessoa', () => {
  usarRelogio(HOJE);

  it('o número de consultas não cresce com os itens', async () => {
    const { service, receivableFind, debtFind } = buildService({
      debts: [
        { amount: 10, dueDate: '2026-09-10' },
        { amount: 20, dueDate: '2026-09-11' },
        { amount: 30, dueDate: '2026-09-12' },
      ],
      receivables: [
        { amount: 5, dueDate: '2026-09-10' },
        { amount: 15, dueDate: '2026-09-11' },
      ],
    });

    await service.getBudget(USER_ID, 9, 2026);

    const chamadas =
      receivableFind.mock.calls.length + debtFind.mock.calls.length;
    expect(chamadas).toBeLessThanOrEqual(12);
  });
});
