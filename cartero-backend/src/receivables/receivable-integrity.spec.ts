import { describe, expect, it, vi } from 'vitest';
import { ReceivablesService } from './receivables.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Integridade de A Receber (Fase 8A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A auditoria encontrou este serviço sem guarda alguma: `transactionId` não
 * era lido em `update`, e `isPaid` só servia para calcular `paidAt`. Duas
 * consequências, ambas silenciosas:
 *
 * 1. Editar o valor de uma cobrança AUTOMÁTICA divergia da compra — e
 *    `syncLinkedReceivable` sobrescrevia a edição depois, sem aviso.
 * 2. Editar o valor de uma cobrança RECEBIDA deixava a transação INCOME com o
 *    valor antigo. Cobrança e comprovante divergiam para sempre.
 *
 * O inverso — editar a compra com a cobrança recebida — já era bloqueado. A
 * proteção existia num sentido só.
 */

interface Setup {
  receivable?: Record<string, unknown>;
  /** Faz o update do receivable falhar, para testar rollback. */
  failReceivableUpdate?: boolean;
  /** Faz duas chamadas chegarem juntas à reivindicação condicional. */
  claimBarrier?: boolean;
}

function buildHarness(setup: Setup = {}) {
  const writes = {
    receivableUpdates: [] as any[],
    transactionCreates: [] as any[],
    transactionDeletes: [] as any[],
    receivableDeletes: [] as any[],
  };

  const receivable = setup.receivable ?? {
    id: 'rec-1',
    userId: USER_ID,
    personId: 'person-1',
    parentId: null,
    transactionId: null,
    paymentTransactionId: null,
    title: 'Ingresso',
    debtorName: 'Eva',
    amount: money(200),
    description: null,
    occurredAt: new Date(Date.UTC(2026, 7, 1, 12)),
    dueDate: new Date(Date.UTC(2026, 8, 10, 12)),
    isPaid: false,
    paidAt: null,
  };
  let claimers = 0;
  let releaseClaimers!: () => void;
  const claimBarrier = setup.claimBarrier
    ? new Promise<void>((resolve) => {
        releaseClaimers = resolve;
      })
    : null;

  const prisma: any = {
    receivable: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.userId && where.userId !== receivable.userId
          ? null
          : { ...receivable },
      ),
      findMany: vi.fn(async () => [{ ...receivable }]),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (claimBarrier) {
          claimers += 1;
          if (claimers === 2) releaseClaimers();
          await claimBarrier;
        }
        const matches =
          receivable.id === where.id &&
          receivable.userId === where.userId &&
          receivable.isPaid === where.isPaid &&
          receivable.paymentTransactionId === where.paymentTransactionId;
        if (!matches) return { count: 0 };
        Object.assign(receivable, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: any) => {
        if (setup.failReceivableUpdate) {
          throw new Error('falha ao gravar o recebível');
        }
        Object.assign(receivable, data);
        writes.receivableUpdates.push(data);
        return { ...receivable, ...data };
      }),
      delete: vi.fn(async ({ where }: any) => {
        writes.receivableDeletes.push(where.id);
        return receivable;
      }),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        createIncomeOnReceivablePaid: true,
        timeZone: 'America/Fortaleza',
      })),
    },
    bank: {
      findUnique: vi.fn(async () => makeBank()),
      findFirst: vi.fn(async () => makeBank({ isSystem: true })),
      create: vi.fn(async ({ data }: any) => makeBank(data)),
    },
    category: {
      findFirst: vi.fn(async () => ({
        id: 'cat-sys',
        userId: USER_ID,
        name: 'Receita recebida',
        isSystem: true,
      })),
      create: vi.fn(async ({ data }: any) => ({ id: 'cat-sys', ...data })),
    },
    transaction: {
      findUnique: vi.fn(async () => ({
        id: 'tx-pay',
        userId: USER_ID,
        amount: money(200),
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
    person: {
      findUnique: vi.fn(async () => ({ id: 'person-1', name: 'Eva' })),
    },
  };

  /**
   * O double propaga a exceção como o Postgres faria: nada do que o callback
   * escreveu é aplicado. É o que permite verificar rollback sem banco real.
   */
  prisma.$transaction = vi.fn(async (fn: any) => {
    const snapshot = { ...receivable };
    const writeLengths = {
      receivableUpdates: writes.receivableUpdates.length,
      transactionCreates: writes.transactionCreates.length,
      transactionDeletes: writes.transactionDeletes.length,
    };
    try {
      return await fn(prisma);
    } catch (error) {
      Object.assign(receivable, snapshot);
      writes.receivableUpdates.length = writeLengths.receivableUpdates;
      writes.transactionCreates.length = writeLengths.transactionCreates;
      writes.transactionDeletes.length = writeLengths.transactionDeletes;
      throw error;
    }
  });

  const validation = new EntityValidationService(prisma as PrismaService);

  return {
    service: new ReceivablesService(prisma as PrismaService, validation),
    prisma,
    writes,
    receivable,
  };
}

const automatic = (extra: Record<string, unknown> = {}) => ({
  id: 'rec-auto',
  userId: USER_ID,
  personId: 'person-1',
  parentId: null,
  transactionId: 'tx-origem',
  paymentTransactionId: null,
  title: 'Ingresso 1/1',
  debtorName: 'Eva',
  amount: money(200),
  description: null,
  occurredAt: new Date(Date.UTC(2026, 7, 1, 12)),
  dueDate: new Date(Date.UTC(2026, 8, 10, 12)),
  isPaid: false,
  paidAt: null,
  ...extra,
});

describe('Cobrança automática — edição direta', () => {
  it('recusa alterar o valor', async () => {
    const harness = buildHarness({ receivable: automatic() });

    await expect(
      harness.service.update('rec-auto', USER_ID, { amount: 1 } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION',
      }),
    });

    expect(harness.writes.receivableUpdates).toHaveLength(0);
  });

  it('recusa trocar a pessoa', async () => {
    const harness = buildHarness({ receivable: automatic() });

    await expect(
      harness.service.update('rec-auto', USER_ID, {
        personId: 'person-2',
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION',
      }),
    });
  });

  it('recusa mudar o vencimento', async () => {
    // O vencimento acompanha a fatura da compra enquanto pendente.
    const harness = buildHarness({ receivable: automatic() });

    await expect(
      harness.service.update('rec-auto', USER_ID, {
        dueDate: '2026-12-01',
      } as any),
    ).rejects.toThrow();
  });

  it('a mensagem aponta para a compra de origem', async () => {
    const harness = buildHarness({ receivable: automatic() });

    await expect(
      harness.service.update('rec-auto', USER_ID, { amount: 1 } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/compra de origem|Edite a compra/i),
      }),
    });
  });

  it('permite alteração descritiva', async () => {
    // Descrição não é sincronizada pela compra: editá-la não divergirá nem
    // será sobrescrita.
    const harness = buildHarness({ receivable: automatic() });

    await harness.service.update('rec-auto', USER_ID, {
      description: 'combinado por mensagem',
    } as any);

    expect(harness.writes.receivableUpdates).toHaveLength(1);
  });

  it('permite marcar como recebida', async () => {
    // Receber é o fluxo legítimo da cobrança automática.
    const harness = buildHarness({ receivable: automatic() });

    await harness.service.update('rec-auto', USER_ID, {
      isPaid: true,
    } as any);

    expect(harness.writes.receivableUpdates).toHaveLength(1);
  });
});

