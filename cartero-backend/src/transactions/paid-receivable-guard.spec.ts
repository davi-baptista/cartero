import { ConflictException } from '@nestjs/common';
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
 * Correções de integridade da Fase 2B, lado das transações:
 *
 * • Crítico A — uma compra cujo A Receber automático já foi recebido não pode
 *   ter os dados financeiros alterados nem ser excluída. Antes, editar o valor
 *   reescrevia o recebível e deixava a transação de recebimento com outro
 *   valor; excluir apagava o recebível e deixava o recebimento órfão.
 *
 * • Crítico B — quando a compra muda de fatura, o vencimento do recebível
 *   acompanha a nova fatura. Antes ficava preso ao mês antigo.
 */

interface DbState {
  bank: ReturnType<typeof makeBank>;
  invoices: ReturnType<typeof makeInvoice>[];
  transactions: ReturnType<typeof makeTransaction>[];
  receivables: ReturnType<typeof makeReceivable>[];
  person: ReturnType<typeof makePerson>;
  /** Dívidas cujo pagamento aponta para alguma transação do estado. */
  debts?: { id: string; paymentTransactionId: string | null }[];
}

function buildHarness(state: DbState) {
  const created = { transactions: [] as any[], receivables: [] as any[] };
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

  let recSeq = 0;

  const findInvoice = (where: any) =>
    state.invoices.find(
      (invoice) =>
        (where.id === undefined || invoice.id === where.id) &&
        (where.month === undefined || invoice.month === where.month) &&
        (where.year === undefined || invoice.year === where.year) &&
        (where.bankId === undefined || invoice.bankId === where.bankId),
    ) ?? null;

  const findPaidReceivable = (where: any) => {
    const ids: string[] = where.transactionId?.in ?? [];
    return (
      state.receivables.find(
        (rec) =>
          ids.includes(rec.transactionId as string) &&
          (where.isPaid === undefined || rec.isPaid === where.isPaid),
      ) ?? null
    );
  };

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
      update: vi.fn(async ({ where, data }: any) => {
        updates.transactions.push({ id: where.id, data });
        const index = state.transactions.findIndex(
          (item) => item.id === where.id,
        );
        const updated = { ...state.transactions[index] };
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
      findFirst: vi.fn(async ({ where }: any) => {
        // Duas consultas diferentes usam findFirst: a guarda do recebível pago
        // (por `transactionId`) e a de transação-pagamento (por
        // `paymentTransactionId`).
        if (where.paymentTransactionId?.in) {
          const ids: string[] = where.paymentTransactionId.in;
          return (
            state.receivables.find((rec) =>
              ids.includes(rec.paymentTransactionId as string),
            ) ?? null
          );
        }
        return findPaidReceivable(where);
      }),
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

  (client as any).debt = {
    findFirst: vi.fn(async ({ where }: any) => {
      const ids: string[] = where.paymentTransactionId?.in ?? [];
      return (
        (state.debts ?? []).find((debt) =>
          ids.includes(debt.paymentTransactionId as string),
        ) ?? null
      );
    }),
  };

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

/** Compra de 300 para Eva com o recebível espelho já recebido. */
function paidReceivableHarness() {
  return buildHarness(
    baseState({
      invoices: [
        makeInvoice({ id: 'invoice-1', month: 8, year: 2026 }),
        makeInvoice({ id: 'invoice-oct', month: 10, year: 2026 }),
      ],
      transactions: [
        makeTransaction({
          id: 'tx-1',
          personId: 'person-1',
          amount: money(300),
          invoiceId: 'invoice-1',
          date: utcDate(2026, 8, 1),
        }),
      ],
      receivables: [
        makeReceivable({
          id: 'rec-1',
          transactionId: 'tx-1',
          amount: money(300),
          isPaid: true,
          paidAt: utcDate(2026, 8, 12),
          paymentTransactionId: 'tx-payment',
        }),
      ],
    }),
  );
}

const alreadyPaid = {
  response: expect.objectContaining({ code: 'RECEIVABLE_ALREADY_PAID' }),
};

describe('Crítico A — edição de compra com recebível já recebido', () => {
  it('recusa alterar o valor', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { amount: 250 } as any),
    ).rejects.toMatchObject(alreadyPaid);
  });

  it('responde 409 Conflict', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { amount: 250 } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a mensagem explica como proceder', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { amount: 250 } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('Desfaça o recebimento'),
      }),
    });
  });

  it('recusa trocar a pessoa', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { personId: 'person-2' } as any),
    ).rejects.toMatchObject(alreadyPaid);
  });

  it('recusa desvincular a pessoa — apagaria o recebível pago', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { personId: null } as any),
    ).rejects.toMatchObject(alreadyPaid);
  });

  it('recusa mudar o tipo', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { type: 'PIX' } as any),
    ).rejects.toMatchObject(alreadyPaid);
  });

  it('recusa transformar em estorno', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { isRefund: true } as any),
    ).rejects.toMatchObject(alreadyPaid);
  });

  it('recusa mudar a data — moveria a fatura e o vencimento', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { date: '2026-10-01' } as any),
    ).rejects.toMatchObject(alreadyPaid);
  });

  it('recusa trocar o banco', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { bankId: 'bank-2' } as any),
    ).rejects.toMatchObject(alreadyPaid);
  });

  it('nenhuma escrita acontece quando a guarda dispara', async () => {
    // A verificação roda antes de tocar em fatura, transação ou recebível.
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { amount: 250 } as any),
    ).rejects.toThrow();

    expect(harness.updates.transactions).toHaveLength(0);
    expect(harness.updates.receivables).toHaveLength(0);
    expect(harness.updates.invoices).toHaveLength(0);
    expect(Number(harness.state.receivables[0].amount)).toBe(300);
  });
});

