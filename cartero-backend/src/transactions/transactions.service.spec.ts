import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  USER_ID,
  makeBank,
  makeInvoice,
  makePerson,
  makeReceivable,
  makeTransaction,
  money,
  utcDate,
} from 'src/common/testing/fixtures';

/**
 * Transações são o centro do domínio: geram fatura, geram recebível de
 * terceiro, e carregam as salvaguardas de fatura paga/fechada.
 *
 * Os testes exercitam o serviço pelos métodos públicos (`create`/`update`/
 * `remove`), com um duplo de Prisma que registra as escritas — a asserção é
 * sobre o efeito financeiro, não sobre a forma interna do código.
 */

/** Estado mutável do "banco" para o duplo de Prisma. */
interface DbState {
  bank: ReturnType<typeof makeBank>;
  invoices: ReturnType<typeof makeInvoice>[];
  transactions: ReturnType<typeof makeTransaction>[];
  receivables: ReturnType<typeof makeReceivable>[];
  person: ReturnType<typeof makePerson>;
}

function buildHarness(state: DbState) {
  const created = {
    transactions: [] as any[],
    receivables: [] as any[],
  };
  const updates = {
    invoices: [] as { id: string; data: any }[],
    transactions: [] as { id: string; data: any }[],
    receivables: [] as { id: string; data: any }[],
  };
  const deletes = {
    transactions: [] as string[],
    receivables: [] as string[],
    invoices: [] as string[],
  };

  let txSeq = 0;
  let recSeq = 0;

  const findInvoice = (where: any) =>
    state.invoices.find(
      (invoice) =>
        (where.id === undefined || invoice.id === where.id) &&
        (where.month === undefined || invoice.month === where.month) &&
        (where.year === undefined || invoice.year === where.year) &&
        (where.bankId === undefined || invoice.bankId === where.bankId) &&
        (where.status === undefined || invoice.status === where.status) &&
        (where.id?.in === undefined || where.id.in.includes(invoice.id)),
    ) ?? null;

  const client = {
    invoice: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.id?.in) {
          return (
            state.invoices.find(
              (invoice) =>
                where.id.in.includes(invoice.id) &&
                (where.status === undefined || invoice.status === where.status),
            ) ?? null
          );
        }
        return findInvoice(where);
      }),
      findUnique: vi.fn(async ({ where }: any) => findInvoice(where)),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const invoice = findInvoice(where);
        if (!invoice) throw new Error(`Invoice não encontrada: ${where.id}`);
        return invoice;
      }),
      create: vi.fn(async ({ data }: any) => {
        const invoice = makeInvoice({
          id: `invoice-new-${state.invoices.length + 1}`,
          ...data,
        });
        state.invoices.push(invoice);
        return invoice;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        updates.invoices.push({ id: where.id, data });
        const invoice = state.invoices.find((item) => item.id === where.id)!;
        if (data.totalAmount?.increment !== undefined) {
          invoice.totalAmount = invoice.totalAmount.plus(
            data.totalAmount.increment,
          );
        }
        if (data.totalAmount?.decrement !== undefined) {
          invoice.totalAmount = invoice.totalAmount.minus(
            data.totalAmount.decrement,
          );
        }
        if (data.status) invoice.status = data.status;
        return invoice;
      }),
      delete: vi.fn(async ({ where }: any) => {
        deletes.invoices.push(where.id);
        state.invoices = state.invoices.filter((item) => item.id !== where.id);
        return {};
      }),
    },
    transaction: {
      findMany: vi.fn(async ({ where }: any) =>
        state.transactions.filter(
          (tx) =>
            (where.parentId === undefined || tx.parentId === where.parentId) &&
            (where.OR === undefined ||
              where.OR.some(
                (clause: any) =>
                  (clause.id !== undefined && tx.id === clause.id) ||
                  (clause.parentId !== undefined &&
                    tx.parentId === clause.parentId),
              )),
        ),
      ),
      findFirst: vi.fn(
        async ({ where }: any) =>
          state.transactions.find((tx) => tx.parentId === where.parentId) ??
          null,
      ),
      findUnique: vi.fn(
        async ({ where }: any) =>
          state.transactions.find((tx) => tx.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        txSeq += 1;
        const tx = makeTransaction({ id: `tx-new-${txSeq}`, ...data });
        created.transactions.push(tx);
        state.transactions.push(tx);
        return tx;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        updates.transactions.push({ id: where.id, data });
        const index = state.transactions.findIndex(
          (item) => item.id === where.id,
        );
        const current = state.transactions[index];
        // Devolve uma NOVA instância, como o Prisma faz. Mutar o objeto no
        // lugar faria o serviço comparar o registro já atualizado consigo
        // mesmo e perder a detecção de "a pessoa mudou".
        //
        // `undefined` significa "não alterar" para o Prisma, então precisa ser
        // ignorado aqui também — os serviços passam campos explicitamente
        // indefinidos quando o DTO não os traz.
        const updated = { ...current };
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) (updated as any)[key] = value;
        }
        if (data.amount !== undefined) updated.amount = money(data.amount);
        state.transactions[index] = updated;
        return updated;
      }),
      delete: vi.fn(async ({ where }: any) => {
        deletes.transactions.push(where.id);
        state.transactions = state.transactions.filter(
          (item) => item.id !== where.id,
        );
        return {};
      }),
    },
    receivable: {
      findUnique: vi.fn(
        async ({ where }: any) =>
          state.receivables.find(
            (rec) =>
              (where.id !== undefined && rec.id === where.id) ||
              (where.transactionId !== undefined &&
                rec.transactionId === where.transactionId),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        recSeq += 1;
        const rec = makeReceivable({ id: `rec-new-${recSeq}`, ...data });
        created.receivables.push(rec);
        state.receivables.push(rec);
        return rec;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        updates.receivables.push({ id: where.id, data });
        const rec = state.receivables.find((item) => item.id === where.id)!;
        // `undefined` = "não alterar", como no Prisma.
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) (rec as any)[key] = value;
        }
        return rec;
      }),
      delete: vi.fn(async ({ where }: any) => {
        deletes.receivables.push(where.id);
        state.receivables = state.receivables.filter(
          (item) => item.id !== where.id,
        );
        return {};
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.paymentTransactionId?.in) {
          const ids: string[] = where.paymentTransactionId.in;
          return (
            state.receivables.find((rec) =>
              ids.includes(rec.paymentTransactionId as string),
            ) ?? null
          );
        }
        const ids: string[] = where.transactionId?.in ?? [];
        return (
          state.receivables.find(
            (rec) =>
              ids.includes(rec.transactionId as string) &&
              (where.isPaid === undefined || rec.isPaid === where.isPaid),
          ) ?? null
        );
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const removed = state.receivables.filter(
          (rec) => rec.transactionId === where.transactionId,
        );
        removed.forEach((rec) => deletes.receivables.push(rec.id));
        state.receivables = state.receivables.filter(
          (rec) => rec.transactionId !== where.transactionId,
        );
        return { count: removed.length };
      }),
    },
  };

  // Nenhum cenário deste arquivo usa transações de pagamento; a delegação
  // existe porque `remove` verifica se a transação paga uma dívida.
  (client as any).debt = { findFirst: vi.fn(async () => null) };

  const prisma = {
    ...client,
    $transaction: vi.fn(async (callback: any) => callback(client)),
  } as unknown as PrismaService;

  const validation = {
    validateTransaction: vi.fn(async (id: string) => {
      const tx = state.transactions.find((item) => item.id === id);
      if (!tx) throw new Error(`Transação não encontrada: ${id}`);
      return tx;
    }),
    validateBank: vi.fn(async () => state.bank),
    validateCategory: vi.fn(async () => ({ id: 'cat-1', userId: USER_ID })),
    validatePerson: vi.fn(async (id: string) =>
      id === state.person.id ? state.person : makePerson({ id, name: 'Breno' }),
    ),
  } as unknown as EntityValidationService;

  return {
    service: new TransactionsService(prisma, validation),
    state,
    created,
    updates,
    deletes,
    prisma,
  };
}

