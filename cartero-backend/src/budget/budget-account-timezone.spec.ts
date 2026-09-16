import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ2 — Overdue de Debt/Receivable respeita User.timeZone (Orçamento)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `budget-people-open-carry.spec.ts` já prova a regra legada (`timeZone =
 * null`, authority Fortaleza-fixa) exaustivamente — este arquivo prova
 * especificamente o CONTRASTE: a mesma dívida/recebível, o mesmo instante
 * real, produz `hasOverdue` diferente dependendo de qual authority a conta
 * usa. Isso é o que discrimina "a integração fez alguma coisa" de "a
 * integração só existe no papel".
 */

const EVA = { id: 'p-eva', name: 'Eva' };

interface Item {
  amount: number;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  isPaid?: boolean;
}

function buildService(setup: {
  receivables?: Item[];
  debts?: Item[];
  timeZone: string | null;
}) {
  const emJanela = (where: any, item: Item) => {
    const due = new Date(`${item.dueDate}T12:00:00.000Z`);
    if (where.isPaid !== undefined && where.isPaid !== (item.isPaid ?? false)) {
      return false;
    }
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
    user: {
      findUnique: vi.fn(async () => ({})),
      findUniqueOrThrow: vi.fn(async () => ({ timeZone: setup.timeZone })),
      update: vi.fn(),
    },
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

/*
  16/09/2026, 15:30 UTC — o instante discriminante já usado em
  `financial-timezone.helper.spec.ts`: 12:30 em Fortaleza (ainda dia 16),
  mas já 00:30 do dia 17 em Tóquio.
*/
const AGORA = new Date('2026-09-16T15:30:00.000Z');

function usarRelogio(quando: Date) {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(quando);
  });
  afterEach(() => vi.useRealTimers());
}

describe('D1: legacy null reproduz o baseline exatamente (dueDate = hoje-em-Fortaleza, não overdue)', () => {
  usarRelogio(AGORA);

  it('dívida vencendo 16/09 (hoje em Fortaleza) com timeZone=null NÃO é overdue', async () => {
    const budget = await buildService({
      debts: [{ amount: 50, dueDate: '2026-09-16' }],
      timeZone: null,
    }).getBudget(USER_ID, 9, 2026);

    const [eva] = budget.peopleSettlements;
    expect(eva.open.hasOverdue).toBe(false);
  });
});

describe('D2/T28: mesmo instante, mesma dívida — Fortaleza (null-equivalente) vs. Tokyo divergem', () => {
  usarRelogio(AGORA);

  it('conta com timeZone=America/Fortaleza: dueDate=16/09 ainda NÃO é overdue (mesmo resultado do legado)', async () => {
    const budget = await buildService({
      debts: [{ amount: 50, dueDate: '2026-09-16' }],
      timeZone: 'America/Fortaleza',
    }).getBudget(USER_ID, 9, 2026);

    const [eva] = budget.peopleSettlements;
    expect(eva.open.hasOverdue).toBe(false);
  });

  it('conta com timeZone=Asia/Tokyo: o MESMO dueDate=16/09 JÁ é overdue (lá já é dia 17)', async () => {
    /*
      Este é o teste que prova a integração real: a mesma dívida, o mesmo
      relógio do sistema, mas uma conta em Tóquio já passou da meia-noite
      de 17/09 — o vencimento de 16/09 ficou para trás. Se a authority
      estivesse silenciosamente ignorando `timeZone` (ou usando Fortaleza/
      UTC para todo mundo), este teste falharia.
    */
    const budget = await buildService({
      debts: [{ amount: 50, dueDate: '2026-09-16' }],
      timeZone: 'Asia/Tokyo',
    }).getBudget(USER_ID, 9, 2026);

    const [eva] = budget.peopleSettlements;
    expect(eva.open.hasOverdue).toBe(true);
  });
});

describe('D3/D4/D5: due yesterday/today/tomorrow, timezone-aware', () => {
  usarRelogio(AGORA);

  it('D3: dueDate=15/09 (ontem em Fortaleza) é overdue mesmo com timeZone configurada', async () => {
    const budget = await buildService({
      debts: [{ amount: 50, dueDate: '2026-09-15' }],
      timeZone: 'America/Fortaleza',
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.hasOverdue).toBe(true);
  });

  it('D4: dueDate=16/09 (hoje em Fortaleza) NÃO é overdue com timeZone=America/Fortaleza', async () => {
    const budget = await buildService({
      debts: [{ amount: 50, dueDate: '2026-09-16' }],
      timeZone: 'America/Fortaleza',
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.hasOverdue).toBe(false);
  });

  it('D5: dueDate=17/09 (amanhã em Fortaleza) pertence ao mês corrente, sem overdue', async () => {
    const budget = await buildService({
      debts: [{ amount: 50, dueDate: '2026-09-17' }],
      timeZone: 'America/Fortaleza',
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.peopleSettlements[0].open.hasOverdue).toBe(false);
    expect(budget.peopleSettlements[0].open.debtInMonth).toBe(50);
  });
});

describe('D6: month boundary — isCurrentCompetence escolhida pela timezone da conta', () => {
  /*
    `debts.currentOpenPrior` (nível raiz da resposta, distinto de
    `peopleSettlements[].open.priorOverdueDebt`) é o campo GATED por
    `isCurrentMonth` — só é preenchido quando `isCurrentCompetence(year,
    month, now, timeZone)` é `true`. É a query certa para provar D6.
  */
  it('30/09 23:30 UTC: conta em Fortaleza ainda está em setembro — currentOpenPrior é preenchido', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T23:30:00.000Z')); // 20:30 em Fortaleza, ainda 30/09

    const budget = await buildService({
      debts: [{ amount: 50, dueDate: '2026-08-20' }], // vencido, mês anterior
      timeZone: 'America/Fortaleza',
    }).getBudget(USER_ID, 9, 2026);

    // Setembro (o mês pedido) ainda é o corrente para esta conta.
    expect(budget.debts.currentOpenPrior).toBe(50);

    vi.useRealTimers();
  });

  it('30/09 23:30 UTC: conta em Tokyo já está em outubro — currentOpenPrior fica ZERO para setembro', async () => {
    /*
      Mesmo instante do teste acima, mas para uma conta em Tóquio (UTC+9) já
      é 08:30 de 01/10 — outubro é o mês corrente para ELA, não setembro.
      `isCurrentCompetence(9, 2026, ...)` é `false` para essa conta, então a
      consulta de `currentOpenPrior` nem roda (fica `Promise.resolve([])`) —
      pedir o Orçamento de SETEMBRO para essa conta não traz mais o carry,
      porque setembro já não é "agora" para ela.
    */
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T23:30:00.000Z'));

    const budget = await buildService({
      debts: [{ amount: 50, dueDate: '2026-08-20' }],
      timeZone: 'Asia/Tokyo',
    }).getBudget(USER_ID, 9, 2026);

    expect(budget.debts.currentOpenPrior).toBe(0);

    vi.useRealTimers();
  });
});
