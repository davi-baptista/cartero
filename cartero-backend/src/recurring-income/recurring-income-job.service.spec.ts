import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withPostgresSessionAdvisoryLock } from 'src/common/helpers/postgres-session-lock.helper';
import { RecurringIncomeJobService } from './recurring-income-job.service';
import { RECURRING_INCOME_USER_BATCH_SIZE } from './recurring-income.service';

vi.mock('src/common/helpers/postgres-session-lock.helper', () => ({
  withPostgresSessionAdvisoryLock: vi.fn(),
}));

const lock = vi.mocked(withPostgresSessionAdvisoryLock);
const summary = {
  usersScanned: 3,
  usersSucceeded: 3,
  usersFailed: 0,
  rulesReconciled: 3,
  occurrencesAttempted: 3,
  occurrencesCreated: 2,
  occurrencesSkipped: 1,
  batchesProcessed: 1,
};

function harness() {
  const service = {
    ensureAll: vi.fn(async (..._args: unknown[]) => {
      void _args;
      return summary;
    }),
  };
  const expenseService = {
    ensureAll: vi.fn(async () => ({ usersScanned: 2, usersFailed: 0, rulesReconciled: 4, occurrencesCreated: 3 })),
  };
  return {
    service,
    expenseService,
    job: new RecurringIncomeJobService(service as any, expenseService as any),
  };
}

describe('RecurringIncomeJobService', () => {
  beforeEach(() => {
    lock.mockReset();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs start and finish with aggregate results', async () => {
    const { service, expenseService, job } = harness();
    lock.mockImplementation(async (_key, work) => ({
      acquired: true,
      value: await work(async () => undefined),
    }));

    const result = await job.run(new Date('2026-10-01T12:00:00Z'));

    expect(result).toMatchObject({ status: 'completed', ...summary });
    if (result.status !== 'completed') throw new Error('Expected completed job');
    expect(result.recurringExpenses).toMatchObject({ rulesReconciled: 4, occurrencesCreated: 3 });
    expect(expenseService.ensureAll).toHaveBeenCalledWith(new Date('2026-10-01T12:00:00Z'));
    expect(service.ensureAll).toHaveBeenCalledWith(
      new Date('2026-10-01T12:00:00Z'),
      RECURRING_INCOME_USER_BATCH_SIZE,
      expect.any(Function),
      expect.any(Function),
    );
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('recurring-income-job-start'),
    );
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('recurring-income-job-finish'),
    );
  });

  it('skips cleanly when another instance holds the global lock', async () => {
    const { service, job } = harness();
    lock.mockResolvedValue({ acquired: false });

    expect(await job.run()).toEqual({
      status: 'skipped',
      reason: 'already-running',
    });
    expect(service.ensureAll).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('another-instance-holds-lock'),
    );
  });

  it('reports partial failures to the HTTP layer', async () => {
    const { job } = harness();
    lock.mockImplementation(async (_key, work) => ({
      acquired: true,
      value: {
        ...((await work(async () => undefined)) as typeof summary),
        usersFailed: 1,
      },
    }));

    expect(await job.run()).toMatchObject({
      status: 'partial-failure',
      usersFailed: 1,
    });
  });

  it('logs infrastructure failure without exposing raw error text', async () => {
    const { job } = harness();
    lock.mockRejectedValue(new Error('secret account amount'));

    await expect(job.run()).rejects.toThrow('secret account amount');
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('recurring-income-job-failed'),
    );
    expect(
      JSON.stringify(vi.mocked(Logger.prototype.error).mock.calls),
    ).not.toContain('secret account amount');
  });

  it('includes completed batch counts when a later page fails', async () => {
    const { service, job } = harness();
    service.ensureAll.mockImplementation(async (...args: unknown[]) => {
      (args[3] as (value: typeof summary) => void)(summary);
      throw new Error('page unavailable');
    });
    lock.mockImplementation(async (_key, work) => ({
      acquired: true,
      value: await work(async () => undefined),
    }));

    await expect(job.run()).rejects.toThrow('page unavailable');
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('"usersScanned":3'),
    );
  });
});
