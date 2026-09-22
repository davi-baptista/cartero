import { Module } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { BudgetController } from './budget.controller';
import { CommonModule } from 'src/common/common.module';
import { SalaryModule } from 'src/salary/salary.module';
import { BudgetV2Service } from './budget-v2.service';

@Module({
  imports: [CommonModule, SalaryModule],
  providers: [BudgetService, BudgetV2Service],
  controllers: [BudgetController],
})
export class BudgetModule {}