function baseState(overrides: Partial<DbState> = {}): DbState {
  return {
    bank: makeBank(),
    invoices: [],
    transactions: [],
    receivables: [],
    person: makePerson(),
    ...overrides,
  };
}

describe('TransactionsService.create — compra simples', () => {
  it('cria a transação e soma na fatura', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Mercado',
      type: 'CREDIT_CARD',
      amount: 250,
      date: '2026-08-01',
    } as any);

    expect(harness.created.transactions).toHaveLength(1);
    expect(harness.state.invoices).toHaveLength(1);
    expect(Number(harness.state.invoices[0].totalAmount)).toBe(250);
  });

  it('estorno subtrai do total da fatura', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [
          makeInvoice({ month: 8, year: 2026, totalAmount: money(500) }),
        ],
      }),
    );

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Devolução',
      type: 'CREDIT_CARD',
      amount: 100,
      isRefund: true,
      date: '2026-08-01',
    } as any);

    expect(Number(harness.state.invoices[0].totalAmount)).toBe(400);
  });

  it('transação sem cartão não toca em fatura', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Salário',
      type: 'INCOME',
      amount: 5000,
      date: '2026-08-05',
    } as any);

    expect(harness.state.invoices).toHaveLength(0);
    expect(harness.created.transactions[0].invoiceId).toBeNull();
  });

  it('rejeita pessoa vinculada fora do cartão de crédito', async () => {
    const harness = buildHarness(baseState());

    await expect(
      harness.service.create(USER_ID, {
        bankId: 'bank-1',
        categoryId: 'cat-1',
        title: 'PIX para amigo',
        type: 'PIX',
        amount: 100,
        personId: 'person-1',
        date: '2026-08-01',
      } as any),
    ).rejects.toThrow(/cartão de crédito/);
  });

  it('rejeita estorno fora do cartão de crédito', async () => {
    const harness = buildHarness(baseState());

    await expect(
      harness.service.create(USER_ID, {
        bankId: 'bank-1',
        categoryId: 'cat-1',
        title: 'Estorno',
        type: 'PIX',
        amount: 100,
        isRefund: true,
        date: '2026-08-01',
      } as any),
    ).rejects.toThrow(/cartão de crédito/);
  });
});

