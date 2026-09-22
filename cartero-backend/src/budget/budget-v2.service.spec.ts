import { describe, expect, it, vi } from 'vitest';
import { BudgetV2Service } from './budget-v2.service';
import { BudgetV2PeriodPreset } from './budget-v2.types';

describe('BudgetV2Service', () => {
  it("uses the authenticated user's account timezone", async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async ({ where, select }: any) => {
          expect(where).toEqual({ id: 'user-a' });
          expect(select).toEqual({ timeZone: true });
          return { timeZone: 'Asia/Tokyo' };
        }),
      },
    } as any;

    const service = new BudgetV2Service(prisma);
    const period = await service.getPeriod(
      'user-a',
      BudgetV2PeriodPreset.ALL_TIME,
    );

    expect(period.timeZone).toBe('Asia/Tokyo');
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledOnce();
  });
});
