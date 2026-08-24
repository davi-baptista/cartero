import { describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A qualidade de `paidAt` decide o histórico do Budget
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A regra de `priorCarry` NÃO muda e não deve mudar: uma dívida vencida antes
 * do mês entra no carry quando ainda estava aberta ao início dele —
 * `paidAt == null OR paidAt >= monthStart`.
 *
 * O que estava errado era o DADO. Regularizar em agosto um pagamento feito em
 * dezembro gravava `paidAt = agosto`, e a mesma obrigação reaparecia como
 * pendência anterior em janeiro, fevereiro, março… até agosto.
 *
 * Estes testes fixam a consequência: corrigir `paidAt` corrige o histórico,
 * sem tocar em nenhuma fórmula.
 */

/** Dívida vencida em 08/12/2025, com a data de quitação que o teste escolher. */
function buildService(paidAt: Date | null) {
  const divida = {
    amount: money(930),
    isPaid: paidAt !== null,
    paidAt,
    title: 'Dívida da regularização',
    dueDate: new Date(Date.UTC(2025, 11, 8, 12)),
    personId: null,
    person: null,
  };

  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    debt: {
      /*
        Duplo que aplica o `where` de verdade — inclusive o `OR` de `paidAt`.
        Devolver a linha sempre faria o teste passar com a regra removida.
      */
      findMany: vi.fn(async ({ where }: any) => {
        const isPrior = where?.dueDate?.lt && !where?.dueDate?.gte;

        if (!isPrior) {
          // Janela do MÊS: a dívida entra se vence dentro dele.
          const dentroDoMes =
            where?.dueDate?.gte &&
            divida.dueDate >= where.dueDate.gte &&
            divida.dueDate < where.dueDate.lt;
          if (!dentroDoMes) return [];
          if (where.isPaid !== undefined && where.isPaid !== divida.isPaid) {
            return [];
          }
          return [divida];
        }

        const venceuAntes = divida.dueDate < where.dueDate.lt;
        if (!venceuAntes) return [];

        if (where.OR) {
          const abertaNoInicio = where.OR.some((clause: any) => {
            if ('paidAt' in clause && clause.paidAt === null) {
              return divida.paidAt === null;
            }
            if (clause.paidAt?.gte) {
              return (
                divida.paidAt != null && divida.paidAt >= clause.paidAt.gte
              );
            }
            return false;
          });
          if (!abertaNoInicio) return [];
        }

        if (where.isPaid !== undefined && where.isPaid !== divida.isPaid) {
          return [];
        }

        return [divida];
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

describe('item 58: paidAt no mesmo mês do vencimento', () => {
  /** Vence 08/12/2025, paga 20/12/2025 — resolvida dentro do próprio mês. */
  const PAGA_EM_DEZEMBRO = new Date(Date.UTC(2025, 11, 20, 12));

  it('janeiro não carrega a dívida', async () => {
    const budget = await buildService(PAGA_EM_DEZEMBRO).getBudget(
      USER_ID,
      1,
      2026,
    );

    expect(budget.debts.priorCarry).toBe(0);
    expect(budget.totalToPay).toBe(0);
  });

  it('nem fevereiro, nem março', async () => {
    for (const mes of [2, 3]) {
      const budget = await buildService(PAGA_EM_DEZEMBRO).getBudget(
        USER_ID,
        mes,
        2026,
      );
      expect(budget.debts.priorCarry).toBe(0);
    }
  });
});

describe('item 33: paidAt dois meses depois', () => {
  /** Vence 08/12/2025, paga 15/02/2026. */
  const PAGA_EM_FEVEREIRO = new Date(Date.UTC(2026, 1, 15, 12));

  it('janeiro carrega: ainda estava aberta ao entrar no mês', async () => {
    const budget = await buildService(PAGA_EM_FEVEREIRO).getBudget(
      USER_ID,
      1,
      2026,
    );

    expect(budget.debts.priorCarry).toBe(930);
  });

  it('fevereiro carrega: estava aberta no dia 1º', async () => {
    /*
      Paga no dia 15 — no início do mês a obrigação existia. A fotografia
      histórica do mês a inclui, e isso é a regra consolidada.
    */
    const budget = await buildService(PAGA_EM_FEVEREIRO).getBudget(
      USER_ID,
      2,
      2026,
    );

    expect(budget.debts.priorCarry).toBe(930);
  });

  it('março NÃO carrega: já estava resolvida', async () => {
    const budget = await buildService(PAGA_EM_FEVEREIRO).getBudget(
      USER_ID,
      3,
      2026,
    );

    expect(budget.debts.priorCarry).toBe(0);
  });
});

describe('item 59: corrigir paidAt corrige o histórico', () => {
  /**
   * O bug relatado, ponta a ponta.
   *
   * Nenhuma fórmula muda entre os dois cenários — só o dado.
   */
  const REGISTRADA_EM_AGOSTO = new Date(Date.UTC(2026, 7, 24, 12));
  const REAL_EM_DEZEMBRO = new Date(Date.UTC(2025, 11, 20, 12));

  it('antes da correção: março mostra a dívida como carry', async () => {
    const budget = await buildService(REGISTRADA_EM_AGOSTO).getBudget(
      USER_ID,
      3,
      2026,
    );

    expect(budget.debts.priorCarry).toBe(930);
    expect(budget.totalToPay).toBe(930);
  });

  it('depois da correção: março deixa de mostrá-la', async () => {
    const budget = await buildService(REAL_EM_DEZEMBRO).getBudget(
      USER_ID,
      3,
      2026,
    );

    expect(budget.debts.priorCarry).toBe(0);
    expect(budget.totalToPay).toBe(0);
  });

  it('o mês do vencimento continua reconhecendo a obrigação', async () => {
    /*
      Corrigir a data não apaga a dívida de dezembro: ela pertenceu àquele mês
      e continua pertencendo. O que muda é ela parar de vazar para os meses
      seguintes.
    */
    const budget = await buildService(REAL_EM_DEZEMBRO).getBudget(
      USER_ID,
      12,
      2025,
    );

    expect(budget.debts.dueInMonth).toBe(930);
  });
});

describe('item 31: a regra de priorCarry permanece intacta', () => {
  it('dívida nunca paga continua carregando indefinidamente', async () => {
    // `paidAt: null` é o caso em aberto — nada nesta tarefa o alterou.
    for (const mes of [1, 3, 8]) {
      const budget = await buildService(null).getBudget(USER_ID, mes, 2026);
      expect(budget.debts.priorCarry).toBe(930);
    }
  });
});