describe('TransactionsService.create — compra de terceiro', () => {
  it('gera um recebível espelho herdando pessoa, valor e título', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Ingresso',
      type: 'CREDIT_CARD',
      amount: 300,
      personId: 'person-1',
      date: '2026-08-01',
    } as any);

    expect(harness.created.receivables).toHaveLength(1);
    const receivable = harness.created.receivables[0];
    expect(receivable.personId).toBe('person-1');
    expect(receivable.debtorName).toBe('Eva');
    expect(receivable.title).toBe('Ingresso');
    expect(Number(receivable.amount)).toBe(300);
  });

  it('vincula o recebível à transação pelo FK único', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Ingresso',
      type: 'CREDIT_CARD',
      amount: 300,
      personId: 'person-1',
      date: '2026-08-01',
    } as any);

    const transaction = harness.created.transactions[0];
    expect(harness.created.receivables[0].transactionId).toBe(transaction.id);
  });

  it('o vencimento do recebível é o vencimento da fatura', async () => {
    // Regra central do produto: a cobrança acompanha a fatura, não a compra.
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Ingresso',
      type: 'CREDIT_CARD',
      amount: 300,
      personId: 'person-1',
      date: '2026-08-01',
    } as any);

    const dueDate: Date = harness.created.receivables[0].dueDate;
    const invoice = harness.state.invoices[0];
    expect(dueDate.getUTCDate()).toBe(harness.state.bank.invoiceDueDate);
    expect(dueDate.getUTCMonth() + 1).toBe(invoice.month);
    expect(dueDate.getUTCFullYear()).toBe(invoice.year);
  });

  it('a fatura continua com o valor BRUTO da compra', async () => {
    // O banco vai cobrar os 300 integralmente — o recebível não abate a fatura.
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Ingresso',
      type: 'CREDIT_CARD',
      amount: 300,
      personId: 'person-1',
      date: '2026-08-01',
    } as any);

    expect(Number(harness.state.invoices[0].totalAmount)).toBe(300);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Semântica do valor em compras parceladas (corrigida na Fase 5A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `amount` no payload é o TOTAL da compra. Cada parcela recebe a sua fatia, e
 * a soma delas fecha exatamente com o total.
 *
 * Antes, o valor cheio era gravado em cada parcela: uma compra de R$ 1.000 em
 * 10x virava dez lançamentos de R$ 1.000 (R$ 10.000), inflava dez faturas pelo
 * valor integral e criava dez recebíveis de R$ 1.000 cada.
 */
describe('TransactionsService.create — valor total dividido entre as parcelas', () => {
  /** Soma em centavos, para não reintroduzir erro de ponto flutuante. */
  const sumCents = (values: number[]) =>
    values.reduce((total, value) => total + Math.round(value * 100), 0);

  it('divide o total entre as parcelas em vez de repeti-lo', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Notebook',
      type: 'CREDIT_CARD',
      amount: 1000,
      installments: 10,
      date: '2026-08-01',
    } as any);

    const amounts = harness.created.transactions.map((tx) => Number(tx.amount));
    expect(amounts).toHaveLength(10);
    expect(amounts.every((value) => value === 100)).toBe(true);
    expect(sumCents(amounts)).toBe(100000);
  });

  it('a soma das parcelas é exatamente o total, mesmo com centavos', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Televisão',
      type: 'CREDIT_CARD',
      amount: 2196.69,
      installments: 10,
      date: '2026-08-01',
    } as any);

    const amounts = harness.created.transactions.map((tx) => Number(tx.amount));
    expect(sumCents(amounts)).toBe(Math.round(2196.69 * 100));
    // Resto de 9 centavos: as nove primeiras ficam um centavo maiores.
    expect(amounts[0]).toBeCloseTo(219.67, 10);
    expect(amounts[9]).toBeCloseTo(219.66, 10);
  });

  it('compra à vista mantém o valor integral', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Mercado',
      type: 'CREDIT_CARD',
      amount: 250,
      date: '2026-08-01',
    } as any);

    expect(Number(harness.created.transactions[0].amount)).toBe(250);
  });

  it('cada fatura recebe apenas o valor da sua parcela', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Notebook',
      type: 'CREDIT_CARD',
      amount: 1000,
      installments: 10,
      date: '2026-08-01',
    } as any);

    // Dez faturas, cada uma incrementada em R$ 100 — não em R$ 1.000.
    const increments = harness.updates.invoices.map((update) =>
      Number(update.data.totalAmount.increment),
    );
    expect(increments).toHaveLength(10);
    expect(increments.every((value) => value === 100)).toBe(true);
    expect(sumCents(increments)).toBe(100000);
  });

  it('a soma dos recebíveis de uma compra de terceiro é o total', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Ingresso',
      type: 'CREDIT_CARD',
      amount: 1000,
      installments: 10,
      personId: 'person-1',
      date: '2026-08-01',
    } as any);

    const amounts = harness.created.receivables.map((rec) =>
      Number(rec.amount),
    );
    expect(amounts).toHaveLength(10);
    expect(sumCents(amounts)).toBe(100000);
    expect(amounts.every((value) => value === 100)).toBe(true);
  });

  it('cada recebível espelha o valor da sua própria parcela', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Ingresso',
      type: 'CREDIT_CARD',
      amount: 100,
      installments: 3,
      personId: 'person-1',
      date: '2026-08-01',
    } as any);

    const txAmounts = harness.created.transactions.map((tx) =>
      Number(tx.amount),
    );
    const recAmounts = harness.created.receivables.map((rec) =>
      Number(rec.amount),
    );
    expect(recAmounts).toEqual(txAmounts);
    expect(sumCents(recAmounts)).toBe(10000);
  });

  it('o valor total da série é a soma das parcelas, não o da raiz', async () => {
    // A raiz é a primeira parcela e entra na primeira fatura pelo seu próprio
    // valor — guardar o total nela inflaria essa fatura.
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Sofá',
      type: 'CREDIT_CARD',
      amount: 900,
      installments: 3,
      date: '2026-08-01',
    } as any);

    const [root] = harness.created.transactions;
    expect(Number(root.amount)).toBe(300);
    expect(
      sumCents(harness.created.transactions.map((tx) => Number(tx.amount))),
    ).toBe(90000);
  });

  it('estorno não é parcelado e mantém o valor informado', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [
          makeInvoice({ month: 8, year: 2026, totalAmount: money(500) }),
        ],
      }),
    );

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Devolução',
      type: 'CREDIT_CARD',
      amount: 100,
      isRefund: true,
      installments: 3,
      date: '2026-08-01',
    } as any);

    expect(harness.created.transactions).toHaveLength(1);
    expect(Number(harness.created.transactions[0].amount)).toBe(100);
  });
});

