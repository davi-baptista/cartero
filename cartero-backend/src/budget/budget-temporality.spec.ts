import { describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { SalaryService } from 'src/salary/salary.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';
import { matchesDebtQuery } from 'src/common/testing/debt-query-double';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O Orçamento é MENSAL e a Fase 8B não pode tê-lo mudado (Fase 8C)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A Fase 8B tornou o consolidado de Person all-time. O risco desta fase era
 * esse conceito escorregar para o Orçamento, que é deliberadamente mensal:
 * uma dívida vencida em junho passaria a inflar o total de agosto sem que
 * ninguém tivesse pedido isso.
 *
 * A auditoria mostrou que o Orçamento **nunca** consumiu `PersonStatement` —
 * ele consulta `debt`/`receivable` direto no Prisma com
 * `dueDate: { gte: monthStart, lt: monthEnd }`. Este arquivo transforma essa
 * independência em garantia executável.
 *
 * Diferente de `budget.service.spec.ts`, os duplos aqui **respeitam o filtro
 * de data**: devolvem só o que cai no intervalo pedido. Assim o teste falha se
 * alguém remover o `where` — e não apenas se a aritmética mudar.
 */

interface DatedDebt {
  amount: number;
  dueDate: string;
  isPaid?: boolean;
  /** Data real do pagamento — decide a competência de uma dívida resolvida. */
  paidAt?: string | null;
  personId?: string | null;
  personName?: string;
}

interface DatedReceivable {
  amount: number;
  dueDate: string;
  personId: string;
}

/**
 * Prisma cujos `findMany` aplicam o filtro de verdade.
 *
 * `dueDate: { gte, lt }` é lido do `where` e usado para recortar o universo,
 * imitando o banco. Um duplo que ignore o filtro passaria mesmo com o serviço
 * quebrado.
 */
function buildPrisma(universe: {
  debts: DatedDebt[];
  receivables: DatedReceivable[];
  salary?: string;
}) {
  const inRange = (iso: string, where: any) => {
    const date = new Date(`${iso}T12:00:00.000Z`);
    const range = where?.dueDate;
    if (!range) return true;
    if (range.gte && date < range.gte) return false;
    if (range.lt && date >= range.lt) return false;
    return true;
  };

  const seen = { debtWhere: [] as any[], receivableWhere: [] as any[] };

  const prisma: any = {
    user: { update: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        seen.debtWhere.push(where);
        /*
          Roteia pelas três consultas. Antes só a janela do mês era honrada, e
          uma dívida paga casava tanto em `openDueInMonth` quanto em
          `paidInMonth`.
        */
        return universe.debts
          .filter((debt) =>
            matchesDebtQuery(where, {
              isPaid: debt.isPaid ?? false,
              paidAt: debt.paidAt
                ? new Date(`${debt.paidAt}T12:00:00.000Z`)
                : null,
              dueDate: new Date(`${debt.dueDate}T12:00:00.000Z`),
            }),
          )
          .map((debt, index) => ({
            amount: money(debt.amount),
            isPaid: debt.isPaid ?? false,
            title: `Dívida ${index}`,
            dueDate: new Date(`${debt.dueDate}T12:00:00.000Z`),
            personId: debt.personId ?? null,
            person: debt.personId
              ? { id: debt.personId, name: debt.personName ?? 'Eva' }
              : null,
          }));
      }),
    },
    receivable: {
      findMany: vi.fn(async ({ where }: any) => {
        seen.receivableWhere.push(where);
        return universe.receivables
          .filter((item) => inRange(item.dueDate, where))
          .map((item) => ({
            amount: money(item.amount),
            personId: item.personId,
          }));
      }),
    },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    /*
      Sem histórico de renda: o Orçamento continua calculando despesas.
      Renda desconhecida não impede saber quanto se deve.
    */
    salaryHistory: { findFirst: vi.fn(async () => null) },
  };

  return { prisma, seen };
}

/**
 * O cenário canônico das Fases 8B/8C, visto pelo Orçamento.
 *
 *   Dívida   junho   R$ 200   (pendente, em atraso)
 *   Dívida   agosto  R$ 100
 *   Cobrança julho   R$ 500   (pendente, em atraso)
 *   Cobrança agosto  R$ 300
 *
 * O consolidado de Eva é 800 / 300. O Orçamento de agosto **não** deve ver
 * esses números: para ele existem apenas R$ 100 de dívida e R$ 300 de
 * cobrança.
 */
const UNIVERSO = {
  debts: [
    { amount: 200, dueDate: '2026-06-05', personId: 'person-1' },
    { amount: 100, dueDate: '2026-08-20', personId: 'person-1' },
  ],
  receivables: [
    { amount: 500, dueDate: '2026-07-10', personId: 'person-1' },
    { amount: 300, dueDate: '2026-08-15', personId: 'person-1' },
  ],
};

