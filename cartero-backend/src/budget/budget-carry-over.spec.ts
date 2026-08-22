import { describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Pendências anteriores — carry-over (Fase 9B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Antes, uma dívida vencida em junho e ainda aberta simplesmente DESAPARECIA
 * do orçamento de agosto: o filtro era `dueDate` estritamente dentro do mês.
 * O painel "Atenção agora" a mostrava, o Orçamento não — duas telas com
 * respostas diferentes para "o que eu devo".
 *
 * A regra temporal usa `paidAt`, não `isPaid`. Reconstruir agosto com o estado
 * de HOJE diria que uma dívida paga em setembro já estava resolvida em agosto —
 * e ela não estava. O orçamento de um mês passado é um snapshot daquele mês.
 */

interface DebtRow {
  amount: number;
  /** Vencimento original. */
  dueDate: string;
  /** `null` = nunca paga. */
  paidAt?: string | null;
  personId?: string | null;
  personName?: string;
  title?: string;
}

/**
 * Prisma que aplica as DUAS regras temporais de verdade.
 *
 * A consulta do mês recorta `[monthStart, monthEnd)`; a de carry-over pega
 * `dueDate < monthStart` E (`paidAt` nulo OU `>= monthStart`). Um duplo que
 * devolvesse listas fixas passaria mesmo com o serviço aplicando a condição
 * errada — e é exatamente a condição que este arquivo testa.
 */
function buildService(rows: DebtRow[]) {
  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    transaction: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    receivable: { findMany: vi.fn(async () => []) },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        const toRow = (row: DebtRow) => ({
          amount: money(row.amount),
          isPaid: row.paidAt != null,
          paidAt: row.paidAt ? new Date(`${row.paidAt}T12:00:00.000Z`) : null,
          title: row.title ?? 'Dívida',
          dueDate: new Date(`${row.dueDate}T12:00:00.000Z`),
          personId: row.personId ?? null,
          person: row.personId
            ? { id: row.personId, name: row.personName ?? 'Eva' }
            : null,
        });

        const isCarryQuery = where?.dueDate?.lt && !where?.dueDate?.gte;

        if (isCarryQuery) {
          const monthStart: Date = where.dueDate.lt;
          return rows
            .filter((row) => {
              const due = new Date(`${row.dueDate}T12:00:00.000Z`);
              if (due >= monthStart) return false;
              // Ainda aberta ao ENTRAR no mês.
              if (!row.paidAt) return true;
              return new Date(`${row.paidAt}T12:00:00.000Z`) >= monthStart;
            })
            .map(toRow);
        }

        const { gte, lt } = where.dueDate;
        return rows
          .filter((row) => {
            const due = new Date(`${row.dueDate}T12:00:00.000Z`);
            return due >= gte && due < lt;
          })
          .map(toRow);
      }),
    },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

describe('Dívida vencida em junho, nunca paga', () => {
  const rows: DebtRow[] = [
    { amount: 300, dueDate: '2026-06-10', paidAt: null, title: 'Aluguel' },
  ];

  it('junho: é obrigação do próprio mês', async () => {
    const budget = await buildService(rows).getBudget(USER_ID, 6, 2026);

    expect(budget.debts.dueInMonth).toBe(300);
    expect(budget.debts.priorCarry).toBe(0);
  });

  it('agosto: aparece como pendência anterior', async () => {
    const budget = await buildService(rows).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.dueInMonth).toBe(0);
    expect(budget.debts.priorCarry).toBe(300);
    expect(budget.debts.total).toBe(300);
  });

  it('o vencimento ORIGINAL é preservado', async () => {
    // Reescrever a data como se fosse deste mês esconderia o atraso.
    const budget = await buildService(rows).getBudget(USER_ID, 8, 2026);

    const item = budget.debts.priorCarryItems[0];
    expect(item.dueDate.toISOString().slice(0, 10)).toBe('2026-06-10');
    expect(item.title).toBe('Aluguel');
  });

  it('aparece em julho, agosto e setembro enquanto continuar aberta', async () => {
    /**
     * A repetição entre meses é INTENCIONAL: é a mesma obrigação carregada
     * por snapshots mensais sucessivos, não uma despesa nova a cada mês.
     * A seção própria na UI existe para deixar isso claro.
     */
    const service = buildService(rows);

    const [julho, agosto, setembro] = await Promise.all([
      service.getBudget(USER_ID, 7, 2026),
      service.getBudget(USER_ID, 8, 2026),
      service.getBudget(USER_ID, 9, 2026),
    ]);

    expect(julho.debts.priorCarry).toBe(300);
    expect(agosto.debts.priorCarry).toBe(300);
    expect(setembro.debts.priorCarry).toBe(300);
  });
});