describe('TransactionsService.create — parcelamento', () => {
  it('cria uma transação por parcela, numerando o título', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Notebook',
      type: 'CREDIT_CARD',
      amount: 500,
      installments: 3,
      date: '2026-08-01',
    } as any);

    expect(harness.created.transactions.map((tx) => tx.title)).toEqual([
      'Notebook 1/3',
      'Notebook 2/3',
      'Notebook 3/3',
    ]);
  });

  it('a primeira parcela é a raiz da série', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Notebook',
      type: 'CREDIT_CARD',
      amount: 500,
      installments: 3,
      date: '2026-08-01',
    } as any);

    const [root, second, third] = harness.created.transactions;
    expect(root.parentId).toBeNull();
    expect(second.parentId).toBe(root.id);
    expect(third.parentId).toBe(root.id);
  });

  it('cada parcela cai em uma fatura mensal subsequente', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Notebook',
      type: 'CREDIT_CARD',
      amount: 500,
      installments: 3,
      date: '2026-08-01',
    } as any);

    const periods = harness.state.invoices.map((invoice) => ({
      month: invoice.month,
      year: invoice.year,
    }));
    expect(periods).toEqual([
      { month: 8, year: 2026 },
      { month: 9, year: 2026 },
      { month: 10, year: 2026 },
    ]);
  });

  it('todas as parcelas preservam a data original da compra', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Notebook',
      type: 'CREDIT_CARD',
      amount: 500,
      installments: 3,
      date: '2026-08-01',
    } as any);

    const dates = harness.created.transactions.map((tx) =>
      (tx.date as Date).toISOString(),
    );
    expect(new Set(dates).size).toBe(1);
  });

  it('atravessa a virada de ano nas parcelas', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Curso',
      type: 'CREDIT_CARD',
      amount: 100,
      installments: 3,
      date: '2026-11-01',
    } as any);

    expect(
      harness.state.invoices.map(
        (i) => `${i.year}-${String(i.month).padStart(2, '0')}`,
      ),
    ).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('cada parcela gera seu próprio recebível quando há pessoa', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Ingresso',
      type: 'CREDIT_CARD',
      amount: 150,
      installments: 2,
      personId: 'person-1',
      date: '2026-08-01',
    } as any);

    expect(harness.created.receivables).toHaveLength(2);
    // Cada recebível aponta para a sua própria parcela.
    const txIds = harness.created.transactions.map((tx) => tx.id);
    expect(harness.created.receivables.map((r) => r.transactionId)).toEqual(
      txIds,
    );
  });

  it('os recebíveis das parcelas têm cadeia própria de parentId', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Ingresso',
      type: 'CREDIT_CARD',
      amount: 150,
      installments: 2,
      personId: 'person-1',
      date: '2026-08-01',
    } as any);

    const [first, second] = harness.created.receivables;
    expect(first.parentId).toBeNull();
    expect(second.parentId).toBe(first.id);
  });

  it('cada parcela vence junto da sua própria fatura', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Ingresso',
      type: 'CREDIT_CARD',
      amount: 150,
      installments: 2,
      personId: 'person-1',
      date: '2026-08-01',
    } as any);

    const months = harness.created.receivables.map(
      (rec) => (rec.dueDate as Date).getUTCMonth() + 1,
    );
    expect(months).toEqual([8, 9]);
  });

  it('estorno nunca é parcelado', async () => {
    const harness = buildHarness(baseState());

    await harness.service.create(USER_ID, {
      bankId: 'bank-1',
      categoryId: 'cat-1',
      title: 'Devolução',
      type: 'CREDIT_CARD',
      amount: 100,
      isRefund: true,
      installments: 3,
      date: '2026-08-01',
    } as any);

    expect(harness.created.transactions).toHaveLength(1);
    expect(harness.created.transactions[0].title).toBe('Devolução');
  });
});

