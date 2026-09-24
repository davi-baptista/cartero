import { Module } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { BudgetController } from './budget.controller';
import { CommonModule } from 'src/common/common.module';
import { SalaryModule } from 'src/salary/salary.module';
import { BudgetV2Service } from './budget-v2.service';
import { BudgetV2DrilldownService } from './budget-v2-drilldown.service';
import { RecurringIncomeModule } from 'src/recurring-income/recurring-income.module';

@Module({
  imports: [CommonModule, SalaryModule, RecurringIncomeModule],
  providers: [BudgetService, BudgetV2Service, BudgetV2DrilldownService],
  controllers: [BudgetController],
})
export class BudgetModule {}