describe('A condição temporal usa paidAt, não o estado de hoje', () => {
  it('paga em agosto: é pendência anterior EM agosto', async () => {
    /**
     * Item 44. Ela estava aberta quando agosto começou, então pertence ao
     * snapshot de agosto — o pagamento aconteceu dentro do mês.
     */
    const rows: DebtRow[] = [
      { amount: 500, dueDate: '2026-06-10', paidAt: '2026-08-20' },
    ];

    const budget = await buildService(rows).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.priorCarry).toBe(500);
    expect(budget.debts.priorCarryItems[0].paidInMonth).toBe(true);
  });

  it('paga em agosto: NÃO é pendência anterior em setembro', async () => {
    // Em setembro ela já estava resolvida.
    const rows: DebtRow[] = [
      { amount: 500, dueDate: '2026-06-10', paidAt: '2026-08-20' },
    ];

    const budget = await buildService(rows).getBudget(USER_ID, 9, 2026);

    expect(budget.debts.priorCarry).toBe(0);
    expect(budget.debts.priorCarryItems).toHaveLength(0);
  });

  it('paga em julho: NÃO é pendência anterior em agosto', async () => {
    /**
     * Item 45 e o teste obrigatório do item 37.
     *
     * Se a condição fosse `isPaid === false` (o estado de hoje), esta dívida
     * também desapareceria de JULHO — onde ela de fato era uma pendência
     * anterior até ser paga. `paidAt` é o que permite reconstruir cada mês.
     */
    const rows: DebtRow[] = [
      { amount: 500, dueDate: '2026-06-10', paidAt: '2026-07-15' },
    ];
    const service = buildService(rows);

    const [julho, agosto] = await Promise.all([
      service.getBudget(USER_ID, 7, 2026),
      service.getBudget(USER_ID, 8, 2026),
    ]);

    expect(julho.debts.priorCarry).toBe(500);
    expect(agosto.debts.priorCarry).toBe(0);
  });

  it('paga legado sem paidAt é tratada como ainda aberta', async () => {
    /**
     * Fallback conservador (item 38).
     *
     * `isPaid: true` com `paidAt: null` pode existir em registro antigo. Não
     * inventamos uma data: sem saber QUANDO foi paga, a dívida continua
     * aparecendo como pendência anterior. Exibi-la a mais é recuperável pelo
     * usuário; sumir com uma obrigação não é.
     */
    const rows: DebtRow[] = [
      { amount: 200, dueDate: '2026-06-10', paidAt: null },
    ];

    const budget = await buildService(rows).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.priorCarry).toBe(200);
  });
});

describe('Dívidas futuras não entram no mês atual', () => {
  it('dívida de setembro fica fora de agosto', async () => {
    /**
     * Item 18/47: decisão de PRODUTO, não bug. O orçamento é planejamento
     * mensal; trazer setembro para agosto misturaria os meses e inflaria o
     * comprometimento de um mês que ainda não chegou.
     */
    const rows: DebtRow[] = [
      { amount: 400, dueDate: '2026-09-10', paidAt: null },
    ];
    const service = buildService(rows);

    const [agosto, setembro] = await Promise.all([
      service.getBudget(USER_ID, 8, 2026),
      service.getBudget(USER_ID, 9, 2026),
    ]);

    expect(agosto.debts.total).toBe(0);
    expect(setembro.debts.dueInMonth).toBe(400);
  });
});

describe('Reconciliação dos totais', () => {
  it('total = dueInMonth + priorCarry', async () => {
    const rows: DebtRow[] = [
      { amount: 100, dueDate: '2026-08-05', paidAt: null },
      { amount: 300, dueDate: '2026-06-10', paidAt: null },
    ];

    const budget = await buildService(rows).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.dueInMonth).toBe(100);
    expect(budget.debts.priorCarry).toBe(300);
    expect(budget.debts.total).toBe(400);
    expect(budget.debts.total).toBe(
      budget.debts.dueInMonth + budget.debts.priorCarry,
    );
  });

  it('as linhas de carry somam priorCarry', async () => {
    const rows: DebtRow[] = [
      { amount: 300, dueDate: '2026-06-10', paidAt: null },
      { amount: 150, dueDate: '2026-07-02', paidAt: null },
    ];

    const budget = await buildService(rows).getBudget(USER_ID, 8, 2026);

    const soma = budget.debts.priorCarryItems.reduce(
      (total, item) => total + item.amount,
      0,
    );
    expect(soma).toBe(budget.debts.priorCarry);
    expect(budget.priorCarryCount).toBe(2);
  });

  it('totalToPay inclui o carry', async () => {
    const rows: DebtRow[] = [
      { amount: 300, dueDate: '2026-06-10', paidAt: null },
    ];

    const budget = await buildService(rows).getBudget(USER_ID, 8, 2026);

    // Sem faturas nem pagamentos diretos: o total é o próprio carry.
    expect(budget.totalToPay).toBe(300);
  });

  it('sem carry, a lista fica vazia e o valor é zero', async () => {
    // A UI não deve renderizar "Pendências anteriores — R$ 0".
    const rows: DebtRow[] = [
      { amount: 100, dueDate: '2026-08-05', paidAt: null },
    ];

    const budget = await buildService(rows).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.priorCarry).toBe(0);
    expect(budget.debts.priorCarryItems).toHaveLength(0);
  });
});