describe('TransactionsService — salvaguardas de fatura PAID', () => {
  it('bloqueia criar transação em fatura paga', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ month: 8, year: 2026, status: 'PAID' })],
      }),
    );

    await expect(
      harness.service.create(USER_ID, {
        bankId: 'bank-1',
        categoryId: 'cat-1',
        title: 'Compra',
        type: 'CREDIT_CARD',
        amount: 100,
        date: '2026-08-01',
      } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('bloqueia o parcelamento inteiro se uma das faturas estiver paga', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [
          makeInvoice({ id: 'i8', month: 8, year: 2026, status: 'OPEN' }),
          makeInvoice({ id: 'i9', month: 9, year: 2026, status: 'PAID' }),
        ],
      }),
    );

    await expect(
      harness.service.create(USER_ID, {
        bankId: 'bank-1',
        categoryId: 'cat-1',
        title: 'Notebook',
        type: 'CREDIT_CARD',
        amount: 500,
        installments: 3,
        date: '2026-08-01',
      } as any),
    ).rejects.toThrow(/parcelamento já está paga/);
  });

  it('bloqueia editar valor de transação em fatura paga', async () => {
    const invoice = makeInvoice({ id: 'i-paid', status: 'PAID' });
    const harness = buildHarness(
      baseState({
        invoices: [invoice],
        transactions: [makeTransaction({ invoiceId: 'i-paid' })],
      }),
    );

    await expect(
      harness.service.update('tx-1', USER_ID, { amount: 200 } as any),
    ).rejects.toThrow(/fatura paga/);
  });

  it('bloqueia excluir transação de fatura paga', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'i-paid', status: 'PAID' })],
        transactions: [makeTransaction({ invoiceId: 'i-paid' })],
      }),
    );

    await expect(harness.service.remove('tx-1', USER_ID)).rejects.toThrow(
      /fatura já paga/,
    );
  });

  it('não deixa efeito colateral quando o bloqueio dispara', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'i-paid', status: 'PAID' })],
        transactions: [makeTransaction({ invoiceId: 'i-paid' })],
      }),
    );

    await expect(harness.service.remove('tx-1', USER_ID)).rejects.toThrow();

    expect(harness.deletes.transactions).toHaveLength(0);
    expect(harness.updates.invoices).toHaveLength(0);
  });
});