describe('Ocorrência de renda recorrente — snapshot', () => {
  const recurring = (extra: Record<string, unknown> = {}) => ({
    id: 'recurring-1',
    userId: USER_ID,
    personId: null,
    parentId: null,
    transactionId: null,
    paymentTransactionId: null,
    recurringIncomeRuleId: 'rule-1',
    recurringMonth: '2026-09',
    incomeClassification: 'INCOME',
    title: 'Salário',
    debtorName: 'Empresa',
    amount: money(5000),
    description: null,
    occurredAt: new Date(Date.UTC(2026, 8, 5, 12)),
    dueDate: new Date(Date.UTC(2026, 8, 5, 12)),
    isPaid: false,
    paidAt: null,
    ...extra,
  });

  it('permite editar valor e vencimento do snapshot individual', async () => {
    const harness = buildHarness({ receivable: recurring() });

    await harness.service.update('recurring-1', USER_ID, {
      amount: 5700,
      dueDate: '2026-09-06',
    } as any);

    expect(harness.receivable.amount).toBe(5700);
    expect(harness.receivable.dueDate).toEqual(
      new Date(Date.UTC(2026, 8, 6, 12)),
    );
    expect(harness.receivable.recurringIncomeRuleId).toBe('rule-1');
  });

  it('não permite excluir a ocorrência diretamente', async () => {
    const harness = buildHarness({ receivable: recurring() });

    await expect(
      harness.service.remove('recurring-1', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'RECURRING_INCOME_RECEIVABLE_DELETE_BLOCKED',
      }),
    });

    expect(harness.writes.receivableDeletes).toHaveLength(0);
  });

  it('mantém INCOME e recusa uma tentativa de classificar como OTHER', async () => {
    const harness = buildHarness({ receivable: recurring() });

    await expect(
      harness.service.update('recurring-1', USER_ID, {
        incomeClassification: 'OTHER',
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'RECURRING_INCOME_CLASSIFICATION_IMMUTABLE',
      }),
    });

    expect(harness.receivable.incomeClassification).toBe('INCOME');
    expect(harness.writes.receivableUpdates).toHaveLength(0);
  });
});