describe('Crítico A — alterações descritivas continuam permitidas', () => {
  /**
   * Decisão registrada: título, descrição e categoria são texto e não alteram
   * fato financeiro. O título segue sincronizado com o recebível — corrigir o
   * nome da compra deve refletir na cobrança que a pessoa vê.
   */
  it('permite corrigir o título e propaga para o recebível', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, {
        title: 'Ingresso (corrigido)',
      } as any),
    ).resolves.toBeDefined();

    const update = harness.updates.receivables.find((u) => u.id === 'rec-1');
    expect(update?.data.title).toBe('Ingresso (corrigido)');
  });

  it('permite corrigir a descrição', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, {
        description: 'pago via PIX',
      } as any),
    ).resolves.toBeDefined();
  });

  it('permite trocar a categoria', async () => {
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, { categoryId: 'cat-2' } as any),
    ).resolves.toBeDefined();
  });

  it('os fatos financeiros do recebível permanecem intactos', async () => {
    const harness = paidReceivableHarness();

    await harness.service.update('tx-1', USER_ID, {
      title: 'Novo título',
    } as any);

    const receivable = harness.state.receivables[0];
    expect(Number(receivable.amount)).toBe(300);
    expect(receivable.isPaid).toBe(true);
    expect(receivable.paidAt).toEqual(utcDate(2026, 8, 12));
    expect(receivable.paymentTransactionId).toBe('tx-payment');
    expect(receivable.dueDate.getUTCMonth() + 1).toBe(8);
  });
});

