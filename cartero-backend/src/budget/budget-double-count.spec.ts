import { describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';
import { SalaryService } from 'src/salary/salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  USER_ID,
  makeBank,
  makeInvoice,
  money,
} from 'src/common/testing/fixtures';
import { routeDebtQuery } from 'src/common/testing/debt-query-double';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Nada é contado duas vezes (Fase 9B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O orçamento reúne quatro origens de valor — faturas, pagamentos diretos,
 * dívidas e recebíveis — e três delas podem apontar para o MESMO dinheiro:
 *
 *   1. compra de terceiro reduz a sua parte da fatura, e o recebível
 *      automático correspondente poderia reduzir de novo;
 *   2. dívida paga gera transação-espelho, que poderia somar como pagamento
 *      direto além da própria dívida.
 *
 * Cada duplicidade tem sinal oposto — uma tira demais, a outra soma demais —
 * e as duas são invisíveis no total. Estes testes existem para que voltem a
 * aparecer se alguém desfizer as exclusões.
 */

interface Setup {
  invoiceTotal?: number;
  /** Parte de terceiros dentro da fatura. */
  thirdPartyAmount?: number;
  /** Recebível automático correspondente à compra de terceiro. */
  automaticReceivable?: number;
  debtAmount?: number;
  /** Transação-espelho gerada ao pagar a dívida. */
  debtPaymentTransaction?: number;
  /** Pagamento direto genuíno, sem vínculo com dívida. */
  standaloneDirectPayment?: number;
}

function buildService(setup: Setup) {
  /** `where` das consultas, para inspecionar as exclusões. */
  const seen = { transactionWhere: [] as any[] };

  const invoice = makeInvoice({
    id: 'inv-1',
    totalAmount: money(setup.invoiceTotal ?? 0),
  });

  const prisma: any = {
    salaryHistory: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({})), update: vi.fn() },
    invoice: {
      findMany: vi.fn(async () =>
        setup.invoiceTotal ? [{ ...invoice, bank: makeBank() }] : [],
      ),
    },
    transaction: {
      findMany: vi.fn(async ({ where }: any) => {
        seen.transactionWhere.push(where);

        const rows: Array<{ amount: unknown }> = [];

        if (setup.standaloneDirectPayment) {
          rows.push({ amount: money(setup.standaloneDirectPayment) });
        }

        /*
          A transação-espelho da dívida só entra se o serviço NÃO tiver
          excluído `paymentDebt`. É assim que o duplo detecta a regressão em
          vez de assumi-la.
        */
        if (setup.debtPaymentTransaction && where?.paymentDebt === undefined) {
          rows.push({ amount: money(setup.debtPaymentTransaction) });
        }

        return rows;
      }),
      groupBy: vi.fn(async () =>
        setup.thirdPartyAmount
          ? [
              {
                invoiceId: 'inv-1',
                _sum: { amount: money(setup.thirdPartyAmount) },
              },
            ]
          : [],
      ),
    },
    /*
      Roteia pelas três consultas de dívida. Devolver a mesma linha para todas
      contaria a dívida paga duas vezes — em `openDueInMonth` e em
      `paidInMonth` —, que é justamente o double count deste arquivo.
    */
    debt: {
      findMany: vi.fn(async ({ where }: any) =>
        routeDebtQuery(
          where,
          setup.debtAmount
            ? [
                {
                  amount: money(setup.debtAmount),
                  isPaid: true,
                  paidAt: new Date(Date.UTC(2026, 7, 15, 12)),
                  title: 'Aluguel',
                  dueDate: new Date(Date.UTC(2026, 7, 10, 12)),
                  personId: null,
                  person: null,
                },
              ]
            : [],
        ),
      ),
    },
    receivable: {
      findMany: vi.fn(async () =>
        setup.automaticReceivable
          ? [{ amount: money(setup.automaticReceivable), personId: 'person-1' }]
          : [],
      ),
    },
    bank: { findMany: vi.fn(async () => [makeBank()]) },
  };

  return {
    service: new BudgetService(
      prisma as PrismaService,
      new SalaryService(prisma as PrismaService),
    ),
    seen,
  };
}

