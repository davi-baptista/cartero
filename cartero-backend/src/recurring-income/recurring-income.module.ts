import { Module } from '@nestjs/common';
import { RecurringIncomeController } from './recurring-income.controller';
import { RecurringIncomeService } from './recurring-income.service';
import { RecurringIncomeCronController } from './recurring-income-cron.controller';
import { RecurringIncomeJobService } from './recurring-income-job.service';
import { CronSecretGuard } from 'src/auth/cron-secret.guard';
import { RecurringExpenseModule } from 'src/recurring-expense/recurring-expense.module';

@Module({
  imports: [RecurringExpenseModule],
  controllers: [RecurringIncomeController, RecurringIncomeCronController],
  providers: [
    RecurringIncomeService,
    RecurringIncomeJobService,
    CronSecretGuard,
  ],
  exports: [RecurringIncomeService],
})
export class RecurringIncomeModule {}
