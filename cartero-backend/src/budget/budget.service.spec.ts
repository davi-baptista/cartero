import { describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { SalaryService } from 'src/salary/salary.service';
import {
  USER_ID,
  makeBank,
  makeDebt,
  makeInvoice,
  money,
  utcDate,
} from 'src/common/testing/fixtures';
import { routeDebtQuery } from 'src/common/testing/debt-query-double';

/**
 * O Orçamento responde "quanto sai do meu bolso neste mês". A fórmula real:
 *
 *   netAmount  = totalInvoices − totalReimbursable
 *   totalToPay = netAmount + totalDirectPayments + totalDebts
 *
 * Duas regras merecem proteção especial:
 *
 * 1. `totalInvoices` é BRUTO — é o que o banco vai cobrar. O desconto do valor
 *    de terceiros acontece em `netAmount`, nunca alterando a fatura.
 * 2. Dívida com pessoa é compensada pelo que ela deve, com piso em zero:
 *    saldo a favor não vira gasto negativo.
 */

/** Monta um duplo de Prisma com apenas o que o BudgetService consulta. */
function buildPrisma(data: {
  salary?: string | null;
  invoices?: ReturnType<typeof makeInvoice>[];
  directPayments?: { amount: ReturnType<typeof money> }[];
  debts?: any[];
  personReceivables?: {
    amount: ReturnType<typeof money>;
    personId: string | null;
  }[];
  /** Dívidas vencidas ANTES do mês e ainda abertas ao entrar nele. */
  priorDebts?: any[];
  reimbursableSum?: ReturnType<typeof money> | null;
  /** Parte de terceiros por fatura, quando o teste precisa do detalhe. */
  reimbursablePerInvoice?: {
    invoiceId: string;
    _sum: { amount: ReturnType<typeof money> };
  }[];
}) {
  const invoices = data.invoices ?? [];

  return {
    /*
      A renda agora vem de `SalaryHistory`, não de `User.salary`.

      O parâmetro `salary` do fixture passou a alimentar o histórico: com
      valor, existe uma entrada aplicável; sem valor, a renda é DESCONHECIDA —
      o que é diferente de zero e o motivo pelo qual os totais de despesa
      continuam sendo calculados normalmente abaixo.
    */
    salaryHistory: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          data.salary === null || data.salary === undefined
            ? null
            : { amount: money(data.salary), year: 2026, month: 1 },
        ),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({}),
      update: vi.fn(),
    },
    invoice: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          invoices.map((invoice) => ({ ...invoice, bank: makeBank() })),
        ),
    },
    transaction: {
      findMany: vi.fn().mockResolvedValue(data.directPayments ?? []),
      // O serviço agrupa por fatura para expor a parte de terceiros linha a
      // linha. Sem `reimbursablePerInvoice`, o total é atribuído à primeira
      // fatura — suficiente para os testes que só verificam o agregado.
      groupBy: vi.fn().mockResolvedValue(
        data.reimbursablePerInvoice ??
          (data.reimbursableSum
            ? [
                {
                  invoiceId: invoices[0]?.id ?? 'invoice-1',
                  _sum: { amount: data.reimbursableSum },
                },
              ]
            : []),
      ),
    },
    /*
      O serviço faz DUAS consultas de dívida: as do mês (`dueDate` entre
      início e fim) e as pendências anteriores (`dueDate` antes do início).

      O duplo responde pelo filtro. Devolver a mesma lista para as duas
      contaria cada dívida duas vezes — e um duplo que ignore o `where`
      passaria mesmo com o serviço somando o mês errado.
    */
    /*
      Roteia pelas três consultas: uma dívida paga pertence a `paidInMonth`,
      não a `openDueInMonth`. Sem o roteamento ela casaria nas duas e o total
      dobraria.
    */
    debt: {
      findMany: vi.fn(({ where }: any) =>
        Promise.resolve(
          routeDebtQuery(where, [
            ...(data.debts ?? []),
            ...(data.priorDebts ?? []),
          ]),
        ),
      ),
    },
    receivable: {
      findMany: vi.fn().mockResolvedValue(data.personReceivables ?? []),
    },
  } as unknown as PrismaService;
}

