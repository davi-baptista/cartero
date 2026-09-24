import { Module } from '@nestjs/common';
import { RecurringIncomeController } from './recurring-income.controller';
import { RecurringIncomeService } from './recurring-income.service';

@Module({
  controllers: [RecurringIncomeController],
  providers: [RecurringIncomeService],
  exports: [RecurringIncomeService],
})
export class RecurringIncomeModule {}
