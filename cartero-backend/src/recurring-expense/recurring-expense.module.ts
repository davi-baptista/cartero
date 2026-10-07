import { Module } from '@nestjs/common';
import { CommonModule } from 'src/common/common.module';
import { CronSecretGuard } from 'src/auth/cron-secret.guard';
import { RecurringExpenseController } from './recurring-expense.controller';
import { RecurringExpenseService } from './recurring-expense.service';

@Module({
  imports: [CommonModule],
  controllers: [RecurringExpenseController],
  providers: [RecurringExpenseService, CronSecretGuard],
  exports: [RecurringExpenseService],
})
export class RecurringExpenseModule {}