describe('TransactionsService — remanejamento para fatura CLOSED', () => {
  /**
   * Editar a data de uma compra parcelada pode mover parcelas para outra
   * fatura. Se a fatura de destino está CLOSED, o backend exige confirmação
   * explícita e sinaliza com um código que o frontend reconhece.
   */
  function closedHarness() {
    const root = makeTransaction({
      id: 'tx-root',
      title: 'Notebook 1/2',
      invoiceId: 'i-open',
      date: utcDate(2026, 8, 1),
    });
    const child = makeTransaction({
      id: 'tx-child',
      parentId: 'tx-root',
      title: 'Notebook 2/2',
      invoiceId: 'i-open2',
      date: utcDate(2026, 8, 1),
    });

    return buildHarness(
      baseState({
        invoices: [
          makeInvoice({ id: 'i-open', month: 8, year: 2026, status: 'OPEN' }),
          makeInvoice({ id: 'i-open2', month: 9, year: 2026, status: 'OPEN' }),
          makeInvoice({
            id: 'i-closed',
            month: 6,
            year: 2026,
            status: 'CLOSED',
          }),
          makeInvoice({
            id: 'i-closed2',
            month: 7,
            year: 2026,
            status: 'CLOSED',
          }),
        ],
        transactions: [root, child],
      }),
    );
  }

  it('exige confirmação explícita antes de mover para fatura fechada', async () => {
    const harness = closedHarness();

    await expect(
      harness.service.update('tx-root', USER_ID, {
        date: '2026-06-01',
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CLOSED_INVOICE_REASSIGNMENT',
      }),
    });
  });

  it('prossegue quando o usuário confirma', async () => {
    const harness = closedHarness();

    await expect(
      harness.service.update('tx-root', USER_ID, {
        date: '2026-06-01',
        confirmReopenClosedInvoice: true,
      } as any),
    ).resolves.toBeDefined();
  });

  it('bloqueia sem alternativa quando a fatura de destino está paga', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [
          makeInvoice({ id: 'i-open', month: 8, year: 2026, status: 'OPEN' }),
          makeInvoice({ id: 'i-paid', month: 6, year: 2026, status: 'PAID' }),
        ],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Notebook 1/2',
            invoiceId: 'i-open',
            date: utcDate(2026, 8, 1),
          }),
          makeTransaction({
            id: 'tx-child',
            parentId: 'tx-root',
            title: 'Notebook 2/2',
            invoiceId: 'i-open',
            date: utcDate(2026, 8, 1),
          }),
        ],
      }),
    );

    await expect(
      harness.service.update('tx-root', USER_ID, {
        date: '2026-06-01',
        confirmReopenClosedInvoice: true,
      } as any),
    ).rejects.toThrow(/faturas afetadas já está paga/);
  });

  it('a confirmação não vaza para o update do Prisma', async () => {
    // `confirmReopenClosedInvoice` é um sinal de protocolo, não um campo do
    // modelo — se chegasse ao banco, o Prisma quebraria.
    const harness = closedHarness();

    await harness.service.update('tx-root', USER_ID, {
      date: '2026-06-01',
      confirmReopenClosedInvoice: true,
    } as any);

    for (const update of harness.updates.transactions) {
      expect(update.data).not.toHaveProperty('confirmReopenClosedInvoice');
    }
  });
});

