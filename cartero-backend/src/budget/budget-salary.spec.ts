import { describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';
import { routeDebtQuery } from 'src/common/testing/debt-query-double';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O Orçamento usa a renda DO PERÍODO (Fase 9A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O bug que esta fase fecha: o Orçamento lia `User.salary` — o valor ATUAL —
 * para calcular qualquer mês. Registrar um aumento em agosto reescrevia a
 * sobra e o percentual comprometido de janeiro, um mês já encerrado.
 *
 * O teste central é o de regressão retroativa: recalcular janeiro depois de o
 * salário mudar deve devolver o mesmo número de antes.
 */

interface Entry {
  year: number;
  month: number;
  amount: number;
}

/**
 * Prisma com histórico de renda real e um conjunto financeiro FIXO.
 *
 * As despesas são as mesmas em todos os meses de propósito: assim qualquer
 * diferença entre janeiro e agosto vem da renda, que é a única variável em
 * teste.
 */
function buildPrisma(history: Entry[], debtAmount = 1000) {
  const prisma: any = {
    salaryHistory: {
      findFirst: vi.fn(async ({ where }: any) => {
        const target = where.OR[1];
        const winner = history
          .filter(
            (entry) =>
              entry.year < target.year ||
              (entry.year === target.year && entry.month <= target.month.lte),
          )
          .sort((a, b) => b.year - a.year || b.month - a.month)[0];

        return winner
          ? {
              amount: money(winner.amount),
              year: winner.year,
              month: winner.month,
            }
          : null;
      }),
      upsert: vi.fn(),
    },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    /*
      Responde por filtro: a mesma dívida não pode entrar como "do mês" E como
      "pendência anterior", senão a despesa dobraria.

      Aqui só existe dívida do mês — o carry-over tem testes próprios.
    */
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        /*
          O vencimento acompanha a competência consultada: estes testes medem
          a RENDA, e uma dívida fora do mês sumiria do total por um motivo
          alheio ao que eles protegem.
        */
        /*
          Sem `gte` a consulta é a de pendências ANTERIORES, fora do escopo
          deste arquivo — devolver a dívida ali a contaria uma segunda vez no
          mês corrente, como `currentOpenPrior`.
        */
        if (!where?.dueDate?.gte) return [];

        const dueDate = new Date(
          where.dueDate.gte.getTime() + 9 * 24 * 3600 * 1000,
        );

        return routeDebtQuery(where, [
          {
            amount: money(debtAmount),
            isPaid: false,
            paidAt: null,
            title: 'Aluguel',
            dueDate,
            personId: null,
            person: null,
          },
        ]);
      }),
    },
    receivable: { findMany: vi.fn(async () => []) },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

describe('Cada mês usa a renda vigente naquele mês', () => {
  const HISTORICO = [
    { year: 2026, month: 1, amount: 4000 },
    { year: 2026, month: 8, amount: 5000 },
  ];

  it('janeiro usa 4000', async () => {
    const service = buildPrisma(HISTORICO);

    const budget = await service.getBudget(USER_ID, 1, 2026);

    expect(budget.salary).toBe(4000);
    expect(budget.salaryKnown).toBe(true);
    expect(budget.salaryEffectiveFrom).toEqual({ year: 2026, month: 1 });
  });

  it('agosto usa 5000', async () => {
    const service = buildPrisma(HISTORICO);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.salary).toBe(5000);
    expect(budget.salaryEffectiveFrom).toEqual({ year: 2026, month: 8 });
  });

  it('abril herda 4000 de janeiro', async () => {
    const service = buildPrisma(HISTORICO);

    const budget = await service.getBudget(USER_ID, 4, 2026);

    expect(budget.salary).toBe(4000);
    // A entrada aplicável é a de janeiro, e o contrato diz de onde veio.
    expect(budget.salaryEffectiveFrom).toEqual({ year: 2026, month: 1 });
  });

  it('a sobra reflete a renda do período', async () => {
    const service = buildPrisma(HISTORICO, 1000);

    const [janeiro, agosto] = await Promise.all([
      service.getBudget(USER_ID, 1, 2026),
      service.getBudget(USER_ID, 8, 2026),
    ]);

    // Mesma despesa (1000), rendas diferentes.
    expect(janeiro.remaining).toBe(3000);
    expect(agosto.remaining).toBe(4000);
  });

  it('o percentual comprometido reflete a renda do período', async () => {
    const service = buildPrisma(HISTORICO, 1000);

    const [janeiro, agosto] = await Promise.all([
      service.getBudget(USER_ID, 1, 2026),
      service.getBudget(USER_ID, 8, 2026),
    ]);

    expect(janeiro.committedPct).toBeCloseTo(25, 6); // 1000 / 4000
    expect(agosto.committedPct).toBeCloseTo(20, 6); // 1000 / 5000
  });
});

