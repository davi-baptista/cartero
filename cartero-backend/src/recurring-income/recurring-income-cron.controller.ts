import {
  Controller,
  HttpCode,
  InternalServerErrorException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CronSecretGuard } from 'src/auth/cron-secret.guard';
import { RecurringIncomeJobService } from './recurring-income-job.service';

/** One global authority: the external Cron Job invokes this internal command. */
@Controller('recurring-incomes')
export class RecurringIncomeCronController {
  constructor(private readonly job: RecurringIncomeJobService) {}

  @Post('run-all')
  @HttpCode(200)
  @UseGuards(CronSecretGuard)
  async runAll() {
    const result = await this.job.run();
    if (result.status === 'partial-failure') {
      throw new InternalServerErrorException({
        message: 'Recurring reconciliation finished with failures',
        code: 'RECURRING_INCOME_PARTIAL_FAILURE',
        summary: result,
      });
    }
    return result;
  }
}