describe('Crítico A — a guarda não excede o necessário', () => {
  it('não bloqueia quando o recebível ainda está pendente', async () => {
    const harness = buildHarness(
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
            isPaid: false,
          }),
        ],
      }),
    );

    await expect(
      harness.service.update('tx-1', USER_ID, { amount: 250 } as any),
    ).resolves.toBeDefined();
  });

  it('não bloqueia uma compra sem pessoa vinculada', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', month: 8, year: 2026 })],
        transactions: [makeTransaction({ id: 'tx-1', amount: money(300) })],
      }),
    );

    await expect(
      harness.service.update('tx-1', USER_ID, { amount: 250 } as any),
    ).resolves.toBeDefined();
  });

  it('não bloqueia quando o valor enviado é igual ao atual', async () => {
    // O frontend reenvia o payload inteiro; repetir o mesmo valor não é
    // alteração financeira e não deve travar uma correção de texto.
    const harness = paidReceivableHarness();

    await expect(
      harness.service.update('tx-1', USER_ID, {
        amount: 300,
        title: 'Mesmo valor',
      } as any),
    ).resolves.toBeDefined();
  });

  it('bloqueia quando a parcela recebida está no escopo da edição', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', month: 8, year: 2026 })],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Ingresso 1/2',
            personId: 'person-1',
            amount: money(150),
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Ingresso 2/2',
            personId: 'person-1',
            amount: money(150),
          }),
        ],
        receivables: [
          makeReceivable({
            id: 'rec-2',
            transactionId: 'tx-2',
            isPaid: true,
            paymentTransactionId: 'tx-payment',
          }),
        ],
      }),
    );

    await expect(
      harness.service.update('tx-2', USER_ID, { amount: 100 } as any, 'ALL'),
    ).rejects.toMatchObject(alreadyPaid);
  });

  it('não bloqueia parcela fora do escopo quando só a outra foi recebida', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', month: 8, year: 2026 })],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Ingresso 1/2',
            personId: 'person-1',
            amount: money(150),
            invoiceId: 'invoice-1',
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Ingresso 2/2',
            personId: 'person-1',
            amount: money(150),
            invoiceId: 'invoice-1',
          }),
        ],
        receivables: [
          makeReceivable({ id: 'rec-1', transactionId: 'tx-root' }),
          makeReceivable({
            id: 'rec-2',
            transactionId: 'tx-2',
            isPaid: true,
            paymentTransactionId: 'tx-payment',
          }),
        ],
      }),
    );

    await expect(
      harness.service.update('tx-root', USER_ID, { amount: 100 } as any, 'ONE'),
    ).resolves.toBeDefined();
  });
});

describe('Crítico A — exclusão de compra com recebível já recebido', () => {
  /**
   * Auditoria pedida nesta fase: `remove` apaga o recebível vinculado em
   * cascata. Se ele já tinha sido recebido, a transação de recebimento ficaria
   * órfã — entrada de dinheiro sem origem, e sem como desfazer o recebimento,
   * já que o registro que o controlava teria sumido.
   */
  function harnessWithPaidReceivable() {
    return buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({
            id: 'tx-1',
            personId: 'person-1',
            amount: money(300),
          }),
        ],
        receivables: [
          makeReceivable({
            id: 'rec-1',
            transactionId: 'tx-1',
            isPaid: true,
            paymentTransactionId: 'tx-payment',
          }),
        ],
      }),
    );
  }

  it('recusa excluir a compra', async () => {
    const harness = harnessWithPaidReceivable();

    await expect(harness.service.remove('tx-1', USER_ID)).rejects.toMatchObject(
      alreadyPaid,
    );
  });

  it('nada é apagado quando a guarda dispara', async () => {
    const harness = harnessWithPaidReceivable();

    await expect(harness.service.remove('tx-1', USER_ID)).rejects.toThrow();

    expect(harness.deletes.transactions).toHaveLength(0);
    expect(harness.deletes.receivables).toHaveLength(0);
    expect(harness.updates.invoices).toHaveLength(0);
  });

  it('permite excluir quando o recebível ainda está pendente', async () => {
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
        receivables: [
          makeReceivable({ id: 'rec-1', transactionId: 'tx-1', isPaid: false }),
        ],
      }),
    );

    await harness.service.remove('tx-1', USER_ID);

    expect(harness.deletes.receivables).toContain('rec-1');
    expect(harness.deletes.transactions).toContain('tx-1');
  });

  it('bloqueia a série inteira quando uma parcela já foi recebida', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(300) })],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Ingresso 1/2',
            personId: 'person-1',
            amount: money(150),
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Ingresso 2/2',
            personId: 'person-1',
            amount: money(150),
          }),
        ],
        receivables: [
          makeReceivable({
            id: 'rec-2',
            transactionId: 'tx-2',
            isPaid: true,
            paymentTransactionId: 'tx-payment',
          }),
        ],
      }),
    );

    await expect(
      harness.service.remove('tx-2', USER_ID, 'ALL'),
    ).rejects.toMatchObject(alreadyPaid);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * isPaid órfão — terceiro caminho, descoberto na Fase 2B
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Uma transação pode SER o pagamento de uma dívida ou o recebimento de uma
 * cobrança (`Debt.paymentTransactionId` / `Receivable.paymentTransactionId`).
 * Os dois FKs são `ON DELETE SET NULL`: excluir essa transação pelo Extrato
 * não dava erro — apenas zerava o vínculo e deixava o registro `isPaid = true`
 * sem nada que comprovasse o pagamento, e sem como desfazê-lo.
 *
 * O caminho correto é desmarcar o pagamento na tela de Dívidas ou A Receber,
 * que apaga a transação e limpa `isPaid` na mesma operação.
 */
