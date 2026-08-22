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
 * Transação e banco arquivado (Fase 6A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A política tem duas metades, e confundi-las seria fácil:
 *
 * 1. Banco arquivado não recebe movimento NOVO — criar ali é recusado.
 * 2. Arquivamento NÃO congela o que já existe — uma compra antiga num cartão
 *    encerrado continua editável, senão o histórico ficaria impossível de
 *    corrigir justamente onde mais provável ter erro.
 *
 * A condição que separa as duas é a TROCA de banco, não o estado do banco
 * atual. E `isArchived` não substitui as guardas de PAID/CLOSED/recebível
 * pago: essas continuam valendo por conta própria.
 */

const ARCHIVED = makeBank({
  id: 'bank-archived',
  name: 'Mercado Pago',
  isArchived: true,
});
const ACTIVE = makeBank({ id: 'bank-active', name: 'Santander' });

function buildHarness(options: {
  transaction?: ReturnType<typeof makeTransaction>;
  banks?: ReturnType<typeof makeBank>[];
}) {
  const banks = options.banks ?? [ACTIVE, ARCHIVED];
  const transaction =
    options.transaction ??
    makeTransaction({
      id: 'tx-1',
      bankId: ACTIVE.id,
      amount: money(100),
      date: utcDate(2026, 8, 5),
      invoiceId: 'inv-1',
    });

  const writes: any[] = [];

  const prisma = {
    bank: {
      findUnique: vi.fn(
        async ({ where }: any) =>
          banks.find((bank) => bank.id === where.id) ?? null,
      ),
      findFirst: vi.fn(
        async ({ where }: any) =>
          banks.find((bank) => bank.id === where.id) ?? null,
      ),
    },
    transaction: {
      findUnique: vi.fn(async () => transaction),
      findMany: vi.fn(async () => [transaction]),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        writes.push(data);
        return makeTransaction(data);
      }),
      update: vi.fn(async ({ data }: any) => {
        writes.push(data);
        return { ...transaction, ...data };
      }),
    },
    invoice: {
      findUnique: vi.fn(async () => makeInvoice({ id: 'inv-1' })),
      findUniqueOrThrow: vi.fn(async () => makeInvoice({ id: 'inv-1' })),
      findFirst: vi.fn(async () => makeInvoice({ id: 'inv-1' })),
      findMany: vi.fn(async () => [makeInvoice({ id: 'inv-1' })]),
      create: vi.fn(async ({ data }: any) => makeInvoice(data)),
      update: vi.fn(),
    },
    // A guarda de comprovante de quitação consulta os dois lados; sem eles o
    // harness estoura antes de exercitar o que o teste quer verificar.
    debt: {
      findFirst: vi.fn(async () => null),
    },
    receivable: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    category: { findUnique: vi.fn(async () => ({ id: 'cat-1' })) },
    $transaction: vi.fn(async (fn: any) => fn(prismaInner)),
  } as any;

  // O client interno da transação compartilha os mesmos doubles.
  const prismaInner = prisma;

  const validation = new EntityValidationService(
    prisma as unknown as PrismaService,
  );
  // Categoria e pessoa não são o objeto deste arquivo.
  (validation as any).validateCategory = vi.fn(async () => ({
    id: 'cat-1',
    userId: USER_ID,
  }));
  (validation as any).validateTransaction = vi.fn(async () => transaction);

  return {
    service: new TransactionsService(
      prisma as unknown as PrismaService,
      validation,
    ),
    prisma,
    writes,
    transaction,
  };
}

describe('Criar transação em banco arquivado', () => {
  it('recusa a criação', async () => {
    const harness = buildHarness({});

    await expect(
      harness.service.create(USER_ID, {
        bankId: ARCHIVED.id,
        categoryId: 'cat-1',
        type: 'PIX',
        title: 'Compra',
        amount: 50,
        date: '2026-08-20',
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_ARCHIVED' }),
    });

    expect(harness.prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('a prévia de criação recusa igual à criação', async () => {
    // Prévia que prometesse o que o save recusa seria pior que prévia nenhuma.
    const harness = buildHarness({});

    await expect(
      harness.service.previewCreate(USER_ID, {
        bankId: ARCHIVED.id,
        type: 'CREDIT_CARD',
        title: 'Compra',
        amount: 50,
        date: '2026-08-20',
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_ARCHIVED' }),
    });
  });

  it('criar em banco ativo continua funcionando', async () => {
    const harness = buildHarness({});

    await harness.service.create(USER_ID, {
      bankId: ACTIVE.id,
      categoryId: 'cat-1',
      type: 'PIX',
      title: 'Compra',
      amount: 50,
      date: '2026-08-20',
    } as any);

    expect(harness.prisma.transaction.create).toHaveBeenCalled();
  });
});

describe('Editar transação e banco arquivado', () => {
  it('recusa mover a transação PARA um banco arquivado', async () => {
    const harness = buildHarness({});

    await expect(
      harness.service.update(
        'tx-1',
        USER_ID,
        { bankId: ARCHIVED.id } as any,
        'ONE',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_ARCHIVED' }),
    });
  });

  it('permite editar a descrição de transação que já está em banco arquivado', async () => {
    // O caso que justifica não bloquear cegamente: corrigir um registro
    // histórico de um cartão encerrado.
    const harness = buildHarness({
      transaction: makeTransaction({
        id: 'tx-1',
        bankId: ARCHIVED.id,
        amount: money(100),
        date: utcDate(2026, 8, 5),
        invoiceId: 'inv-1',
      }),
    });

    await harness.service.update(
      'tx-1',
      USER_ID,
      { description: 'nota corrigida' } as any,
      'ONE',
    );

    expect(harness.prisma.transaction.update).toHaveBeenCalled();
  });

  it('permite reenviar o mesmo bankId arquivado sem que isso conte como troca', async () => {
    // O formulário devolve o banco atual no payload; isso não é mover.
    const harness = buildHarness({
      transaction: makeTransaction({
        id: 'tx-1',
        bankId: ARCHIVED.id,
        amount: money(100),
        date: utcDate(2026, 8, 5),
        invoiceId: 'inv-1',
      }),
    });

    await harness.service.update(
      'tx-1',
      USER_ID,
      { bankId: ARCHIVED.id, description: 'nota' } as any,
      'ONE',
    );

    expect(harness.prisma.transaction.update).toHaveBeenCalled();
  });

  it('permite mover de banco arquivado PARA um ativo', async () => {
    // Direção oposta: tirar o registro da conta encerrada é justamente o que
    // se quer poder fazer.
    const harness = buildHarness({
      transaction: makeTransaction({
        id: 'tx-1',
        bankId: ARCHIVED.id,
        amount: money(100),
        date: utcDate(2026, 8, 5),
        invoiceId: 'inv-1',
      }),
    });

    await harness.service.update(
      'tx-1',
      USER_ID,
      { bankId: ACTIVE.id } as any,
      'ONE',
    );

    expect(harness.prisma.transaction.update).toHaveBeenCalled();
  });
});
