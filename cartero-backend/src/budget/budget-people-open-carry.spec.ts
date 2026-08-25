import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * "Acertos com pessoas" não projeta atraso futuro
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A regra anterior trazia como pendência anterior tudo com
 * `dueDate < monthStart`. Navegando para setembro em 25/08, um item que vence
 * 30/08 satisfazia `30/08 < 01/09` e era carregado — mas naquele dia ele ainda
 * estava no prazo, e afirmar atraso ali inventa um fato.
 *
 * A regra final exige as DUAS condições: veio de competência anterior E já
 * está vencido HOJE. É a mesma filosofia do drawer de Pessoa.
 */

const EVA = { id: 'p-eva', name: 'Eva' };

interface Item {
  amount: number;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  isPaid?: boolean;
}

/**
 * Prisma que aplica o `where` de verdade.
 *
 * Um duplo que ignorasse o limite devolveria o item de 30/08, e o teste
 * passaria mesmo com a projeção de volta.
 */
function buildService(setup: { receivables?: Item[]; debts?: Item[] }) {
  const emJanela = (where: any, item: Item) => {
    const due = new Date(`${item.dueDate}T12:00:00.000Z`);
    if (where.isPaid !== undefined && where.isPaid !== (item.isPaid ?? false)) {
      return false;
    }
    // Consulta de itens PAGOS no mês: nada aqui é pago.
    if (where.paidAt?.gte) return false;
    if (where.dueDate?.gte && due < where.dueDate.gte) return false;
    if (where.dueDate?.lt && due >= where.dueDate.lt) return false;
    return true;
  };

  const linhas = (rows: Item[] | undefined, where: any, comTx = false) =>
    (rows ?? [])
      .filter((item) => emJanela(where, item))
      .map((item) => ({
        amount: money(item.amount),
        isPaid: item.isPaid ?? false,
        paidAt: null,
        title: 'Item',
        dueDate: new Date(`${item.dueDate}T12:00:00.000Z`),
        personId: EVA.id,
        person: EVA,
        ...(comTx ? { transactionId: null } : {}),
      }));

  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    receivable: {
      findMany: vi.fn(async ({ where }: any) =>
        linhas(setup.receivables, where, true),
      ),
    },
    debt: {
      findMany: vi.fn(async ({ where }: any) => linhas(setup.debts, where)),
    },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

/** 25/08/2026, meio-dia em Fortaleza. */
const HOJE = new Date(Date.UTC(2026, 7, 25, 15));

function usarRelogio(quando: Date) {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(quando);
  });
  afterEach(() => vi.useRealTimers());
}

describe('item 32: anterior AINDA NO PRAZO não é trazido', () => {
  usarRelogio(HOJE);

  it('recebível de 30/08 não aparece em setembro', async () => {
    const budget = await buildService({
      receivables: [{ amount: 100, dueDate: '2026-08-30' }],
    }).getBudget(USER_ID, 9, 2026);

    // Item 39: sem outro motivo, a pessoa nem aparece.
    expect(budget.peopleSettlements).toHaveLength(0);
  });

  it('item 35: a regra é simétrica para dívida', async () => {
    const budget = await buildService({
      debts: [
        { amount: 20, dueDate: '2026-08-20' },
        { amount: 30, dueDate: '2026-08-30' },
      ],
    }).getBudget(USER_ID, 9, 2026);

    const [eva] = budget.peopleSettlements;
    expect(eva.open.priorOverdueDebt).toBe(20);
    expect(eva.open.debtTotal).toBe(20);
  });
});