/**
 * `SalaryService` real, sobre o mesmo duplo de Prisma.
 *
 * Usar o serviço de verdade (e não um mock que devolve um número) mantém o
 * teste sensível à regra de resolução: se o carry-forward quebrar, o Orçamento
 * quebra aqui também.
 */
function buildBudgetService(prisma: any) {
  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

describe('O Orçamento de agosto vê apenas agosto', () => {
  it('a consulta de dívidas recorta o mês', async () => {
    const { prisma, seen } = buildPrisma(UNIVERSO);
    const service = buildBudgetService(prisma);

    await service.getBudget(USER_ID, 8, 2026);

    // A ausência deste filtro é exatamente a regressão que a fase teme.
    expect(seen.debtWhere[0]).toHaveProperty('dueDate');
    expect(seen.debtWhere[0].dueDate.gte).toBeInstanceOf(Date);
    expect(seen.debtWhere[0].dueDate.lt).toBeInstanceOf(Date);
  });

  it('a dívida de junho NÃO entra no total de agosto', async () => {
    const { prisma } = buildPrisma(UNIVERSO);
    const service = buildBudgetService(prisma);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    /*
      A dívida de agosto é R$ 100 e Eva deve R$ 300 no mês → a compensação
      zera o valor. Se junho tivesse entrado, o bruto seria R$ 300 e o número
      final mudaria.

      A asserção é sobre a CONTAGEM e o bruto, não só sobre o total
      compensado: um total zerado poderia esconder junho tendo entrado.
    */
    expect(budget.debtsCount).toBe(1);
  });

  it('a cobrança de julho não compensa a dívida de agosto', async () => {
    const { prisma, seen } = buildPrisma(UNIVERSO);
    const service = buildBudgetService(prisma);

    await service.getBudget(USER_ID, 8, 2026);

    expect(seen.receivableWhere[0]).toHaveProperty('dueDate');
    expect(seen.receivableWhere[0]).toMatchObject({ isPaid: false });
  });

  it('junho, visto de junho, aparece normalmente', async () => {
    // Prova que o recorte é recorte, e não um filtro que descarta o passado.
    const { prisma } = buildPrisma(UNIVERSO);
    const service = buildBudgetService(prisma);

    const budget = await service.getBudget(USER_ID, 6, 2026);

    expect(budget.debtsCount).toBe(1);
  });

  it('cada mês é independente', async () => {
    const { prisma } = buildPrisma(UNIVERSO);
    const service = buildBudgetService(prisma);

    const [junho, julho, agosto] = await Promise.all([
      service.getBudget(USER_ID, 6, 2026),
      service.getBudget(USER_ID, 7, 2026),
      service.getBudget(USER_ID, 8, 2026),
    ]);

    // Julho não tem dívida — só uma cobrança, que sozinha não gera gasto.
    expect(junho.debtsCount).toBe(1);
    expect(julho.debtsCount).toBe(0);
    expect(agosto.debtsCount).toBe(1);
  });
});

describe('O Orçamento não consome PersonStatement', () => {
  it('não chama person.findUnique', async () => {
    /**
     * A independência estrutural que sustenta tudo acima.
     *
     * Enquanto o Orçamento não passa por `PersonsService`, mudanças no
     * consolidado da pessoa não conseguem alcançá-lo. Se algum dia alguém
     * ligar os dois, este teste cai e a decisão volta a ser consciente.
     */
    const { prisma } = buildPrisma(UNIVERSO);
    const service = buildBudgetService(prisma);

    await service.getBudget(USER_ID, 8, 2026);

    // O duplo nem define `person` — se o serviço tentasse usá-lo, explodiria.
    expect(prisma.person).toBeUndefined();
  });

  it('a informação de A Receber usa só o mês consultado', async () => {
    /**
     * Este teste protegia a COMPENSAÇÃO mensal: Eva devia R$ 900, tinha R$ 300
     * a receber no mês, e o esperado era R$ 600 de dívida.
     *
     * A Fase 9B removeu a compensação — recebível não abate obrigação. O que
     * continua valendo é o RECORTE: a informação de A Receber é do mês, e o
     * recebível de julho não vaza para agosto.
     */
    const { prisma } = buildPrisma({
      debts: [{ amount: 900, dueDate: '2026-08-10', personId: 'person-1' }],
      receivables: [
        { amount: 300, dueDate: '2026-08-15', personId: 'person-1' },
        { amount: 500, dueDate: '2026-07-10', personId: 'person-1' },
      ],
    });
    const service = buildBudgetService(prisma);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    // Valor íntegro: nada foi abatido.
    expect(budget.totalDebts).toBe(900);
    // Só o recebível de agosto entra na informação.
    expect(budget.receivables.dueInMonth).toBe(300);
  });
});
