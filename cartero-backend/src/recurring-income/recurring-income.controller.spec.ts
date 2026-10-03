import { describe, expect, it, vi } from 'vitest';
import { RecurringIncomeController } from './recurring-income.controller';

describe('RecurringIncomeController explicit reconciliation', () => {
  it('uses the authenticated user and accepts only the requested period', async () => {
    const service = {
      reconcileForUserPeriod: vi
        .fn()
        .mockResolvedValue({ month: '2026-10', created: 1 }),
    };
    const controller = new RecurringIncomeController(service as any);
    await expect(
      controller.reconcile({ id: 'authenticated-user' } as any, {
        month: 10,
        year: 2026,
      }),
    ).resolves.toEqual({ month: '2026-10', created: 1 });
    expect(service.reconcileForUserPeriod).toHaveBeenCalledWith(
      'authenticated-user',
      10,
      2026,
    );
  });
});
