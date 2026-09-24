import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { BudgetV2Service } from './budget-v2.service';
import { BudgetV2PeriodPreset } from './budget-v2.types';

describe('recurring income compatibility with existing Budget V2', () => {
  function buildHarness() {
    const state: { settled: boolean } = { settled: false };
    const ensureForUser = vi.fn(async () => undefined);
    const prisma: any = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          timeZone: 'America/Sao_Paulo',
        })),
      },
      transaction: {
        findMany: vi.fn(async () =>
          state.settled
            ? [
                {
                  type: 'INCOME',
                  amount: new Prisma.Decimal(500),
                  isRefund: false,
                  paymentDebt: null,
                  paymentReceivable: { userId: 'user-1' },
                },
              ]
            : [],
        ),
      },
      invoiceSettlement: { findMany: vi.fn(async () => []) },
      personSettlementGroup: { findMany: vi.fn(async () => []) },
      receivable: {
        findMany: vi.fn(async () =>
          state.settled
            ? []
            : [
                {
                  amount: new Prisma.Decimal(500),
                  dueDate: new Date('2026-09-20T12:00:00Z'),
                },
              ],
        ),
      },
      debt: { findMany: vi.fn(async () => []) },
      invoice: { findMany: vi.fn(async () => []) },
    };

    return {
      state,
      ensureForUser,
      service: new BudgetV2Service(prisma, { ensureForUser } as any),
    };
  }

  it('keeps expected income pending before settlement and realized after settlement', async () => {
    const harness = buildHarness();
    const now = new Date('2026-09-23T12:00:00Z');

    const before = await harness.service.getBudget(
      'user-1',
      BudgetV2PeriodPreset.LAST_30_DAYS,
      now,
    );
    expect(before.pending.inflow).toBe('500.00');
    expect(before.realized.inflow).toBe('0.00');

    harness.state.settled = true;
    const after = await harness.service.getBudget(
      'user-1',
      BudgetV2PeriodPreset.LAST_30_DAYS,
      now,
    );
    expect(after.pending.inflow).toBe('0.00');
    expect(after.realized.inflow).toBe('500.00');
    expect(harness.ensureForUser).toHaveBeenCalledTimes(2);
  });
});
