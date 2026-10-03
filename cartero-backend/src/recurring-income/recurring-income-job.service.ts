import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { withPostgresSessionAdvisoryLock } from 'src/common/helpers/postgres-session-lock.helper';
import {
  RecurringIncomeService,
  RECURRING_INCOME_USER_BATCH_SIZE,
  type RecurringIncomeReconciliationSummary,
} from './recurring-income.service';

const JOB_LOCK_KEY = 'recurring-income-scheduler';

export type RecurringIncomeJobResult =
  | { status: 'skipped'; reason: 'already-running' }
  | ({
      status: 'completed' | 'partial-failure';
      durationMs: number;
    } & RecurringIncomeReconciliationSummary);

function safeErrorSummary(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `Prisma:${error.code}`;
  }
  return error instanceof Error ? error.name : 'UnknownError';
}

@Injectable()
export class RecurringIncomeJobService {
  private readonly logger = new Logger(RecurringIncomeJobService.name);

  constructor(
    private readonly recurringIncomeService: RecurringIncomeService,
  ) {}

  /** Called only by the authenticated external cron endpoint. */
  async run(now = new Date()): Promise<RecurringIncomeJobResult> {
    const startedAt = Date.now();
    let progress: RecurringIncomeReconciliationSummary | null = null;
    this.logger.log(JSON.stringify({ event: 'recurring-income-job-start' }));
    try {
      const locked = await withPostgresSessionAdvisoryLock(
        JOB_LOCK_KEY,
        (assertLockHeld) =>
          this.recurringIncomeService.ensureAll(
            now,
            RECURRING_INCOME_USER_BATCH_SIZE,
            assertLockHeld,
            (summary) => {
              progress = summary;
            },
          ),
      );
      if (!locked.acquired) {
        this.logger.warn(
          JSON.stringify({
            event: 'recurring-income-job-skipped',
            reason: 'another-instance-holds-lock',
            durationMs: Date.now() - startedAt,
          }),
        );
        return { status: 'skipped', reason: 'already-running' };
      }

      const result: RecurringIncomeJobResult = {
        status: locked.value.usersFailed > 0 ? 'partial-failure' : 'completed',
        durationMs: Date.now() - startedAt,
        ...locked.value,
      };
      this.logger.log(
        JSON.stringify({ event: 'recurring-income-job-finish', ...result }),
      );
      return result;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'recurring-income-job-failed',
          durationMs: Date.now() - startedAt,
          error: safeErrorSummary(error),
          ...(progress ?? {}),
        }),
      );
      throw error;
    }
  }
}
