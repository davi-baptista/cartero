import { describe, expect, it, vi } from 'vitest';
import { DebtsService } from 'src/debts/debts.service';
import { ReceivablesService } from 'src/receivables/receivables.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Pagamento de dívida e recebimento em banco arquivado (Fase 6A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Marcar uma dívida como paga cria uma transação espelho no banco escolhido —
 * é movimentação nova, e portanto o banco arquivado tem de ser recusado.
 *
 * O teste existe porque a proteção aqui é indireta: vem de `validateBank`, não
 * de código nestes serviços. Se alguém adicionar um `allowArchived` por
 * engano ao ajustar outra coisa, é este teste que cai.
 */

const ARCHIVED = makeBank({
  id: 'bank-arch',
  name: 'Nubank',
  isArchived: true,
});
const ACTIVE = makeBank({ id: 'bank-active', name: 'Santander' });

function banksDouble() {
  return {
    findUnique: vi.fn(
      async ({ where }: any) =>
        [ACTIVE, ARCHIVED].find((bank) => bank.id === where.id) ?? null,
    ),
  };
}

describe('Pagar dívida com banco arquivado', () => {
  function buildDebts() {
    const transactionCreate = vi.fn();
    const prisma = {
      bank: banksDouble(),
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          createExpenseOnDebtPaid: true,
        })),
      },
      debt: {
        findUnique: vi.fn(async () => ({
          id: 'debt-1',
          userId: USER_ID,
          title: 'Empréstimo',
          amount: 200,
          isPaid: false,
          parentId: null,
          creditorName: 'Ana',
          personId: null,
          dueDate: new Date('2026-08-10'),
          paymentTransactionId: null,
        })),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        update: vi.fn(),
      },
      transaction: { create: transactionCreate },
      invoice: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    } as any;

    const validation = new EntityValidationService(
      prisma as unknown as PrismaService,
    );
    (validation as any).findOrCreateSystemCategory = vi.fn(async () => ({
      id: 'cat-sys',
    }));
    (validation as any).validatePerson = vi.fn(async () => ({
      id: 'p1',
      name: 'Ana',
    }));

    return {
      service: new DebtsService(prisma as unknown as PrismaService, validation),
      transactionCreate,
      prisma,
    };
  }

  it('recusa o pagamento quando o banco está arquivado', async () => {
    const harness = buildDebts();

    await expect(
      harness.service.update('debt-1', USER_ID, {
        isPaid: true,
        paymentBankId: ARCHIVED.id,
        paymentType: 'PIX',
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_ARCHIVED' }),
    });

    expect(harness.transactionCreate).not.toHaveBeenCalled();
    expect(harness.prisma.debt.update).not.toHaveBeenCalled();
  });

  it('a dívida não fica marcada como paga quando o banco é recusado', async () => {
    // Sem isso o usuário teria uma dívida paga sem transação que a comprove —
    // exatamente o isPaid órfão que a Fase 2B combateu.
    const harness = buildDebts();

    await expect(
      harness.service.update('debt-1', USER_ID, {
        isPaid: true,
        paymentBankId: ARCHIVED.id,
        paymentType: 'PIX',
      } as any),
    ).rejects.toThrow();

    expect(harness.prisma.debt.update).not.toHaveBeenCalled();
  });
});

describe('Receber recebível com banco arquivado', () => {
  function buildReceivables() {
    const transactionCreate = vi.fn();
    const prisma = {
      bank: banksDouble(),
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          createIncomeOnReceivablePaid: true,
        })),
      },
      receivable: {
        findUnique: vi.fn(async () => ({
          id: 'rec-1',
          userId: USER_ID,
          title: 'Ingresso',
          amount: 80,
          isPaid: false,
          parentId: null,
          debtorName: 'Eva',
          personId: null,
          dueDate: new Date('2026-08-10'),
          transactionId: null,
          paymentTransactionId: null,
        })),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        update: vi.fn(),
      },
      transaction: { create: transactionCreate },
      invoice: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    } as any;

    const validation = new EntityValidationService(
      prisma as unknown as PrismaService,
    );
    (validation as any).findOrCreateSystemCategory = vi.fn(async () => ({
      id: 'cat-sys',
    }));
    (validation as any).validatePerson = vi.fn(async () => ({
      id: 'p1',
      name: 'Eva',
    }));

    return {
      service: new ReceivablesService(
        prisma as unknown as PrismaService,
        validation,
      ),
      transactionCreate,
      prisma,
    };
  }

  it('recusa o recebimento quando o banco informado está arquivado', async () => {
    const harness = buildReceivables();

    await expect(
      harness.service.update('rec-1', USER_ID, {
        isPaid: true,
        paymentBankId: ARCHIVED.id,
        paymentType: 'PIX',
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_ARCHIVED' }),
    });

    expect(harness.transactionCreate).not.toHaveBeenCalled();
  });
});