describe('Cobrança automática — exclusão direta', () => {
  it('recusa a exclusão', async () => {
    /**
     * Excluir a cobrança sem tocar a compra deixaria a transação com
     * `personId` preenchido e nenhuma cobrança — a automação quebrada.
     *
     * Pior: o código apagava a Transaction DE ORIGEM junto, uma cascata
     * invertida em que o filho remove o pai.
     */
    const harness = buildHarness({ receivable: automatic() });

    await expect(
      harness.service.remove('rec-auto', USER_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION',
      }),
    });

    expect(harness.writes.receivableDeletes).toHaveLength(0);
    expect(harness.writes.transactionDeletes).toHaveLength(0);
  });

  it('não apaga a compra de origem na tentativa recusada', async () => {
    const harness = buildHarness({ receivable: automatic() });

    await expect(harness.service.remove('rec-auto', USER_ID)).rejects.toThrow();

    expect(harness.prisma.transaction.delete).not.toHaveBeenCalled();
  });

  it('cobrança MANUAL continua excluível', async () => {
    const harness = buildHarness();

    await harness.service.remove('rec-1', USER_ID);

    expect(harness.writes.receivableDeletes).toEqual(['rec-1']);
  });
});

describe('Cobrança recebida — edição', () => {
  const received = () =>
    automatic({
      id: 'rec-1',
      transactionId: null,
      paymentTransactionId: 'tx-pay',
      isPaid: true,
      paidAt: new Date(Date.UTC(2026, 8, 5, 12)),
    });

  it('recusa alterar o valor', async () => {
    /**
     * A transação INCOME do recebimento não é atualizada por este caminho —
     * só é criada quando `paidAt` vira não-nulo. Alterar o valor aqui
     * divergiria da prova de recebimento para sempre.
     */
    const harness = buildHarness({ receivable: received() });

    await expect(
      harness.service.update('rec-1', USER_ID, { amount: 999 } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PAID_RECEIVABLE_EDIT_BLOCKED',
      }),
    });
  });

  it('a mensagem orienta desfazer o recebimento', async () => {
    const harness = buildHarness({ receivable: received() });

    await expect(
      harness.service.update('rec-1', USER_ID, { amount: 999 } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/[Dd]esfaça o recebimento/),
      }),
    });
  });

  it('permite DESFAZER o recebimento', async () => {
    // A guarda não pode trancar a própria saída: sem isso o registro ficaria
    // preso, incorrigível e irreversível.
    const harness = buildHarness({ receivable: received() });

    await harness.service.update('rec-1', USER_ID, { isPaid: false } as any);

    expect(harness.writes.receivableUpdates.length).toBeGreaterThan(0);
  });

  it('desfazer remove a transação de recebimento', async () => {
    const harness = buildHarness({ receivable: received() });

    await harness.service.update('rec-1', USER_ID, { isPaid: false } as any);

    expect(harness.writes.transactionDeletes).toContain('tx-pay');
  });
});

