import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  USER_ID,
  makeBank,
  makeInvoice,
  makeTransaction,
  money,
  utcDate,
} from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Editar a transação que comprova uma quitação (Fase 8A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `assertNotAPaymentTransaction` existia e funcionava — mas era chamada só em
 * `remove`. O comentário dela falava de "apagada", e a edição ficou de fora.
 *
 * O dano é o mesmo: uma dívida de R$ 500 marcada como paga podia ter o
 * comprovante alterado para R$ 100 pelo extrato, e a dívida continuava
 * `isPaid = true` apontando para uma prova que já não corresponde.
 *
 * Só os campos FINANCEIROS são barrados. Título, descrição e categoria passam
 * — corrigir a categoria de um pagamento não contradiz o pagamento, e é a
 * mesma política já adotada para recebível pago e fatura fechada.
 */

interface Setup {
  /** `true` quando a transação é comprovante de uma dívida paga. */
  linkedToDebt?: boolean;
  /** `true` quando é comprovante de uma cobrança recebida. */
  linkedToReceivable?: boolean;
}

function buildHarness(setup: Setup = {}) {
  const transaction = makeTransaction({
    id: 'tx-pay',
    bankId: 'bank-1',
    amount: money(500),
    date: utcDate(2026, 8, 5),
    invoiceId: null,
    type: 'PIX',
  });

  const writes: any[] = [];

  const prisma: any = {
    bank: {
      findUnique: vi.fn(async () => makeBank()),
      findFirst: vi.fn(async () => makeBank()),
    },
    transaction: {
      findUnique: vi.fn(async () => transaction),
      findMany: vi.fn(async () => [transaction]),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ data }: any) => {
        writes.push(data);
        return { ...transaction, ...data };
      }),
    },
    debt: {
      findFirst: vi.fn(async () =>
        setup.linkedToDebt ? { id: 'debt-1' } : null,
      ),
    },
    receivable: {
      findUnique: vi.fn(async () => null),
      /**
       * As duas guardas consultam `receivable.findFirst` com filtros
       * diferentes, e confundi-las escondia o que este arquivo testa:
       *
       *   `transactionId`        → a compra que ORIGINOU a cobrança
       *   `paymentTransactionId` → o comprovante do RECEBIMENTO
       *
       * O double responde pelo filtro, para que a guarda de recebível pago
       * (`RECEIVABLE_ALREADY_PAID`) não capture o caso de comprovante.
       */
      findFirst: vi.fn(async ({ where }: any) => {
        if (where?.paymentTransactionId) {
          return setup.linkedToReceivable ? { id: 'rec-1' } : null;
        }
        return null;
      }),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    invoice: {
      findUnique: vi.fn(async () => makeInvoice()),
      findUniqueOrThrow: vi.fn(async () => makeInvoice()),
      findFirst: vi.fn(async () => makeInvoice()),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => makeInvoice(data)),
      update: vi.fn(),
    },
    category: { findUnique: vi.fn(async () => ({ id: 'cat-1' })) },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

  const validation = new EntityValidationService(prisma as PrismaService);
  (validation as any).validateCategory = vi.fn(async () => ({
    id: 'cat-1',
    userId: USER_ID,
  }));
  (validation as any).validateTransaction = vi.fn(async () => transaction);

  return {
    service: new TransactionsService(prisma as PrismaService, validation),
    prisma,
    writes,
  };
}

describe('Comprovante de dívida paga — campos financeiros', () => {
  it.each([
    ['valor', { amount: 100 }],
    ['data', { date: '2026-09-01' }],
    ['banco', { bankId: 'bank-outro' }],
    ['forma', { type: 'BOLETO' }],
  ])('recusa alterar o %s', async (_label, dto) => {
    const harness = buildHarness({ linkedToDebt: true });

    await expect(
      harness.service.update('tx-pay', USER_ID, dto as any, 'ONE'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PAYMENT_TRANSACTION_LINKED',
      }),
    });

    expect(harness.writes).toHaveLength(0);
  });

  it('a mensagem orienta desmarcar a dívida', async () => {
    const harness = buildHarness({ linkedToDebt: true });

    await expect(
      harness.service.update('tx-pay', USER_ID, { amount: 100 } as any, 'ONE'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/[Dd]esmarque a dívida/),
      }),
    });
  });

  it('a mensagem fala de ALTERAR, não de remover', async () => {
    // O verbo muda porque a saída é diferente: quem edita precisa desmarcar,
    // corrigir e marcar de novo.
    const harness = buildHarness({ linkedToDebt: true });

    await expect(
      harness.service.update('tx-pay', USER_ID, { amount: 100 } as any, 'ONE'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/dados financeiros/),
      }),
    });
  });
});

describe('Comprovante de recebimento — campos financeiros', () => {
  it('recusa alterar o valor', async () => {
    const harness = buildHarness({ linkedToReceivable: true });

    await expect(
      harness.service.update('tx-pay', USER_ID, { amount: 100 } as any, 'ONE'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PAYMENT_TRANSACTION_LINKED',
      }),
    });
  });

  it('a mensagem orienta desmarcar a cobrança', async () => {
    const harness = buildHarness({ linkedToReceivable: true });

    await expect(
      harness.service.update('tx-pay', USER_ID, { amount: 100 } as any, 'ONE'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/[Dd]esmarque a cobrança/),
      }),
    });
  });
});

describe('Comprovante — alterações descritivas permitidas', () => {
  it.each([
    ['título', { title: 'Aluguel de agosto' }],
    ['descrição', { description: 'pago por transferência' }],
  ])('permite alterar o %s', async (_label, dto) => {
    /**
     * Texto não contradiz o pagamento. Tornar a transação inteira read-only
     * impediria corrigir um título errado sem desfazer a quitação — atrito
     * sem ganho de integridade.
     */
    const harness = buildHarness({ linkedToDebt: true });

    await harness.service.update('tx-pay', USER_ID, dto as any, 'ONE');

    expect(harness.writes.length).toBeGreaterThan(0);
  });

  it('reenviar os mesmos valores financeiros não é bloqueado', async () => {
    // O formulário devolve o objeto inteiro; reenviar o que já está lá não é
    // alteração, e tratá-lo como tal impediria editar só a descrição.
    const harness = buildHarness({ linkedToDebt: true });

    await harness.service.update(
      'tx-pay',
      USER_ID,
      {
        amount: 500,
        type: 'PIX',
        bankId: 'bank-1',
        description: 'nota',
      } as any,
      'ONE',
    );

    expect(harness.writes.length).toBeGreaterThan(0);
  });
});

describe('Transação comum não é afetada', () => {
  it('sem vínculo de quitação, tudo continua editável', async () => {
    const harness = buildHarness();

    await harness.service.update(
      'tx-pay',
      USER_ID,
      { amount: 100 } as any,
      'ONE',
    );

    expect(harness.writes.length).toBeGreaterThan(0);
  });

  it('a guarda não é consultada quando nada financeiro muda', async () => {
    // Evita duas consultas por edição de descrição.
    const harness = buildHarness();

    await harness.service.update(
      'tx-pay',
      USER_ID,
      { description: 'nota' } as any,
      'ONE',
    );

    expect(harness.prisma.debt.findFirst).not.toHaveBeenCalled();
  });
});
