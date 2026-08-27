import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  USER_ID,
  makeBank,
  makeInvoice,
  money,
} from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Netting POR PESSOA — supera deliberadamente a regra da Fase 9B
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A Fase 9B proibiu qualquer compensação, e estava certa para o problema
 * daquela época: o cálculo compensava E FILTRAVA a pessoa da lista, então a
 * obrigação sumia da tela junto com o número.
 *
 * O Orçamento mensal responde "quanto preciso considerar como saída minha
 * nesta competência?". Se Fabrício me deve 10 e eu devo 11, a saída é 1 —
 * somar 11 brutos infla o mês com dinheiro que volta.
 *
 * As três travas que tornam isso seguro, e que este arquivo vigia:
 *
 *   · a compensação é por `personId`, nunca entre pessoas diferentes;
 *   · o resultado é `max(…, 0)` — pessoa nunca vira crédito no total;
 *   · nada é escrito: isto é projeção, não encontro de contas.
 */

interface Item {
  amount: number;
  person: string | null;
  /** `YYYY-MM-DD`; default: dentro do mês consultado. */
  dueDate?: string;
  /** Quando foi pago/recebido. */
  paidAt?: string;
}

const DENTRO_DO_MES = '2026-09-15';

function buildService(setup: {
  invoiceOwn?: number;
  debts?: Item[];
  receivables?: Item[];
  directPayments?: number;
}) {
  const linhas = (rows: Item[] | undefined, where: any) =>
    (rows ?? [])
      .filter((item) => {
        const due = new Date(`${item.dueDate ?? DENTRO_DO_MES}T12:00:00.000Z`);
        const paidAt = item.paidAt
          ? new Date(`${item.paidAt}T12:00:00.000Z`)
          : null;
        const isPaid = paidAt !== null;

        if (where.isPaid !== undefined && where.isPaid !== isPaid) return false;

        if (where.paidAt?.gte && where.paidAt?.lt) {
          return (
            paidAt !== null &&
            paidAt >= where.paidAt.gte &&
            paidAt < where.paidAt.lt
          );
        }
        if (where.dueDate?.gte && where.dueDate?.lt) {
          return due >= where.dueDate.gte && due < where.dueDate.lt;
        }
        if (where.dueDate?.lt) return due < where.dueDate.lt;
        return false;
      })
      .map((item) => ({
        amount: money(item.amount),
        isPaid: item.paidAt != null,
        paidAt: item.paidAt ? new Date(`${item.paidAt}T12:00:00.000Z`) : null,
        title: 'Item',
        dueDate: new Date(`${item.dueDate ?? DENTRO_DO_MES}T12:00:00.000Z`),
        personId: item.person,
        person: item.person ? { id: item.person, name: item.person } : null,
        transactionId: null,
      }));

  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: {
      findMany: vi.fn(async () =>
        setup.invoiceOwn
          ? [
              {
                ...makeInvoice({
                  id: 'inv-1',
                  totalAmount: money(setup.invoiceOwn),
                }),
                bank: makeBank(),
              },
            ]
          : [],
      ),
    },
    transaction: {
      findMany: vi.fn(async () =>
        setup.directPayments ? [{ amount: money(setup.directPayments) }] : [],
      ),
      groupBy: vi.fn(async () => []),
    },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    debt: {
      findMany: vi.fn(async ({ where }: any) => linhas(setup.debts, where)),
    },
    receivable: {
      findMany: vi.fn(async ({ where }: any) =>
        linhas(setup.receivables, where),
      ),
    },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

/** 20/09/2026 — dentro do mês consultado, depois dos vencimentos padrão. */
const HOJE = new Date(Date.UTC(2026, 8, 20, 15));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(HOJE);
});
afterEach(() => vi.useRealTimers());

const setembro = (service: BudgetService) =>
  service.getBudget(USER_ID, 9, 2026);

describe('itens 53-54: o cenário real', () => {
  it('só Fabrício representa saída líquida', async () => {
    const budget = await setembro(
      buildService({
        invoiceOwn: 888.74,
        receivables: [
          { amount: 331.42, person: 'eva' },
          { amount: 219.66, person: 'jeoge' },
          { amount: 10, person: 'fabricio' },
          { amount: 19.97, person: 'breno' },
        ],
        debts: [{ amount: 11, person: 'fabricio' }],
      }),
    );

    const porPessoa = Object.fromEntries(
      budget.peopleSettlements.map((p) => [p.personId, p.budget.payable]),
    );

    expect(porPessoa.eva).toBe(0);
    expect(porPessoa.jeoge).toBe(0);
    expect(porPessoa.breno).toBe(0);
    expect(porPessoa.fabricio).toBe(1);

    expect(budget.breakdown.peopleSettlements).toBe(1);
    expect(budget.totalToPay).toBeCloseTo(889.74, 2);
  });

  it('mesma pessoa: 500 de dívida contra 300 a receber → 200', async () => {
    const budget = await setembro(
      buildService({
        debts: [{ amount: 500, person: 'a' }],
        receivables: [{ amount: 300, person: 'a' }],
      }),
    );

    expect(budget.peopleSettlements[0].budget.payable).toBe(200);
    expect(budget.totalToPay).toBe(200);
  });
});

