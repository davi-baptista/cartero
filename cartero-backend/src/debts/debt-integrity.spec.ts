import { describe, expect, it, vi } from 'vitest';
import { DebtsService } from './debts.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Integridade de Dívidas (Fase 8A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Uma dívida paga é fato concluído. Alterar o valor depois deixava o
 * comprovante apontando para outro número: a dívida dizia R$ 100 e a transação
 * de pagamento dizia R$ 500, sem nada reconciliando.
 *
 * Um invariante que NÃO existe e não deve ser inventado: `isPaid = true` não
 * implica `paymentTransactionId != null`. Com `createExpenseOnDebtPaid`
 * desligado, a dívida é marcada como paga sem gerar transação — e isso é
 * comportamento legítimo, escolhido pelo usuário.
 */

interface Setup {
  debt?: Record<string, unknown>;
  /** Preferência do usuário: gerar despesa ao pagar. */
  createExpenseOnDebtPaid?: boolean;
  failDebtUpdate?: boolean;
}

function buildHarness(setup: Setup = {}) {
  const writes = {
    debtUpdates: [] as any[],
    transactionCreates: [] as any[],
    transactionDeletes: [] as any[],
    debtDeletes: [] as any[],
  };

  const debt = setup.debt ?? {
    id: 'debt-1',
    userId: USER_ID,
    personId: null,
    parentId: null,
    paymentTransactionId: null,
    title: 'Aluguel',
    creditorName: 'Imobiliária',
    amount: money(1500),
    description: null,
    occurredAt: new Date(Date.UTC(2026, 7, 1, 12)),
    dueDate: new Date(Date.UTC(2026, 8, 10, 12)),
    isAlertEnabled: true,
    isPaid: false,
    paidAt: null,
  };

  const prisma: any = {
    debt: {
      findUnique: vi.fn(async () => debt),
      findMany: vi.fn(async () => [debt]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async ({ data }: any) => {
        if (setup.failDebtUpdate) throw new Error('falha ao gravar a dívida');
        writes.debtUpdates.push(data);
        return { ...debt, ...data };
      }),
      delete: vi.fn(async ({ where }: any) => {
        writes.debtDeletes.push(where.id);
        return debt;
      }),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        createExpenseOnDebtPaid: setup.createExpenseOnDebtPaid ?? true,
      })),
    },
    bank: { findUnique: vi.fn(async () => makeBank()) },
    category: {
      findFirst: vi.fn(async () => ({
        id: 'cat-sys',
        userId: USER_ID,
        name: 'Dívida paga',
        isSystem: true,
      })),
      create: vi.fn(async ({ data }: any) => ({ id: 'cat-sys', ...data })),
    },
    transaction: {
      findUnique: vi.fn(async () => ({
        id: 'tx-pay',
        userId: USER_ID,
        amount: money(1500),
        invoiceId: null,
      })),
      create: vi.fn(async ({ data }: any) => {
        writes.transactionCreates.push(data);
        return { id: 'tx-new', ...data };
      }),
      delete: vi.fn(async ({ where }: any) => {
        writes.transactionDeletes.push(where.id);
        return { id: where.id };
      }),
    },
    invoice: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(),
      update: vi.fn(async () => ({ totalAmount: money(0) })),
      delete: vi.fn(),
    },
    person: { findUnique: vi.fn(async () => ({ id: 'p1', name: 'Ana' })) },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

  const validation = new EntityValidationService(prisma as PrismaService);

  return {
    service: new DebtsService(prisma as PrismaService, validation),
    prisma,
    writes,
    debt,
  };
}