describe('item 33: anterior JÁ VENCIDO é trazido', () => {
  usarRelogio(HOJE);

  it('recebível de 20/08 aparece em setembro', async () => {
    const budget = await buildService({
      receivables: [{ amount: 100, dueDate: '2026-08-20' }],
    }).getBudget(USER_ID, 9, 2026);

    const [eva] = budget.peopleSettlements;
    expect(eva.open.priorOverdueReceivable).toBe(100);
    expect(eva.open.receivableTotal).toBe(100);
    expect(eva.open.hasOverdue).toBe(true);
  });

  it('item 9: vencido há mais tempo também entra', async () => {
    // Julho, não só o mês imediatamente anterior.
    const budget = await buildService({
      debts: [{ amount: 80, dueDate: '2026-07-10' }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.priorOverdueDebt).toBe(80);
  });
});

describe('item 34: o PRÓPRIO dia do vencimento não é atraso', () => {
  usarRelogio(HOJE);

  it('vence hoje (25/08) não entra como pendência anterior', async () => {
    const budget = await buildService({
      receivables: [{ amount: 100, dueDate: '2026-08-25' }],
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements).toHaveLength(0);
  });
});

describe('itens 8 e 40: no dia seguinte, o mesmo item entra', () => {
  usarRelogio(new Date(Date.UTC(2026, 7, 31, 15)));

  it('31/08: o item de 30/08 passa a ser pendência anterior', async () => {
    const budget = await buildService({
      receivables: [{ amount: 100, dueDate: '2026-08-30' }],
    }).getBudget(USER_ID, 9, 2026);

    const [eva] = budget.peopleSettlements;
    expect(eva.open.priorOverdueReceivable).toBe(100);
    expect(eva.open.hasOverdue).toBe(true);
  });
});

describe('itens 12, 24 e 36: item da própria competência', () => {
  usarRelogio(HOJE);

  it('vence em 17/09 e aparece, mesmo sem ter vencido', async () => {
    /*
      A exigência de atraso vale SÓ para trazer item de competência anterior.
      O que vence no mês selecionado pertence a ele por definição.
    */
    const budget = await buildService({
      receivables: [{ amount: 500, dueDate: '2026-09-17' }],
    }).getBudget(USER_ID, 9, 2026);

    const [eva] = budget.peopleSettlements;
    expect(eva.open.receivableInMonth).toBe(500);
    expect(eva.open.priorOverdueReceivable).toBe(0);
    expect(eva.open.hasOverdue).toBe(false);
  });

  it('item 24: só o de setembro entra; o de 30/08 fica de fora', async () => {
    const budget = await buildService({
      receivables: [
        { amount: 100, dueDate: '2026-08-30' },
        { amount: 500, dueDate: '2026-09-15' },
      ],
    }).getBudget(USER_ID, 9, 2026);

    const [eva] = budget.peopleSettlements;
    expect(eva.open.receivableTotal).toBe(500);
    expect(eva.open.priorOverdueReceivable).toBe(0);
  });
});

describe('item 10: futuro mais distante também não projeta', () => {
  usarRelogio(HOJE);

  it('outubro não recebe o item de 30/08 ainda no prazo', async () => {
    const budget = await buildService({
      receivables: [{ amount: 100, dueDate: '2026-08-30' }],
    }).getBudget(USER_ID, 10, 2026);

    expect(budget.peopleSettlements).toHaveLength(0);
  });
});

describe('mês PASSADO preserva o recorte da competência', () => {
  usarRelogio(HOJE);

  it('julho não enxerga o que venceu depois dele', async () => {
    /*
      Para competência passada o limite continua sendo `monthStart`: um item
      de 20/08 já está vencido hoje, mas não pertence ao acerto de julho.
    */
    const budget = await buildService({
      receivables: [{ amount: 100, dueDate: '2026-08-20' }],
    }).getBudget(USER_ID, 7, 2026);

    expect(budget.peopleSettlements).toHaveLength(0);
  });
});

describe('item 26: totalToPay não é afetado', () => {
  usarRelogio(HOJE);

  it('recebível anterior vencido não entra no total a pagar', async () => {
    const budget = await buildService({
      receivables: [{ amount: 100, dueDate: '2026-08-20' }],
    }).getBudget(USER_ID, 9, 2026);

    // Recebível é informativo: nunca compõe o custo do mês.
    expect(budget.totalToPay).toBe(0);
  });
});
