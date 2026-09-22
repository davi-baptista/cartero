import { describe, expect, it, vi } from 'vitest';
import { DebtsService } from 'src/debts/debts.service';
import { ReceivablesService } from 'src/receivables/receivables.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, money } from 'src/common/testing/fixtures';

const debt = (isPaid = true) => ({
  id: 'debt-1',
  userId: USER_ID,
  personId: 'person-1',
  parentId: null,
  paymentTransactionId: null,
  title: 'Debt',
  creditorName: 'Eva',
  amount: money(100),
  description: null,
  occurredAt: new Date('2026-08-01T12:00:00Z'),
  dueDate: new Date('2026-08-01T12:00:00Z'),
  isAlertEnabled: true,
  isPaid,
  paidAt: isPaid ? new Date('2026-08-10T12:00:00Z') : null,
});

const receivable = (isPaid = true) => ({
  id: 'receivable-1',
  userId: USER_ID,
  personId: 'person-1',
  parentId: null,
  transactionId: null,
  paymentTransactionId: null,
  title: 'Receivable',
  debtorName: 'Eva',
  amount: money(100),
  description: null,
  occurredAt: new Date('2026-08-01T12:00:00Z'),
  dueDate: new Date('2026-08-01T12:00:00Z'),
  isPaid,
  paidAt: isPaid ? new Date('2026-08-10T12:00:00Z') : null,
});

function harness(groupStatus: 'ACTIVE' | 'REVERSED' | null) {
  const membership = (kind: 'debt' | 'receivable', itemId: string) =>
    groupStatus === 'ACTIVE'
      ? {
          groupId: 'group-1',
          ...(kind === 'debt' ? { debtId: itemId } : { receivableId: itemId }),
        }
      : null;
  const d = debt();
  const r = receivable();
  const prisma: any = {
    debt: {
      findUnique: vi.fn(async () => d),
      findMany: vi.fn(async () => [d]),
      update: vi.fn(async ({ data }: any) => Object.assign(d, data)),
      delete: vi.fn(async () => d),
    },
    receivable: {
      findUnique: vi.fn(async () => r),
      findMany: vi.fn(async () => [r]),
      update: vi.fn(async ({ data }: any) => Object.assign(r, data)),
      delete: vi.fn(async () => r),
    },
    person: {
      findUnique: vi.fn(async () => ({
        id: 'person-1',
        userId: USER_ID,
        name: 'Eva',
      })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ timeZone: 'America/Sao_Paulo' })),
    },
    bank: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    category: { findFirst: vi.fn(), create: vi.fn() },
    transaction: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    invoice: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    personSettlementDebt: {
      findFirst: vi.fn(async ({ where }: any) =>
        membership('debt', where.debtId),
      ),
    },
    personSettlementReceivable: {
      findFirst: vi.fn(async ({ where }: any) =>
        membership('receivable', where.receivableId),
      ),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  const validation = new EntityValidationService(prisma as PrismaService);
  return {
    debtService: new DebtsService(prisma as PrismaService, validation),
    receivableService: new ReceivablesService(
      prisma as PrismaService,
      validation,
    ),
    prisma,
    d,
    r,
  };
}

describe('CM1C partial undo guard', () => {
  it.each([
    ['debt unmark', 'debt', 'unmark'],
    ['debt delete', 'debt', 'delete'],
    ['receivable unmark', 'receivable', 'unmark'],
    ['receivable delete', 'receivable', 'delete'],
  ])('%s is blocked for an ACTIVE group', async (_label, kind, action) => {
    const h = harness('ACTIVE');
    const promise =
      kind === 'debt'
        ? action === 'unmark'
          ? h.debtService.update('debt-1', USER_ID, { isPaid: false } as any)
          : h.debtService.remove('debt-1', USER_ID)
        : action === 'unmark'
          ? h.receivableService.update('receivable-1', USER_ID, {
              isPaid: false,
            } as any)
          : h.receivableService.remove('receivable-1', USER_ID);
    await expect(promise).rejects.toMatchObject({
      response: { code: 'PERSON_SETTLEMENT_GROUP_UNDO_REQUIRED' },
    });
    expect(kind === 'debt' ? h.d.isPaid : h.r.isPaid).toBe(true);
  });

  it('does not block historical REVERSED membership', async () => {
    const h = harness('REVERSED');
    await expect(
      h.debtService.update('debt-1', USER_ID, { isPaid: false } as any),
    ).resolves.toBeDefined();
    await expect(
      h.receivableService.update('receivable-1', USER_ID, {
        isPaid: false,
      } as any),
    ).resolves.toBeDefined();
    expect(h.d.isPaid).toBe(false);
    expect(h.r.isPaid).toBe(false);
  });

  it('preserves legacy reopen without a group', async () => {
    const h = harness(null);
    await expect(
      h.debtService.update('debt-1', USER_ID, { isPaid: false } as any),
    ).resolves.toBeDefined();
    await expect(
      h.receivableService.update('receivable-1', USER_ID, {
        isPaid: false,
      } as any),
    ).resolves.toBeDefined();
  });
});