describe('isPaid órfão — transação que registra um pagamento', () => {
  it('recusa excluir a transação que paga uma dívida', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(200) })],
        transactions: [
          makeTransaction({ id: 'tx-pay', amount: money(200), personId: null }),
        ],
        debts: [{ id: 'debt-1', paymentTransactionId: 'tx-pay' }],
      }),
    );

    await expect(
      harness.service.remove('tx-pay', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_TRANSACTION_LINKED' }),
    });
  });

  it('recusa excluir a transação que registra um recebimento', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(150) })],
        transactions: [
          makeTransaction({ id: 'tx-pay', amount: money(150), personId: null }),
        ],
        receivables: [
          makeReceivable({
            id: 'rec-1',
            transactionId: null,
            paymentTransactionId: 'tx-pay',
            isPaid: true,
          }),
        ],
      }),
    );

    await expect(
      harness.service.remove('tx-pay', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_TRANSACTION_LINKED' }),
    });
  });

  it('a mensagem indica desmarcar o pagamento', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(200) })],
        transactions: [
          makeTransaction({ id: 'tx-pay', amount: money(200), personId: null }),
        ],
        debts: [{ id: 'debt-1', paymentTransactionId: 'tx-pay' }],
      }),
    );

    await expect(
      harness.service.remove('tx-pay', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('Desmarque'),
      }),
    });
  });

  it('nada é apagado quando a guarda dispara', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(200) })],
        transactions: [
          makeTransaction({ id: 'tx-pay', amount: money(200), personId: null }),
        ],
        debts: [{ id: 'debt-1', paymentTransactionId: 'tx-pay' }],
      }),
    );

    await expect(harness.service.remove('tx-pay', USER_ID)).rejects.toThrow();

    expect(harness.deletes.transactions).toHaveLength(0);
    expect(harness.updates.invoices).toHaveLength(0);
  });

  it('uma transação comum continua sendo excluível', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [makeInvoice({ id: 'invoice-1', totalAmount: money(200) })],
        transactions: [
          makeTransaction({ id: 'tx-1', amount: money(200), personId: null }),
        ],
        debts: [{ id: 'debt-1', paymentTransactionId: 'outra-tx' }],
      }),
    );

    await harness.service.remove('tx-1', USER_ID);

    expect(harness.deletes.transactions).toContain('tx-1');
  });
});