describe('Compra de terceiro — benefício uma única vez', () => {
  /**
   * O cenário do item 41 e da Fase 3.
   *
   * Fatura bruta R$ 1.000, sendo R$ 300 de Eva. A sua parte é R$ 700.
   * O recebível automático de R$ 300 NÃO pode reduzir de novo para R$ 400 —
   * seria o mesmo desconto aplicado duas vezes.
   */
  const CENARIO: Setup = {
    invoiceTotal: 1000,
    thirdPartyAmount: 300,
    automaticReceivable: 300,
  };

  it('a sua parte da fatura é 700', async () => {
    const { service } = buildService(CENARIO);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.totalInvoices).toBe(1000); // bruto: é o que o banco cobra
    expect(budget.totalReimbursable).toBe(300);
    expect(budget.netAmount).toBe(700);
  });

  it('totalToPay é 700 — nem 400, nem 1000', async () => {
    const { service } = buildService(CENARIO);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.totalToPay).toBe(700);
  });

  it('o recebível automático aparece só como informação', async () => {
    const { service } = buildService(CENARIO);

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.receivables.dueInMonth).toBe(300);
    // E não afeta o total.
    expect(budget.totalToPay).toBe(budget.netAmount);
  });

  it('variar o recebível não move totalToPay', async () => {
    /**
     * Teste negativo do item 40, aplicado ao caso mais tentador: o valor do
     * recebível é idêntico ao desconto já aplicado na fatura.
     */
    const semRecebivel = buildService({
      invoiceTotal: 1000,
      thirdPartyAmount: 300,
    });
    const comRecebivelGrande = buildService({
      invoiceTotal: 1000,
      thirdPartyAmount: 300,
      automaticReceivable: 5000,
    });

    const [a, b] = await Promise.all([
      semRecebivel.service.getBudget(USER_ID, 8, 2026),
      comRecebivelGrande.service.getBudget(USER_ID, 8, 2026),
    ]);

    expect(b.totalToPay).toBe(a.totalToPay);
    expect(b.receivables.dueInMonth).toBe(5000);
  });
});

describe('Dívida paga com transação-espelho', () => {
  /**
   * Item 42: dívida de R$ 500 com `createExpenseOnDebtPaid = true` gera uma
   * transação de R$ 500. O incremento no orçamento é R$ 500, não R$ 1.000.
   */
  it('a transação-espelho é excluída dos pagamentos diretos', async () => {
    const { service, seen } = buildService({
      debtAmount: 500,
      debtPaymentTransaction: 500,
    });

    const budget = await service.getBudget(USER_ID, 8, 2026);

    // A exclusão é explícita na query — é o que impede a duplicidade.
    expect(seen.transactionWhere[0]).toMatchObject({ paymentDebt: null });
    expect(budget.totalDirectPayments).toBe(0);
    expect(budget.debts.total).toBe(500);
    expect(budget.totalToPay).toBe(500);
  });

  it('pagamento direto genuíno continua somando', async () => {
    // A exclusão não pode ser larga demais e engolir gastos reais.
    const { service } = buildService({
      debtAmount: 500,
      debtPaymentTransaction: 500,
      standaloneDirectPayment: 120,
    });

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.totalDirectPayments).toBe(120);
    expect(budget.totalToPay).toBe(620);
  });
});

describe('createExpenseOnDebtPaid = false', () => {
  it('a obrigação existe mesmo sem transação-espelho', async () => {
    /**
     * Item 43. A dívida pertence ao orçamento por ela mesma; depender da
     * transação para contabilizá-la faria a obrigação desaparecer para quem
     * desliga a preferência.
     */
    const { service } = buildService({ debtAmount: 500 });

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.debts.total).toBe(500);
    expect(budget.totalDirectPayments).toBe(0);
    expect(budget.totalToPay).toBe(500);
  });
});

describe('Equação final', () => {
  it('totalToPay = faturaPrópria + pagamentosDiretos + dívidas', async () => {
    const { service } = buildService({
      invoiceTotal: 1000,
      thirdPartyAmount: 300,
      debtAmount: 500,
      standaloneDirectPayment: 120,
      automaticReceivable: 300,
    });

    const budget = await service.getBudget(USER_ID, 8, 2026);

    expect(budget.totalToPay).toBe(
      budget.netAmount + budget.totalDirectPayments + budget.debts.total,
    );
    expect(budget.totalToPay).toBe(700 + 120 + 500);
  });

  it('recebíveis ficam fora da equação', async () => {
    const { service } = buildService({
      invoiceTotal: 1000,
      thirdPartyAmount: 300,
      debtAmount: 500,
      standaloneDirectPayment: 120,
      automaticReceivable: 9999,
    });

    const budget = await service.getBudget(USER_ID, 8, 2026);

    // O recebível gigante não aparece em lugar nenhum do total.
    expect(budget.totalToPay).toBe(1320);
  });
});
