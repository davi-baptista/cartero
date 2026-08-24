import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Pendências anteriores — eventos, não snapshot mensal
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A regra anterior perguntava "isto ainda estava aberto quando o mês
 * começou?", e repetia a MESMA obrigação em toda competência entre o
 * vencimento e o pagamento: uma dívida de 08/12 paga em 24/08 aparecia em
 * dezembro, janeiro, fevereiro… até agosto.
 *
 * Defensável como fotografia histórica, mas na tela parecia que a mesma dívida
 * estava sendo cobrada de novo a cada mês.
 *
 * Agora o orçamento reconhece dois EVENTOS:
 *
 *   · `currentOpenPrior`  — ainda aberta, SÓ no mês civil corrente
 *   · `priorPaidInMonth`  — o pagamento aconteceu NESTA competência
 *
 * Os meses intermediários, onde nada aconteceu, não repetem mais nada.
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

/** 24/08/2026, meio-dia em Fortaleza — o "hoje" de todos os testes. */
const HOJE = new Date(Date.UTC(2026, 7, 24, 15));

/**
 * Prisma que aplica as TRÊS regras temporais de verdade.
 *
 * Um duplo que devolvesse listas fixas passaria mesmo com o serviço aplicando
 * a condição errada — e é exatamente a condição que este arquivo testa.
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
            ? { id: row.personId, name: row.personName ?? 'Pessoa' }
            : null,
        });

        return rows.map(toRow).filter((row) => {
          // A. Dívidas do próprio mês.
          if (where.dueDate?.gte && where.dueDate?.lt) {
            return (
              row.dueDate >= where.dueDate.gte && row.dueDate < where.dueDate.lt
            );
          }

          if (!where.dueDate?.lt) return false;
          if (row.dueDate >= where.dueDate.lt) return false;

          // B. Anteriores ainda abertas.
          if (where.isPaid === false) return !row.isPaid;

          // C. Anteriores pagas dentro da janela do mês.
          if (where.paidAt?.gte && where.paidAt?.lt) {
            return (
              row.paidAt != null &&
              row.paidAt >= where.paidAt.gte &&
              row.paidAt < where.paidAt.lt
            );
          }

          return false;
        });
      }),
    },
  };

  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

describe('item 41: dezembro → agosto, sem repetir no meio', () => {
  /** R$ 300, vence 08/12/2025, paga em 24/08/2026. */
  const CENARIO: DebtRow[] = [
    { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('dezembro: a obrigação pertence ao próprio mês', async () => {
    const budget = await buildService(CENARIO).getBudget(USER_ID, 12, 2025);

    expect(budget.debts.dueInMonth).toBe(300);
    expect(budget.debts.total).toBe(300);
  });

  it.each([
    ['janeiro', 1, 2026],
    ['fevereiro', 2, 2026],
    ['março', 3, 2026],
    ['julho', 7, 2026],
  ])('%s NÃO repete a dívida de dezembro', async (_nome, mes, ano) => {
    const budget = await buildService(CENARIO).getBudget(USER_ID, mes, ano);

    expect(budget.debts.total).toBe(0);
    expect(budget.debts.currentOpenPrior).toBe(0);
    expect(budget.debts.priorPaidInMonth).toBe(0);
    expect(budget.totalToPay).toBe(0);
  });

  it('agosto: reconhece o desembolso, porque foi pago aqui', async () => {
    const budget = await buildService(CENARIO).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.priorPaidInMonth).toBe(300);
    expect(budget.debts.currentOpenPrior).toBe(0);
    expect(budget.debts.total).toBe(300);
  });

  it('setembro (futuro) não projeta nada', async () => {
    const budget = await buildService(CENARIO).getBudget(USER_ID, 9, 2026);

    expect(budget.debts.total).toBe(0);
  });
});

describe('item 42: dívida antiga ainda ABERTA', () => {
  const ABERTA: DebtRow[] = [{ amount: 300, dueDate: '2025-12-08' }];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('dezembro: obrigação do próprio mês', async () => {
    const budget = await buildService(ABERTA).getBudget(USER_ID, 12, 2025);
    expect(budget.debts.dueInMonth).toBe(300);
  });

  it.each([
    ['janeiro', 1],
    ['março', 3],
    ['julho', 7],
  ])('%s histórico não repete', async (_nome, mes) => {
    const budget = await buildService(ABERTA).getBudget(USER_ID, mes, 2026);
    expect(budget.debts.total).toBe(0);
  });

  it('agosto (mês CORRENTE): aparece como pendência em aberto', async () => {
    /*
      O único caso em que dívida antiga aberta é carregada: ela precisa ser
      resolvida AGORA, e o orçamento do mês corrente é planejamento.
    */
    const budget = await buildService(ABERTA).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.currentOpenPrior).toBe(300);
    expect(budget.debts.priorPaidInMonth).toBe(0);
    expect(budget.totalToPay).toBe(300);
  });

  it('item 53: setembro futuro não projeta o atraso', async () => {
    const budget = await buildService(ABERTA).getBudget(USER_ID, 9, 2026);
    expect(budget.debts.total).toBe(0);
  });
});

describe('item 54: o carry acompanha o PRESENTE', () => {
  const ABERTA: DebtRow[] = [{ amount: 300, dueDate: '2025-12-08' }];

  afterEach(() => vi.useRealTimers());

  it('em agosto aparece em agosto; em setembro migra para setembro', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
    const agostoCorrente = await buildService(ABERTA).getBudget(
      USER_ID,
      8,
      2026,
    );
    expect(agostoCorrente.debts.currentOpenPrior).toBe(300);

    // O relógio avança: agosto vira histórico.
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 15, 15)));
    const agostoHistorico = await buildService(ABERTA).getBudget(
      USER_ID,
      8,
      2026,
    );
    const setembroCorrente = await buildService(ABERTA).getBudget(
      USER_ID,
      9,
      2026,
    );

    expect(agostoHistorico.debts.currentOpenPrior).toBe(0);
    expect(setembroCorrente.debts.currentOpenPrior).toBe(300);
  });
});