describe('Atomicidade do recebimento', () => {
  it('falha ao gravar o recebível desfaz a transação criada', async () => {
    /**
     * A transação INCOME e a marcação do recebível vivem no mesmo
     * `$transaction`. Se a segunda falha, a primeira não pode sobreviver —
     * senão haveria uma receita no extrato sem nada que a explique.
     *
     * O double propaga a exceção como o Postgres faria; o que se verifica é
     * que a operação inteira falha, não que ela grave pela metade.
     */
    const harness = buildHarness({ failReceivableUpdate: true });

    await expect(
      harness.service.update('rec-1', USER_ID, { isPaid: true } as any),
    ).rejects.toThrow(/falha ao gravar/);

    // Nenhuma escrita de recebível foi confirmada.
    expect(harness.writes.receivableUpdates).toHaveLength(0);
  });

  it('o recebimento roda numa única transação de banco', async () => {
    const harness = buildHarness();

    await harness.service.update('rec-1', USER_ID, { isPaid: true } as any);

    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('Concorrência e idempotência do recebimento', () => {
  it('retry após o settlement não cria outra Transaction', async () => {
    const harness = buildHarness();
    const payload = { isPaid: true, paymentDate: '2026-09-05' } as any;

    await harness.service.update('rec-1', USER_ID, payload);
    await harness.service.update('rec-1', USER_ID, payload);

    expect(harness.writes.transactionCreates).toHaveLength(1);
    expect(harness.receivable.isPaid).toBe(true);
    expect(harness.receivable.paymentTransactionId).toBe('tx-new');
  });

  it('duas promises simultâneas criam uma única Transaction', async () => {
    const harness = buildHarness({ claimBarrier: true });
    const payload = { isPaid: true, paymentDate: '2026-09-05' } as any;

    await Promise.all([
      harness.service.update('rec-1', USER_ID, payload),
      harness.service.update('rec-1', USER_ID, payload),
    ]);

    expect(harness.writes.transactionCreates).toHaveLength(1);
    expect(harness.receivable.isPaid).toBe(true);
    expect(harness.receivable.paymentTransactionId).toBe('tx-new');
  });

  it('com bancos diferentes, somente o request vencedor persiste', async () => {
    const harness = buildHarness({ claimBarrier: true });
    harness.prisma.bank.findUnique.mockImplementation(async ({ where }: any) =>
      makeBank({ id: where.id, isSystem: false }),
    );

    await Promise.all([
      harness.service.update('rec-1', USER_ID, {
        isPaid: true,
        paymentDate: '2026-09-05',
        paymentBankId: 'bank-a',
        paymentType: 'PIX',
      } as any),
      harness.service.update('rec-1', USER_ID, {
        isPaid: true,
        paymentDate: '2026-09-05',
        paymentBankId: 'bank-b',
        paymentType: 'PIX',
      } as any),
    ]);

    expect(harness.writes.transactionCreates).toHaveLength(1);
    expect(['bank-a', 'bank-b']).toContain(
      harness.writes.transactionCreates[0].bankId,
    );
  });

  it('falha na Transaction faz rollback da reivindicação inteira', async () => {
    const harness = buildHarness();
    harness.prisma.transaction.create.mockRejectedValueOnce(
      new Error('falha ao criar a receita'),
    );

    await expect(
      harness.service.update('rec-1', USER_ID, { isPaid: true } as any),
    ).rejects.toThrow(/falha ao criar/);

    expect(harness.receivable.isPaid).toBe(false);
    expect(harness.receivable.paidAt).toBeNull();
    expect(harness.receivable.paymentTransactionId).toBeNull();
    expect(harness.writes.transactionCreates).toHaveLength(0);
  });

  it('não fabrica Transaction para Receivable legado pago sem comprovante', async () => {
    const harness = buildHarness({
      receivable: {
        ...automatic({ id: 'legacy', transactionId: null }),
        isPaid: true,
        paidAt: null,
        paymentTransactionId: null,
      },
    });

    await harness.service.update('legacy', USER_ID, { isPaid: true } as any);

    expect(harness.writes.transactionCreates).toHaveLength(0);
    expect(harness.receivable.isPaid).toBe(true);
    expect(harness.receivable.paymentTransactionId).toBeNull();
  });

  it('preserva settlement → reversal → settlement', async () => {
    const harness = buildHarness({
      receivable: {
        ...automatic({ id: 'rec-1', transactionId: null }),
        isPaid: true,
        paidAt: new Date(Date.UTC(2026, 8, 5, 12)),
        paymentTransactionId: 'tx-pay',
      },
    });

    await harness.service.update('rec-1', USER_ID, { isPaid: false } as any);
    await harness.service.update('rec-1', USER_ID, { isPaid: true } as any);

    expect(harness.writes.transactionDeletes).toContain('tx-pay');
    expect(harness.writes.transactionCreates).toHaveLength(1);
    expect(harness.receivable.isPaid).toBe(true);
    expect(harness.receivable.paymentTransactionId).toBe('tx-new');
  });

  it('mantém isolamento por usuário', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.update('rec-1', 'outro-usuario', { isPaid: true } as any),
    ).rejects.toThrow(/Recebível não encontrado/);

    expect(harness.writes.transactionCreates).toHaveLength(0);
    expect(harness.receivable.isPaid).toBe(false);
  });
});
