import { describe, expect, it, vi } from 'vitest';
import { ReceivablesService } from './receivables.service';

describe('Receivable income classification', () => {
  function build() {
    const created: any[] = [];
    const prisma: any = {
      $transaction: vi.fn(async (callback: any) =>
        callback({
          receivable: {
            create: vi.fn(async ({ data }: any) => {
              const row = { id: `r-${created.length + 1}`, ...data };
              created.push(row);
              return row;
            }),
            update: vi.fn(async ({ data }: any) => data),
          },
        }),
      ),
    };
    const validation: any = { validatePerson: vi.fn() };
    return { service: new ReceivablesService(prisma, validation), created };
  }

  it('defaults manual receivables to OTHER', async () => {
    const harness = build();

    await harness.service.create('user-1', {
      title: 'Reembolso',
      debtorName: 'Pessoa',
      amount: 100,
      occurredAt: '2026-09-01',
      dueDate: '2026-09-05',
    });

    expect(harness.created[0].incomeClassification).toBe('OTHER');
    expect(harness.created[0].recurringIncomeRuleId).toBeUndefined();
    expect(harness.created[0].recurringMonth).toBeUndefined();
  });

  it('allows a manual receivable to be explicitly INCOME', async () => {
    const harness = build();

    await harness.service.create('user-1', {
      title: 'Freelance',
      debtorName: 'Cliente',
      amount: 250,
      incomeClassification: 'INCOME',
      occurredAt: '2026-09-01',
      dueDate: '2026-09-05',
    });

    expect(harness.created[0].incomeClassification).toBe('INCOME');
  });
});