describe('TransactionsService.update — sincronização do recebível', () => {
  function withReceivable(
    receivableOverrides: Parameters<typeof makeReceivable>[0] = {},
  ) {
    return buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', month: 8, year: 2026 })],
        transactions: [
          makeTransaction({
            id: 'tx-1',
            personId: 'person-1',
            amount: money(300),
            invoiceId: 'invoice-1',
          }),
        ],
        receivables: [
          makeReceivable({
            id: 'rec-1',
            transactionId: 'tx-1',
            amount: money(300),
            ...receivableOverrides,
          }),
        ],
      }),
    );
  }

  it('cria o recebível quando a pessoa é adicionada depois', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', month: 8, year: 2026 })],
        transactions: [
          makeTransaction({
            id: 'tx-1',
            personId: null,
            invoiceId: 'invoice-1',
          }),
        ],
      }),
    );

    await harness.service.update('tx-1', USER_ID, {
      personId: 'person-1',
    } as any);

    expect(harness.created.receivables).toHaveLength(1);
    expect(harness.created.receivables[0].transactionId).toBe('tx-1');
  });

  it('remove o recebível quando a pessoa é retirada', async () => {
    const harness = withReceivable();

    await harness.service.update('tx-1', USER_ID, { personId: null } as any);

    expect(harness.deletes.receivables).toContain('rec-1');
  });

  it('remove o recebível quando a transação deixa de ser cartão', async () => {
    const harness = withReceivable();

    await harness.service.update('tx-1', USER_ID, {
      type: 'PIX',
      personId: null,
    } as any);

    expect(harness.deletes.receivables).toContain('rec-1');
  });

  it('recusa transformar em estorno uma compra que tem pessoa', async () => {
    // Antes isso apagava a cobrança em silêncio. A combinação estorno + pessoa
    // é recusada desde a Fase 5C: para virar estorno, a pessoa sai primeiro.
    const harness = withReceivable();

    await expect(
      harness.service.update('tx-1', USER_ID, { isRefund: true } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REFUND_PERSON_NOT_SUPPORTED',
      }),
    });
  });

  it('remove o recebível ao virar estorno e desvincular a pessoa juntos', async () => {
    const harness = withReceivable();

    await harness.service.update('tx-1', USER_ID, {
      isRefund: true,
      personId: null,
    } as any);

    expect(harness.deletes.receivables).toContain('rec-1');
  });

  it('sincroniza o valor de um recebível ainda pendente', async () => {
    const harness = withReceivable();

    await harness.service.update('tx-1', USER_ID, { amount: 250 } as any);

    const update = harness.updates.receivables.find((u) => u.id === 'rec-1');
    expect(Number(update?.data.amount)).toBe(250);
  });

  it('sincroniza o título de um recebível ainda pendente', async () => {
    const harness = withReceivable();

    await harness.service.update('tx-1', USER_ID, {
      title: 'Ingresso corrigido',
    } as any);

    const update = harness.updates.receivables.find((u) => u.id === 'rec-1');
    expect(update?.data.title).toBe('Ingresso corrigido');
  });

  it('troca de pessoa atualiza o vínculo e o nome do devedor', async () => {
    // Comportamento real documentado: o mesmo recebível é reaproveitado,
    // apontando para a nova pessoa — não há exclusão e recriação.
    const harness = withReceivable();

    await harness.service.update('tx-1', USER_ID, {
      personId: 'person-2',
    } as any);

    const update = harness.updates.receivables.find((u) => u.id === 'rec-1');
    expect(update?.data.personId).toBe('person-2');
    expect(update?.data.debtorName).toBe('Breno');
    expect(harness.deletes.receivables).not.toContain('rec-1');
  });
});