const paidDebt = (extra: Record<string, unknown> = {}) => ({
  id: 'debt-1',
  userId: USER_ID,
  personId: null,
  parentId: null,
  paymentTransactionId: 'tx-pay',
  title: 'Aluguel',
  creditorName: 'Imobiliária',
  amount: money(1500),
  description: null,
  occurredAt: new Date(Date.UTC(2026, 7, 1, 12)),
  dueDate: new Date(Date.UTC(2026, 8, 10, 12)),
  isAlertEnabled: true,
  isPaid: true,
  paidAt: new Date(Date.UTC(2026, 8, 5, 12)),
  ...extra,
});

describe('Dívida paga — edição', () => {
  it('recusa alterar o valor', async () => {
    const harness = buildHarness({ debt: paidDebt() });

    await expect(
      harness.service.update('debt-1', USER_ID, { amount: 100 } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAID_DEBT_EDIT_BLOCKED' }),
    });

    expect(harness.writes.debtUpdates).toHaveLength(0);
  });

  it('recusa trocar a contraparte', async () => {
    const harness = buildHarness({ debt: paidDebt() });

    await expect(
      harness.service.update('debt-1', USER_ID, {
        creditorName: 'Outro credor',
      } as any),
    ).rejects.toThrow();
  });

  it('recusa mudar o vencimento', async () => {
    const harness = buildHarness({ debt: paidDebt() });

    await expect(
      harness.service.update('debt-1', USER_ID, {
        dueDate: '2026-12-01',
      } as any),
    ).rejects.toThrow();
  });

  it('a mensagem orienta desfazer o pagamento', async () => {
    const harness = buildHarness({ debt: paidDebt() });

    await expect(
      harness.service.update('debt-1', USER_ID, { amount: 100 } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/[Dd]esfaça o pagamento/),
      }),
    });
  });

  it('permite alteração descritiva', async () => {
    const harness = buildHarness({ debt: paidDebt() });

    await harness.service.update('debt-1', USER_ID, {
      description: 'pago via transferência',
    } as any);

    expect(harness.writes.debtUpdates).toHaveLength(1);
  });

  it('dívida PENDENTE aceita qualquer alteração', async () => {
    const harness = buildHarness();

    await harness.service.update('debt-1', USER_ID, { amount: 2000 } as any);

    expect(harness.writes.debtUpdates).toHaveLength(1);
  });
});