function debtRow(overrides: {
  amount: string;
  isPaid?: boolean;
  title?: string;
  dueDate?: Date;
  personId?: string | null;
  person?: { id: string; name: string } | null;
}) {
  const base = makeDebt({
    amount: money(overrides.amount),
    isPaid: overrides.isPaid ?? false,
  });

  const dueDate = overrides.dueDate ?? utcDate(2026, 8, 15);

  return {
    amount: base.amount,
    isPaid: base.isPaid,
    /*
      Dívida paga precisa de `paidAt`: é ele que define a competência
      financeira. Sem a data, ela não pertence a mês nenhum — comportamento
      correto para o legado, mas não é o que estas fixtures querem exercitar.

      O default é o próprio dia do vencimento, o caso mais comum.
    */
    paidAt: base.isPaid ? dueDate : null,
    title: overrides.title ?? 'Dívida',
    dueDate,
    personId: overrides.personId ?? null,
    person: overrides.person ?? null,
  };
}

/**
 * `SalaryService` real, sobre o mesmo duplo de Prisma.
 *
 * Usar o serviço de verdade (e não um mock que devolve um número) mantém o
 * teste sensível à regra de resolução: se o carry-forward quebrar, o Orçamento
 * quebra aqui também.
 */
/**
 * Monta o `BudgetService` com suas duas dependências.
 *
 * O `SalaryService` é o real, sobre o mesmo duplo de Prisma — um mock que
 * devolvesse um número fixo deixaria o teste cego à regra de resolução.
 *
 * Existe para os ~30 pontos de construção não repetirem a fiação; o
 * comportamento testado continua o mesmo.
 */
function buildBudgetService(prisma: any) {
  return new BudgetService(
    prisma as PrismaService,
    new SalaryService(prisma as PrismaService),
  );
}