describe('TransactionsService.remove — cascatas', () => {
  it('apaga o recebível vinculado junto da transação', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({
            id: 'tx-1',
            personId: 'person-1',
            amount: money(300),
          }),
        ],
        receivables: [makeReceivable({ id: 'rec-1', transactionId: 'tx-1' })],
      }),
    );

    await harness.service.remove('tx-1', USER_ID);

    expect(harness.deletes.receivables).toContain('rec-1');
    expect(harness.deletes.transactions).toContain('tx-1');
  });

  it('devolve o valor à fatura ao excluir', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(500) })],
        transactions: [makeTransaction({ id: 'tx-1', amount: money(200) })],
      }),
    );

    await harness.service.remove('tx-1', USER_ID);

    expect(Number(harness.state.invoices[0]?.totalAmount ?? 0)).toBe(300);
  });

  it('apaga a fatura quando ela fica zerada', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(200) })],
        transactions: [makeTransaction({ id: 'tx-1', amount: money(200) })],
      }),
    );

    await harness.service.remove('tx-1', USER_ID);

    expect(harness.deletes.invoices).toContain('invoice-1');
  });

  it('excluir estorno devolve o valor somando na fatura', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(400) })],
        transactions: [
          makeTransaction({ id: 'tx-1', amount: money(100), isRefund: true }),
        ],
      }),
    );

    await harness.service.remove('tx-1', USER_ID);

    expect(Number(harness.state.invoices[0].totalAmount)).toBe(500);
  });

  it('scope ONE remove apenas a parcela indicada', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Curso 1/3',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Curso 2/3',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-3',
            parentId: 'tx-root',
            title: 'Curso 3/3',
            amount: money(100),
          }),
        ],
      }),
    );

    await harness.service.remove('tx-2', USER_ID, 'ONE');

    expect(harness.deletes.transactions).toEqual(['tx-2']);
  });

  it('scope ALL remove a série inteira', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Curso 1/3',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Curso 2/3',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-3',
            parentId: 'tx-root',
            title: 'Curso 3/3',
            amount: money(100),
          }),
        ],
      }),
    );

    await harness.service.remove('tx-2', USER_ID, 'ALL');

    // `arrayContaining(['tx-2','tx-3'])` era o que estava aqui, e passava com
    // ou sem a raiz — foi por isso que a suíte não flagrou `ALL` deixando a
    // primeira parcela para trás. A comparação agora é exata.
    expect([...harness.deletes.transactions].sort()).toEqual([
      'tx-2',
      'tx-3',
      'tx-root',
    ]);
  });

  it('scope NEXT remove desta parcela em diante, preservando as anteriores', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Curso 1/3',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Curso 2/3',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-3',
            parentId: 'tx-root',
            title: 'Curso 3/3',
            amount: money(100),
          }),
        ],
      }),
    );

    await harness.service.remove('tx-2', USER_ID, 'NEXT');

    expect([...harness.deletes.transactions].sort()).toEqual(['tx-2', 'tx-3']);
  });

  it('ALL a partir da raiz remove a mesma série que ALL a partir de uma filha', async () => {
    // O escopo descreve a série, não o ponto de entrada. Antes, entrar pela
    // raiz devolvia só ela (o seletor exigia `parentId`), então excluir "todas"
    // da primeira parcela apagava exatamente uma.
    const seriesState = () =>
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Curso 1/3',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Curso 2/3',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-3',
            parentId: 'tx-root',
            title: 'Curso 3/3',
            amount: money(100),
          }),
        ],
      });

    const fromRoot = buildHarness(seriesState());
    await fromRoot.service.remove('tx-root', USER_ID, 'ALL');

    const fromChild = buildHarness(seriesState());
    await fromChild.service.remove('tx-3', USER_ID, 'ALL');

    expect([...fromRoot.deletes.transactions].sort()).toEqual([
      'tx-2',
      'tx-3',
      'tx-root',
    ]);
    expect([...fromChild.deletes.transactions].sort()).toEqual(
      [...fromRoot.deletes.transactions].sort(),
    );
  });

  it('ONE na raiz remove apenas a raiz, não a série', async () => {
    // O contrapeso do teste acima: corrigir ALL não pode ter transformado a
    // raiz num gatilho de exclusão em cascata.
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Curso 1/3',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Curso 2/3',
            amount: money(100),
          }),
        ],
      }),
    );

    await harness.service.remove('tx-root', USER_ID, 'ONE');

    expect(harness.deletes.transactions).toEqual(['tx-root']);
  });

  it('transação à vista ignora o escopo: ALL não vira exclusão em massa', async () => {
    // Uma compra sem série não tem `parentId` nem filhas. Se o seletor
    // resolvesse a "série" pelo próprio id sem checar o tamanho, ALL numa
    // compra isolada poderia varrer registros vizinhos.
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({ id: 'tx-avulsa', amount: money(100) }),
          makeTransaction({ id: 'tx-outra', amount: money(200) }),
        ],
      }),
    );

    await harness.service.remove('tx-avulsa', USER_ID, 'ALL');

    expect(harness.deletes.transactions).toEqual(['tx-avulsa']);
  });

  it('scope inválido é tratado como ONE', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Curso 1/2',
            amount: money(100),
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Curso 2/2',
            amount: money(100),
          }),
        ],
      }),
    );

    await harness.service.remove('tx-2', USER_ID, 'QUALQUER_COISA');

    expect(harness.deletes.transactions).toEqual(['tx-2']);
  });
});
