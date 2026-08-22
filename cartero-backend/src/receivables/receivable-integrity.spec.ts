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

  const prisma: any = {
    receivable: {
      findUnique: vi.fn(async () => receivable),
      findMany: vi.fn(async () => [receivable]),
      update: vi.fn(async ({ data }: any) => {
        if (setup.failReceivableUpdate) {
          throw new Error('falha ao gravar o recebível');
        }
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
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

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