describe('item 55: netting entre PESSOAS é proibido', () => {
  it('o que A me deve não paga a obrigação com B', async () => {
    /*
      A trava mais importante. Sem ela, um saldo grande a receber de uma
      pessoa apagaria obrigações reais com terceiros.
    */
    const budget = await setembro(
      buildService({
        receivables: [{ amount: 500, person: 'a' }],
        debts: [{ amount: 300, person: 'b' }],
      }),
    );

    const porPessoa = Object.fromEntries(
      budget.peopleSettlements.map((p) => [p.personId, p.budget.payable]),
    );

    expect(porPessoa.a).toBe(0);
    expect(porPessoa.b).toBe(300);
    expect(budget.totalToPay).toBe(300);
  });
});

describe('itens 56-57: os limites', () => {
  it('valores iguais zeram a contribuição', async () => {
    const budget = await setembro(
      buildService({
        debts: [{ amount: 300, person: 'a' }],
        receivables: [{ amount: 300, person: 'a' }],
      }),
    );

    expect(budget.peopleSettlements[0].budget.payable).toBe(0);
    expect(budget.totalToPay).toBe(0);
  });

  it('recebível muito maior nunca vira crédito', async () => {
    const budget = await setembro(
      buildService({
        invoiceOwn: 500,
        debts: [{ amount: 100, person: 'a' }],
        receivables: [{ amount: 9999, person: 'a' }],
      }),
    );

    expect(budget.peopleSettlements[0].budget.payable).toBe(0);
    // A fatura NÃO é reduzida pelo saldo a favor da pessoa.
    expect(budget.totalToPay).toBe(500);
  });
});

describe('itens 58 e 6: itens sem pessoa', () => {
  it('recebível sem pessoa não compensa ninguém', async () => {
    const budget = await setembro(
      buildService({
        debts: [{ amount: 100, person: 'a' }],
        receivables: [{ amount: 9999, person: null }],
      }),
    );

    expect(budget.totalToPay).toBe(100);
  });

  it('dívida sem pessoa é obrigação integral', async () => {
    const budget = await setembro(
      buildService({
        debts: [{ amount: 100, person: null }],
        receivables: [{ amount: 9999, person: 'a' }],
      }),
    );

    expect(budget.breakdown.debts).toBe(100);
    expect(budget.breakdown.peopleSettlements).toBe(0);
    expect(budget.totalToPay).toBe(100);
  });
});

describe('itens 60-61: itens já resolvidos', () => {
  it('item 60: dívida paga e recebível recebido no mês compensam', async () => {
    /*
      A fotografia mensal precisa dos dois: o mês custou 20, não 100.
      `open` não os vê — lá tudo é `isPaid: false`.
    */
    const budget = await setembro(
      buildService({
        debts: [{ amount: 100, person: 'a', paidAt: '2026-09-10' }],
        receivables: [{ amount: 80, person: 'a', paidAt: '2026-09-12' }],
      }),
    );

    expect(budget.peopleSettlements[0].budget.payable).toBe(20);
    expect(budget.totalToPay).toBe(20);
  });

  it('item 29: recebido maior que pago não vira crédito', async () => {
    const budget = await setembro(
      buildService({
        debts: [{ amount: 80, person: 'a', paidAt: '2026-09-10' }],
        receivables: [{ amount: 100, person: 'a', paidAt: '2026-09-12' }],
      }),
    );

    expect(budget.peopleSettlements[0].budget.payable).toBe(0);
    expect(budget.totalToPay).toBe(0);
  });

  it('item 61: recebimento de OUTRO mês não compensa', async () => {
    const budget = await setembro(
      buildService({
        debts: [{ amount: 100, person: 'a' }],
        receivables: [
          {
            amount: 80,
            person: 'a',
            dueDate: '2026-08-05',
            paidAt: '2026-08-20',
          },
        ],
      }),
    );

    // O dinheiro entrou em agosto; setembro custa os 100.
    expect(budget.totalToPay).toBe(100);
  });
});

describe('item 62: o netting é MENSAL, não diário', () => {
  it('vencimentos diferentes no mesmo mês compensam', async () => {
    /*
      Decisão documentada: dívida em 02/09 contra recebível em 30/09 dá 10 de
      saída no mês. O Orçamento é mensal; Calendário e Pessoa continuam
      mostrando o timing diário.
    */
    const budget = await setembro(
      buildService({
        debts: [{ amount: 100, person: 'a', dueDate: '2026-09-02' }],
        receivables: [{ amount: 90, person: 'a', dueDate: '2026-09-30' }],
      }),
    );

    expect(budget.peopleSettlements[0].budget.payable).toBe(10);
  });
});

describe('itens 65 e 48: composição e reconciliação', () => {
  it('item 65: genérica e pessoa somam separadamente', async () => {
    const budget = await setembro(
      buildService({
        invoiceOwn: 500,
        debts: [
          { amount: 100, person: null },
          { amount: 80, person: 'a' },
        ],
        receivables: [{ amount: 50, person: 'a' }],
      }),
    );

    expect(budget.breakdown.invoices).toBe(500);
    expect(budget.breakdown.debts).toBe(100);
    expect(budget.breakdown.peopleSettlements).toBe(30);
    expect(budget.totalToPay).toBe(630);
  });

  it('item 48: os quatro componentes fecham com o total', async () => {
    const budget = await setembro(
      buildService({
        invoiceOwn: 500,
        directPayments: 50,
        debts: [
          { amount: 100, person: null },
          { amount: 80, person: 'a' },
        ],
        receivables: [{ amount: 50, person: 'a' }],
      }),
    );

    const { invoices, directPayments, debts, peopleSettlements } =
      budget.breakdown;

    expect(invoices + directPayments + debts + peopleSettlements).toBeCloseTo(
      budget.totalToPay,
      2,
    );
    expect(budget.totalToPay).toBe(680);
  });
});