describe('createExpenseOnDebtPaid', () => {
  it('habilitada: pagar cria a transação e vincula', async () => {
    const harness = buildHarness({ createExpenseOnDebtPaid: true });

    await harness.service.update('debt-1', USER_ID, {
      isPaid: true,
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(harness.writes.transactionCreates).toHaveLength(1);
    expect(harness.writes.debtUpdates[0].paymentTransactionId).toBe('tx-new');
  });

  it('desabilitada: paga SEM transação é estado legítimo', async () => {
    /**
     * `isPaid = true` sem `paymentTransactionId` não é órfão — é a
     * preferência do usuário. Inventar esse invariante quebraria o fluxo de
     * quem não quer que dívidas paguem virem lançamento.
     */
    const harness = buildHarness({ createExpenseOnDebtPaid: false });

    await harness.service.update('debt-1', USER_ID, { isPaid: true } as any);

    expect(harness.writes.transactionCreates).toHaveLength(0);
    expect(harness.writes.debtUpdates[0].paymentTransactionId).toBeNull();
  });

  it('desabilitada: não exige banco nem forma de pagamento', async () => {
    // Sem transação a criar, pedir banco seria atrito sem propósito.
    const harness = buildHarness({ createExpenseOnDebtPaid: false });

    await expect(
      harness.service.update('debt-1', USER_ID, { isPaid: true } as any),
    ).resolves.toBeDefined();
  });

  it('habilitada: exige banco e forma', async () => {
    const harness = buildHarness({ createExpenseOnDebtPaid: true });

    await expect(
      harness.service.update('debt-1', USER_ID, { isPaid: true } as any),
    ).rejects.toThrow(/paymentBankId/);
  });
});

describe('Data do pagamento', () => {
  it('honra paymentDate em paidAt e no comprovante', async () => {
    /**
     * `UpdateDebtDto` não tinha `paymentDate`. O `MarkAsPaidDialog` é
     * compartilhado com Recebíveis e sempre pediu a data, mas sem o campo no
     * DTO o `ValidationPipe` (`whitelist: true`) a descartava em silêncio e o
     * serviço gravava `new Date()` — então registrar hoje um pagamento feito
     * na semana passada gravava hoje. A mesma ação respeitava a data quando o
     * item era uma cobrança.
     */
    const harness = buildHarness();

    await harness.service.update('debt-1', USER_ID, {
      isPaid: true,
      paymentDate: '2026-08-10',
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    const paidAt = harness.writes.debtUpdates[0].paidAt as Date;
    expect(paidAt.toISOString().slice(0, 10)).toBe('2026-08-10');

    // A dívida e o comprovante não podem discordar sobre quando o dinheiro saiu.
    const txDate = harness.writes.transactionCreates[0].date as Date;
    expect(txDate.getTime()).toBe(paidAt.getTime());
  });

  it('sem paymentDate, usa a data de hoje', async () => {
    const harness = buildHarness();

    await harness.service.update('debt-1', USER_ID, {
      isPaid: true,
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(harness.writes.debtUpdates[0].paidAt).toBeInstanceOf(Date);
  });

  it('paymentDate NÃO é gravada como coluna da dívida', async () => {
    // É instrução de pagamento, não campo de Debt: deixá-la no objeto de
    // update faria o Prisma tentar gravar uma coluna que não existe.
    const harness = buildHarness();

    await harness.service.update('debt-1', USER_ID, {
      isPaid: true,
      paymentDate: '2026-08-10',
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(harness.writes.debtUpdates[0]).not.toHaveProperty('paymentDate');
    expect(harness.writes.debtUpdates[0]).not.toHaveProperty('paymentBankId');
    expect(harness.writes.debtUpdates[0]).not.toHaveProperty('paymentType');
  });
});

describe('Desfazer pagamento', () => {
  it('reabre a dívida e remove a transação', async () => {
    const harness = buildHarness({ debt: paidDebt() });

    await harness.service.update('debt-1', USER_ID, { isPaid: false } as any);

    expect(harness.writes.transactionDeletes).toContain('tx-pay');
    const update = harness.writes.debtUpdates.at(-1);
    expect(update.paidAt).toBeNull();
    expect(update.paymentTransactionId).toBeNull();
  });

  it('dívida paga SEM transação apenas volta a pendente', async () => {
    // Não tenta apagar transação inexistente.
    const harness = buildHarness({
      debt: paidDebt({ paymentTransactionId: null }),
    });

    await harness.service.update('debt-1', USER_ID, { isPaid: false } as any);

    expect(harness.writes.transactionDeletes).toHaveLength(0);
    expect(harness.writes.debtUpdates.at(-1).paidAt).toBeNull();
  });
});

describe('Atomicidade do pagamento', () => {
  it('falha ao gravar a dívida desfaz a transação criada', async () => {
    /**
     * A transação de despesa e a marcação da dívida vivem no mesmo
     * `$transaction`. Se a segunda falha, a primeira não pode sobreviver —
     * senão haveria uma despesa no extrato sem nada que a explique.
     */
    const harness = buildHarness({ failDebtUpdate: true });

    await expect(
      harness.service.update('debt-1', USER_ID, {
        isPaid: true,
        paymentBankId: 'bank-1',
        paymentType: 'PIX',
      } as any),
    ).rejects.toThrow(/falha ao gravar/);

    expect(harness.writes.debtUpdates).toHaveLength(0);
  });

  it('o pagamento roda numa única transação de banco', async () => {
    const harness = buildHarness();

    await harness.service.update('debt-1', USER_ID, {
      isPaid: true,
      paymentBankId: 'bank-1',
      paymentType: 'PIX',
    } as any);

    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