describe('Crítico B — vencimento do recebível segue a fatura', () => {
  function harnessAcrossInvoices() {
    return buildHarness(
      baseState({
        invoices: [
          makeInvoice({
            id: 'invoice-aug',
            month: 8,
            year: 2026,
            totalAmount: money(300),
          }),
        ],
        transactions: [
          makeTransaction({
            id: 'tx-1',
            personId: 'person-1',
            amount: money(300),
            invoiceId: 'invoice-aug',
            date: utcDate(2026, 8, 1),
          }),
        ],
        receivables: [
          makeReceivable({
            id: 'rec-1',
            transactionId: 'tx-1',
            amount: money(300),
            dueDate: utcDate(2026, 8, 10, 3),
          }),
        ],
      }),
    );
  }

  it('mover a compra para outra fatura atualiza o vencimento', async () => {
    const harness = harnessAcrossInvoices();

    await harness.service.update('tx-1', USER_ID, {
      date: '2026-10-01',
    } as any);

    const dueDate = harness.state.receivables[0].dueDate;
    expect(dueDate.getUTCMonth() + 1).toBe(10);
    expect(dueDate.getUTCDate()).toBe(harness.state.bank.invoiceDueDate);
  });

  it('o novo vencimento é exatamente o da fatura de destino', async () => {
    const harness = harnessAcrossInvoices();

    await harness.service.update('tx-1', USER_ID, {
      date: '2026-10-01',
    } as any);

    const transaction = harness.state.transactions[0];
    const invoice = harness.state.invoices.find(
      (item) => item.id === transaction.invoiceId,
    )!;
    const dueDate = harness.state.receivables[0].dueDate;

    expect(dueDate.getUTCFullYear()).toBe(invoice.year);
    expect(dueDate.getUTCMonth() + 1).toBe(invoice.month);
  });

  it('atravessa a virada de ano', async () => {
    const harness = harnessAcrossInvoices();

    // O banco vence dia 10 e fecha dia 3: uma compra em 05/01/2027 já passou
    // do fechamento de janeiro, então cai na fatura de fevereiro/2027 — e o
    // vencimento do recebível acompanha essa fatura.
    await harness.service.update('tx-1', USER_ID, {
      date: '2027-01-05',
    } as any);

    const transaction = harness.state.transactions[0];
    const invoice = harness.state.invoices.find(
      (item) => item.id === transaction.invoiceId,
    )!;
    const dueDate = harness.state.receivables[0].dueDate;

    expect(invoice.year).toBe(2027);
    expect(dueDate.getUTCFullYear()).toBe(2027);
    expect(dueDate.getUTCMonth() + 1).toBe(invoice.month);
  });

  it('não mexe no vencimento quando a fatura não muda', async () => {
    const harness = harnessAcrossInvoices();
    const before = harness.state.receivables[0].dueDate.toISOString();

    await harness.service.update('tx-1', USER_ID, { amount: 250 } as any);

    expect(harness.state.receivables[0].dueDate.toISOString()).toBe(before);
  });

  it('cada parcela recebe o vencimento da sua própria fatura', async () => {
    const harness = buildHarness(
      baseState({
        invoices: [
          makeInvoice({ id: 'i-aug', month: 8, year: 2026 }),
          makeInvoice({ id: 'i-sep', month: 9, year: 2026 }),
        ],
        transactions: [
          makeTransaction({
            id: 'tx-root',
            title: 'Ingresso 1/2',
            personId: 'person-1',
            amount: money(150),
            invoiceId: 'i-aug',
            date: utcDate(2026, 8, 1),
          }),
          makeTransaction({
            id: 'tx-2',
            parentId: 'tx-root',
            title: 'Ingresso 2/2',
            personId: 'person-1',
            amount: money(150),
            invoiceId: 'i-sep',
            date: utcDate(2026, 8, 1),
          }),
        ],
        receivables: [
          makeReceivable({
            id: 'rec-1',
            transactionId: 'tx-root',
            dueDate: utcDate(2026, 8, 10, 3),
          }),
          makeReceivable({
            id: 'rec-2',
            transactionId: 'tx-2',
            dueDate: utcDate(2026, 9, 10, 3),
          }),
        ],
      }),
    );

    // Move a série para novembro: as parcelas passam a nov e dez.
    await harness.service.update('tx-root', USER_ID, {
      date: '2026-11-01',
    } as any);

    const months = harness.state.receivables
      .map((rec) => rec.dueDate.getUTCMonth() + 1)
      .sort((a, b) => a - b);

    expect(months).toEqual([11, 12]);
  });

  it('um recebível recém-criado nasce com o vencimento da fatura', async () => {
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

    const dueDate = harness.created.receivables[0].dueDate as Date;
    expect(dueDate.getUTCMonth() + 1).toBe(8);
    expect(dueDate.getUTCDate()).toBe(harness.state.bank.invoiceDueDate);
  });
});