describe('item 43: transição open → paid no mês corrente', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('a contribuição de agosto é 300 antes E depois de pagar', async () => {
    /*
      A dívida muda de CATEGORIA, não de valor: o dinheiro sai em agosto de
      qualquer forma. Cair para zero ao quitar esconderia o desembolso.
    */
    const antes = await buildService([
      { amount: 300, dueDate: '2025-12-08' },
    ]).getBudget(USER_ID, 8, 2026);

    const depois = await buildService([
      { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
    ]).getBudget(USER_ID, 8, 2026);

    expect(antes.debts.total).toBe(300);
    expect(depois.debts.total).toBe(300);

    // Item 13: nunca as duas categorias ao mesmo tempo.
    expect(antes.debts.currentOpenPrior).toBe(300);
    expect(antes.debts.priorPaidInMonth).toBe(0);
    expect(depois.debts.currentOpenPrior).toBe(0);
    expect(depois.debts.priorPaidInMonth).toBe(300);
  });
});

describe('itens 7 e 45: paga no próprio mês do vencimento', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('conta UMA vez, como dívida do mês', async () => {
    const budget = await buildService([
      { amount: 300, dueDate: '2026-01-10', paidAt: '2026-01-20' },
    ]).getBudget(USER_ID, 1, 2026);

    expect(budget.debts.dueInMonth).toBe(300);
    // `priorPaidInMonth` exige dueMonth < paidMonth — aqui são o mesmo.
    expect(budget.debts.priorPaidInMonth).toBe(0);
    expect(budget.debts.total).toBe(300);
  });
});

describe('itens 20 e 46: legado pago sem data', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  /*
    `isPaid: true` com `paidAt: null`. Sabemos que foi resolvida, não quando.
    O duplo representa isso como uma linha sem `paidAt` mas já quitada — o
    serviço a exclui de todos os ramos, sem inventar mês de pagamento.
  */
  const LEGADO: DebtRow[] = [
    { amount: 300, dueDate: '2025-12-08', paidAt: null },
  ];

  it('aparece no mês do vencimento', async () => {
    const budget = await buildService(LEGADO).getBudget(USER_ID, 12, 2025);
    expect(budget.debts.dueInMonth).toBe(300);
  });

  it('não inventa mês de pagamento', async () => {
    for (const mes of [1, 3, 8]) {
      const budget = await buildService(LEGADO).getBudget(USER_ID, mes, 2026);
      expect(budget.debts.priorPaidInMonth).toBe(0);
    }
  });
});

describe('itens 51 e 52: os exemplos reais', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  const CENARIO: DebtRow[] = [
    // Dezembro: vence lá, paga só em agosto.
    { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
    // Janeiro: dívida própria do mês.
    { amount: 300, dueDate: '2026-01-15' },
  ];

  it('dezembro: 300 de dívida', async () => {
    const budget = await buildService(CENARIO).getBudget(USER_ID, 12, 2025);
    expect(budget.debts.total).toBe(300);
  });

  it('janeiro: 300, não 600', async () => {
    /*
      A dívida de dezembro NÃO reaparece em janeiro só porque continuava
      aberta. Era exatamente essa soma que inflava o mês.
    */
    const budget = await buildService(CENARIO).getBudget(USER_ID, 1, 2026);

    expect(budget.debts.total).toBe(300);
    expect(budget.debts.dueInMonth).toBe(300);
    expect(budget.debts.currentOpenPrior).toBe(0);
  });
});

describe('item 44: corrigir paidAt muda o mês do desembolso', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('antes: agosto reconhece; depois: dezembro fica com tudo', async () => {
    const registradoEmAgosto = await buildService([
      { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
    ]).getBudget(USER_ID, 8, 2026);

    const corrigidoParaDezembro = await buildService([
      { amount: 300, dueDate: '2025-12-08', paidAt: '2025-12-20' },
    ]).getBudget(USER_ID, 8, 2026);

    expect(registradoEmAgosto.debts.priorPaidInMonth).toBe(300);
    expect(corrigidoParaDezembro.debts.priorPaidInMonth).toBe(0);
  });
});

describe('item 18: várias pendências pagas no mesmo mês somam', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('dezembro + janeiro + fevereiro pagas em agosto = 930', async () => {
    /*
      Agosto fica alto, e isso é CORRETO para os dados armazenados: o dinheiro
      foi registrado como saindo ali. Se as datas estiverem erradas por
      regularização, o caminho é corrigir `paidAt`, não mascarar com regra.
    */
    const budget = await buildService([
      { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
      { amount: 300, dueDate: '2026-01-15', paidAt: '2026-08-24' },
      { amount: 330, dueDate: '2026-02-10', paidAt: '2026-08-24' },
    ]).getBudget(USER_ID, 8, 2026);

    expect(budget.debts.priorPaidInMonth).toBe(930);
  });
});

describe('o vencimento original é preservado', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
  });
  afterEach(() => vi.useRealTimers());

  it('os itens carregam a data real e o estado de quitação', async () => {
    const budget = await buildService([
      { amount: 300, dueDate: '2025-12-08', paidAt: '2026-08-24' },
    ]).getBudget(USER_ID, 8, 2026);

    const [item] = budget.debts.priorItems;
    expect(item.dueDate.toISOString()).toContain('2025-12-08');
    expect(item.paidInMonth).toBe(true);
  });
});