describe('Regressão retroativa — o teste central da fase', () => {
  it('registrar aumento em agosto NÃO muda janeiro', async () => {
    /**
     * Exatamente o bug anterior.
     *
     * Com `User.salary` como fonte, alterar a renda para 6000 fazia janeiro
     * recalcular com 6000 — a sobra de um mês encerrado mudava sozinha, sem
     * nenhum fato novo sobre janeiro.
     *
     * Aqui o histórico ganha uma entrada em agosto e janeiro permanece
     * intocado, porque a entrada de janeiro continua sendo a aplicável a ele.
     */
    const historico = [
      { year: 2026, month: 1, amount: 4000 },
      { year: 2026, month: 8, amount: 5000 },
    ];
    const service = buildPrisma(historico, 1000);

    const janeiroAntes = await service.getBudget(USER_ID, 1, 2026);
    expect(janeiroAntes.remaining).toBe(3000);

    // Em agosto, a renda sobe para 6000.
    historico.push({ year: 2026, month: 9, amount: 6000 });

    const janeiroDepois = await service.getBudget(USER_ID, 1, 2026);

    expect(janeiroDepois.salary).toBe(4000);
    expect(janeiroDepois.remaining).toBe(3000);
    expect(janeiroDepois.committedPct).toBeCloseTo(25, 6);
  });

  it('e o mês novo enxerga o valor novo', async () => {
    // A contraprova: o histórico não congela o futuro.
    const historico = [
      { year: 2026, month: 1, amount: 4000 },
      { year: 2026, month: 9, amount: 6000 },
    ];
    const service = buildPrisma(historico, 1000);

    const setembro = await service.getBudget(USER_ID, 9, 2026);

    expect(setembro.salary).toBe(6000);
    expect(setembro.remaining).toBe(5000);
  });
});

describe('Renda desconhecida', () => {
  const SO_AGOSTO = [{ year: 2026, month: 8, amount: 5000 }];

  it('mês anterior à primeira entrada: known = false', async () => {
    const service = buildPrisma(SO_AGOSTO);

    const budget = await service.getBudget(USER_ID, 7, 2026);

    expect(budget.salaryKnown).toBe(false);
    expect(budget.salary).toBeNull();
    expect(budget.salaryEffectiveFrom).toBeNull();
  });

  it('sobra e percentual são null, não zero', async () => {
    /**
     * Calcular `0 - totalToPay` afirmaria uma capacidade financeira que
     * ninguém informou, e a tela mostraria uma sobra negativa inventada.
     */
    const service = buildPrisma(SO_AGOSTO);

    const budget = await service.getBudget(USER_ID, 7, 2026);

    expect(budget.remaining).toBeNull();
    expect(budget.committedPct).toBeNull();
  });

  it('as despesas continuam sendo calculadas', async () => {
    // Item 40: não saber a renda não impede saber quanto se deve.
    const service = buildPrisma(SO_AGOSTO, 1000);

    const budget = await service.getBudget(USER_ID, 7, 2026);

    expect(budget.totalToPay).toBe(1000);
    expect(budget.debtsCount).toBe(1);
  });

  it('sem nenhuma entrada, todo mês é desconhecido', async () => {
    const service = buildPrisma([]);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.salaryKnown).toBe(false);
    expect(budget.remaining).toBeNull();
  });
});

describe('Renda conhecida e igual a zero', () => {
  const ZERO = [{ year: 2026, month: 8, amount: 0 }];

  it('known = true, amount = 0', async () => {
    // Diferente de desconhecido: alguém entre empregos tem renda zero.
    const service = buildPrisma(ZERO);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.salaryKnown).toBe(true);
    expect(budget.salary).toBe(0);
  });

  it('a sobra é negativa, não null', async () => {
    const service = buildPrisma(ZERO, 1000);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    // 0 - 1000: sabemos a renda, então a conta é possível.
    expect(budget.remaining).toBe(-1000);
  });

  it('o percentual é null — sem Infinity nem NaN', async () => {
    /**
     * Não existe "percentual de zero". Dividir daria Infinity, e devolver 0%
     * ou 100% seria uma aproximação inventada que a tela exibiria como fato.
     */
    const service = buildPrisma(ZERO, 1000);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.committedPct).toBeNull();
    expect(Number.isFinite(budget.remaining!)).toBe(true);
  });
});
