import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { CronSecretGuard } from 'src/auth/cron-secret.guard';
import { RecurringIncomeCronController } from './recurring-income-cron.controller';

describe('RecurringIncomeCronController', () => {
  it('exposes only a POST command protected by the shared cron secret', () => {
    const route = RecurringIncomeCronController.prototype.runAll;
    expect(Reflect.getMetadata(PATH_METADATA, route)).toBe('run-all');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, route)).toBe(200);
    expect(Reflect.getMetadata(GUARDS_METADATA, route)).toContain(
      CronSecretGuard,
    );
  });

  it('returns a completed or skipped job without treating a held lock as failure', async () => {
    const job = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ status: 'completed' })
        .mockResolvedValueOnce({
          status: 'skipped',
          reason: 'already-running',
        }),
    };
    const controller = new RecurringIncomeCronController(job as any);

    await expect(controller.runAll()).resolves.toEqual({ status: 'completed' });
    await expect(controller.runAll()).resolves.toEqual({
      status: 'skipped',
      reason: 'already-running',
    });
  });

  it('returns a retryable 500 with the sanitized aggregate on partial failure', async () => {
    const job = {
      run: vi
        .fn()
        .mockResolvedValue({ status: 'partial-failure', usersFailed: 1 }),
    };
    const controller = new RecurringIncomeCronController(job as any);

    await expect(controller.runAll()).rejects.toMatchObject({
      response: {
        code: 'RECURRING_INCOME_PARTIAL_FAILURE',
        summary: { status: 'partial-failure', usersFailed: 1 },
      },
    });
  });
});