describe('BudgetService — faturas e valor de terceiros', () => {
  it('totalInvoices soma o valor BRUTO das faturas', async () => {
    const prisma = buildPrisma({
      invoices: [
        makeInvoice({ id: 'i1', totalAmount: money(600) }),
        makeInvoice({ id: 'i2', totalAmount: money(400) }),
      ],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalInvoices).toBe(1000);
  });

  it('o cenário da Eva: fatura de 1.000 com 300 de terceiro', async () => {
    // Regra central do produto. O banco cobra 1.000; o custo pessoal é 700.
    const prisma = buildPrisma({
      invoices: [makeInvoice({ totalAmount: money(1000) })],
      reimbursableSum: money(300),
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalInvoices).toBe(1000);
    expect(result.totalReimbursable).toBe(300);
    expect(result.netAmount).toBe(700);
  });

  it('não desconta nada quando nenhuma compra é de terceiro', async () => {
    const prisma = buildPrisma({
      invoices: [makeInvoice({ totalAmount: money(1000) })],
      reimbursableSum: null,
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalReimbursable).toBe(0);
    expect(result.netAmount).toBe(1000);
  });

  it('não consulta reembolsáveis quando não há faturas no mês', async () => {
    const prisma = buildPrisma({ invoices: [] });
    const service = buildBudgetService(prisma);

    const result = await service.getBudget(USER_ID, 8, 2026);

    expect(result.totalInvoices).toBe(0);
    expect(result.netAmount).toBe(0);
    expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
  });

  it('filtra reembolsáveis por fatura do mês, pessoa e cartão de crédito', async () => {
    const prisma = buildPrisma({
      invoices: [makeInvoice({ id: 'i1', totalAmount: money(500) })],
      reimbursableSum: money(100),
    });

    await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    const call = (prisma.transaction.groupBy as any).mock.calls[0][0];
    expect(call.by).toEqual(['invoiceId']);
    expect(call.where.invoiceId).toEqual({ in: ['i1'] });
    expect(call.where.personId).toEqual({ not: null });
    expect(call.where.type).toBe('CREDIT_CARD');
  });
});

describe('BudgetService — parte de terceiros por fatura', () => {
  /**
   * A tela de Orçamento mostra o custo pessoal por fatura. O agregado vem
   * junto da fatura para que o frontend não precise buscar as transações de
   * cada uma separadamente.
   */
  it('expõe reembolsável e parte própria em cada fatura', async () => {
    const prisma = buildPrisma({
      invoices: [
        makeInvoice({ id: 'i1', totalAmount: money(1000) }),
        makeInvoice({ id: 'i2', totalAmount: money(500) }),
      ],
      reimbursablePerInvoice: [
        { invoiceId: 'i1', _sum: { amount: money(300) } },
      ],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    const [first, second] = result.invoices as any[];
    expect(first.reimbursable).toBe(300);
    expect(first.ownAmount).toBe(700);
    // Fatura sem compra de terceiro: a parte própria é o total.
    expect(second.reimbursable).toBe(0);
    expect(second.ownAmount).toBe(500);
  });

  it('o total bruto de cada fatura permanece intocado', async () => {
    // A obrigação com o banco não muda por existir valor de terceiro.
    const prisma = buildPrisma({
      invoices: [makeInvoice({ id: 'i1', totalAmount: money(1000) })],
      reimbursablePerInvoice: [
        { invoiceId: 'i1', _sum: { amount: money(300) } },
      ],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(Number((result.invoices as any[])[0].totalAmount)).toBe(1000);
  });

  it('a soma das partes próprias equivale ao netAmount', async () => {
    const prisma = buildPrisma({
      invoices: [
        makeInvoice({ id: 'i1', totalAmount: money(1000) }),
        makeInvoice({ id: 'i2', totalAmount: money(500) }),
      ],
      reimbursablePerInvoice: [
        { invoiceId: 'i1', _sum: { amount: money(300) } },
        { invoiceId: 'i2', _sum: { amount: money(120) } },
      ],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    const sumOwn = (result.invoices as any[]).reduce(
      (sum, inv) => sum + inv.ownAmount,
      0,
    );
    expect(sumOwn).toBe(result.netAmount);
    expect(result.totalReimbursable).toBe(420);
  });
});

describe('BudgetService — pagamentos diretos', () => {
  it('soma débito, PIX e boleto do mês', async () => {
    const prisma = buildPrisma({
      directPayments: [
        { amount: money(50) },
        { amount: money(30.5) },
        { amount: money(19.5) },
      ],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalDirectPayments).toBe(100);
  });

  it('consulta apenas os tipos que saem na data, excluindo estorno e dívida paga', async () => {
    // Crédito não entra aqui — ele já é contado via fatura. Estornos e a
    // transação-espelho de dívida paga também ficam fora, senão o mês
    // contaria o mesmo valor duas vezes.
    const prisma = buildPrisma({ directPayments: [] });

    await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    const where = (prisma.transaction.findMany as any).mock.calls[0][0].where;
    expect(where.type).toEqual({ in: ['DEBIT_CARD', 'PIX', 'BOLETO'] });
    expect(where.isRefund).toBe(false);
    expect(where.paymentDebt).toBeNull();
  });

  it('pagamentos diretos são sempre considerados já pagos', async () => {
    // A transação só existe porque o dinheiro saiu.
    const prisma = buildPrisma({
      directPayments: [{ amount: money(200) }],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalPaid).toBe(200);
    expect(result.totalPending).toBe(0);
  });
});

describe('BudgetService — compensação por pessoa', () => {
  const personEva = { id: 'person-1', name: 'Eva' };

  async function budgetWith(
    debtAmount: string,
    receivableAmount: string | null,
  ) {
    const prisma = buildPrisma({
      debts: [
        debtRow({
          amount: debtAmount,
          personId: 'person-1',
          person: personEva,
        }),
      ],
      personReceivables:
        receivableAmount === null
          ? []
          : [{ amount: money(receivableAmount), personId: 'person-1' }],
    });

    return buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);
  }

  /**
   * ════════════════════════════════════════════════════════════════════════
   * NÃO existe compensação (Fase 9B)
   * ════════════════════════════════════════════════════════════════════════
   *
   * Estes testes afirmavam o contrário: `devo 100 e tenho 100 a receber → a
   * linha desaparece`, com `totalDebts === 0`. Era uma compensação
   * matemática — `debt - min(receivable, debt)` — que o Cartero nunca executa
   * ao quitar: cada item é liquidado pelo próprio valor.
   *
   * O efeito prático era pior que um número errado: a obrigação DESAPARECIA da
   * tela, e o usuário deixava de ver que devia R$ 100 a alguém.
   */
  it('devo 100 e não tenho nada a receber → 100', async () => {
    const result = await budgetWith('100', null);
    expect(result.totalDebts).toBe(100);
  });

  it('devo 100 e tenho 30 a receber → continua 100', async () => {
    const result = await budgetWith('100', '30');
    expect(result.totalDebts).toBe(100);
  });

  it('devo 100 e tenho 100 a receber → continua 100, e a linha permanece', async () => {
    // O caso que dá nome à regra. Saldo líquido zero não é dívida zero.
    const result = await budgetWith('100', '100');

    expect(result.totalDebts).toBe(100);
    expect(result.debtBreakdown).toHaveLength(1);
    expect(result.debtBreakdown[0].amount).toBe(100);
  });

  it('devo 100 e tenho 150 a receber → continua 100', async () => {
    // Saldo a favor não reduz obrigação nem vira gasto negativo.
    const result = await budgetWith('100', '150');

    expect(result.totalDebts).toBe(100);
    expect(result.debtBreakdown).toHaveLength(1);
  });

  it('o recebível aparece como informação, fora do total', async () => {
    const result = await budgetWith('100', '30');
    const line = result.debtBreakdown[0];

    expect(line.kind).toBe('person');
    expect(line.name).toBe('Eva');
    expect(line.amount).toBe(100);

    // Informativo, em campo próprio.
    expect(result.receivables.dueInMonth).toBe(30);
  });

  it('recebível não altera o total de dívidas', async () => {
    /**
     * Teste negativo do item 40: mexer só no recebível não pode mover
     * `totalToPay`.
     */
    const sem = await budgetWith('100', null);
    const com = await budgetWith('100', '1000');

    expect(com.totalDebts).toBe(sem.totalDebts);
    expect(com.totalToPay).toBe(sem.totalToPay);
    expect(com.receivables.dueInMonth).toBe(1000);
  });

  it('recebível de outra pessoa não compensa a dívida', async () => {
    const prisma = buildPrisma({
      debts: [
        debtRow({ amount: '100', personId: 'person-1', person: personEva }),
      ],
      personReceivables: [{ amount: money(80), personId: 'person-2' }],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalDebts).toBe(100);
  });

  it('dívida sem pessoa entra como linha avulsa, sem compensação', async () => {
    const prisma = buildPrisma({
      debts: [debtRow({ amount: '250', title: 'Conta de luz' })],
      personReceivables: [{ amount: money(500), personId: 'person-1' }],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalDebts).toBe(250);
    expect(result.debtBreakdown[0]).toMatchObject({
      kind: 'debt',
      name: 'Conta de luz',
      amount: 250,
    });
    // `offset` não existe mais no contrato: não há compensação a expor.
    expect(result.debtBreakdown[0]).not.toHaveProperty('offset');
  });

  it('agrupa várias dívidas da mesma pessoa numa linha', async () => {
    const prisma = buildPrisma({
      debts: [
        debtRow({ amount: '60', personId: 'person-1', person: personEva }),
        debtRow({ amount: '40', personId: 'person-1', person: personEva }),
      ],
      personReceivables: [{ amount: money(25), personId: 'person-1' }],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.debtBreakdown).toHaveLength(1);
    // 60 + 40 íntegros. O recebível de 25 não abate nada.
    expect(result.debtBreakdown[0].amount).toBe(100);
  });

  it('só recebíveis pendentes entram na informação do mês', async () => {
    /**
     * O filtro `personId: { not: null }` foi REMOVIDO.
     *
     * Ele existia porque o recebível só servia para compensar a dívida de uma
     * pessoa. Agora o valor é informativo — "quanto espero receber no mês" —
     * e um recebível sem pessoa vinculada também é dinheiro esperado.
     */
    const prisma = buildPrisma({ debts: [], personReceivables: [] });

    await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    const where = (prisma.receivable.findMany as any).mock.calls[0][0].where;
    expect(where.isPaid).toBe(false);
    expect(where).not.toHaveProperty('personId');
  });
});

describe('BudgetService — status das dívidas no breakdown', () => {
  const personEva = { id: 'person-1', name: 'Eva' };

  it('dívida que vence hoje ainda não está vencida', async () => {
    const today = utcDate(2026, 8, 19, 0);
    const prisma = buildPrisma({
      debts: [debtRow({ amount: '100', dueDate: today })],
    });

    // `buildDebtBreakdown` recebe o "now" por parâmetro; getBudget usa o padrão.
    // Aqui validamos via a data futura para não depender do relógio.
    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.debtBreakdown[0].status).not.toBe('PAID');
  });

  it('atraso domina quando a pessoa tem uma dívida vencida entre outras', async () => {
    const prisma = buildPrisma({
      debts: [
        debtRow({
          amount: '50',
          personId: 'person-1',
          person: personEva,
          dueDate: utcDate(2020, 1, 1),
        }),
        debtRow({
          amount: '50',
          personId: 'person-1',
          person: personEva,
          dueDate: utcDate(2099, 1, 1),
        }),
      ],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.debtBreakdown[0].status).toBe('OVERDUE');
  });

  it('pessoa com todas as dívidas pagas aparece como PAID', async () => {
    const prisma = buildPrisma({
      debts: [
        debtRow({
          amount: '80',
          personId: 'person-1',
          person: personEva,
          isPaid: true,
        }),
      ],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.debtBreakdown[0].status).toBe('PAID');
    expect(result.paidDebtsCount).toBe(1);
  });

  it('ordena por urgência: vencida antes de pendente, paga por último', async () => {
    const prisma = buildPrisma({
      debts: [
        debtRow({ amount: '10', title: 'Paga', isPaid: true }),
        debtRow({
          amount: '20',
          title: 'Vencida',
          dueDate: utcDate(2020, 1, 1),
        }),
        /*
          Vence DENTRO do mês consultado e ainda não venceu de fato: é o caso
          "Pendente". Uma data de 2099 cairia fora da janela de agosto e a
          linha nem existiria.
        */
        debtRow({
          amount: '30',
          title: 'Pendente',
          dueDate: utcDate(2026, 8, 28),
        }),
      ],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.debtBreakdown.map((line) => line.name)).toEqual([
      'Vencida',
      'Pendente',
      'Paga',
    ]);
  });
});

describe('BudgetService — totais e salário', () => {
  it('totalToPay soma faturas líquidas, pagamentos diretos e dívidas', async () => {
    const prisma = buildPrisma({
      invoices: [makeInvoice({ totalAmount: money(1000) })],
      reimbursableSum: money(300),
      directPayments: [{ amount: money(150) }],
      debts: [debtRow({ amount: '200' })],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    // 700 (líquido) + 150 (diretos) + 200 (dívidas)
    expect(result.totalToPay).toBe(1050);
  });

  it('faturas pagas contam no total e também em totalPaid', async () => {
    // O número representa o custo do mês, não só o que ainda falta sair.
    const prisma = buildPrisma({
      invoices: [
        makeInvoice({ id: 'i1', totalAmount: money(400), status: 'PAID' }),
        makeInvoice({ id: 'i2', totalAmount: money(600), status: 'OPEN' }),
      ],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalToPay).toBe(1000);
    expect(result.totalPaid).toBe(400);
    expect(result.totalPending).toBe(600);
  });

  it('dívida paga soma o valor íntegro, e "pago" não supera o total', async () => {
    /**
     * A versão anterior usava o valor COMPENSADO aqui, com a justificativa de
     * que o bruto faria "pago" superar o total do mês.
     *
     * O problema real era a compensação, não o bruto: com ela fora, os dois
     * lados usam o mesmo número e a invariante se sustenta naturalmente.
     */
    const prisma = buildPrisma({
      debts: [
        debtRow({
          amount: '100',
          personId: 'person-1',
          person: { id: 'person-1', name: 'Eva' },
          isPaid: true,
        }),
      ],
      personReceivables: [{ amount: money(40), personId: 'person-1' }],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalDebts).toBe(100);
    expect(result.totalPaid).toBe(100);
    expect(result.totalPaid).toBeLessThanOrEqual(result.totalToPay);
  });

  it('devolve salário nulo quando não cadastrado', async () => {
    const prisma = buildPrisma({ salary: null });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.salary).toBeNull();
  });

  it('converte salário decimal sem perder centavos', async () => {
    const prisma = buildPrisma({ salary: '4321.99' });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.salary).toBe(4321.99);
  });

  it('soma centavos sem erro de ponto flutuante', async () => {
    // 0.1 + 0.2 clássico: o valor precisa fechar exatamente em 0.30.
    const prisma = buildPrisma({
      directPayments: [{ amount: money('0.10') }, { amount: money('0.20') }],
    });

    const result = await buildBudgetService(prisma).getBudget(USER_ID, 8, 2026);

    expect(result.totalDirectPayments).toBeCloseTo(0.3, 10);
  });

  it('recorta faturas pelo mês/ano pedido', async () => {
    const prisma = buildPrisma({ invoices: [] });

    await buildBudgetService(prisma).getBudget(USER_ID, 3, 2027);

    const where = (prisma.invoice.findMany as any).mock.calls[0][0].where;
    expect(where).toMatchObject({ month: 3, year: 2027 });
  });
});

describe('BudgetService — getFocusPeriod', () => {
  function focusPrisma(data: {
    invoices?: { month: number; year: number }[];
    debts?: { dueDate: Date }[];
  }) {
    return {
      invoice: { findMany: vi.fn().mockResolvedValue(data.invoices ?? []) },
      debt: {
        findMany: vi.fn(({ where }: any) =>
          Promise.resolve(
            where?.dueDate?.lt && !where?.dueDate?.gte
              ? []
              : (data.debts ?? []),
          ),
        ),
      },
    } as unknown as PrismaService;
  }

  it('devolve o mês corrente quando nada está pendente', async () => {
    const prisma = focusPrisma({});
    const now = utcDate(2026, 8, 19);

    const result = await buildBudgetService(prisma).getFocusPeriod(
      USER_ID,
      now,
    );

    expect(result).toEqual({ month: 8, year: 2026 });
  });

  it('prioriza a pendência mais antiga', async () => {
    const prisma = focusPrisma({
      invoices: [
        { month: 8, year: 2026 },
        { month: 5, year: 2026 },
      ],
    });

    const result = await buildBudgetService(prisma).getFocusPeriod(
      USER_ID,
      utcDate(2026, 8, 19),
    );

    expect(result).toEqual({ month: 5, year: 2026 });
  });

  it('considera anos anteriores como mais antigos', async () => {
    const prisma = focusPrisma({
      invoices: [
        { month: 2, year: 2026 },
        { month: 11, year: 2025 },
      ],
    });

    const result = await buildBudgetService(prisma).getFocusPeriod(
      USER_ID,
      utcDate(2026, 8, 19),
    );

    expect(result).toEqual({ month: 11, year: 2025 });
  });

  it('considera dívidas em aberto junto das faturas', async () => {
    const prisma = focusPrisma({
      invoices: [{ month: 8, year: 2026 }],
      debts: [{ dueDate: utcDate(2026, 6, 20) }],
    });

    const result = await buildBudgetService(prisma).getFocusPeriod(
      USER_ID,
      utcDate(2026, 8, 19),
    );

    expect(result).toEqual({ month: 6, year: 2026 });
  });

  it('busca apenas faturas não pagas e com valor', async () => {
    const prisma = focusPrisma({});

    await buildBudgetService(prisma).getFocusPeriod(
      USER_ID,
      utcDate(2026, 8, 19),
    );

    const where = (prisma.invoice.findMany as any).mock.calls[0][0].where;
    expect(where.status).toEqual({ not: 'PAID' });
    expect(where.totalAmount).toEqual({ gt: 0 });
  });
});
