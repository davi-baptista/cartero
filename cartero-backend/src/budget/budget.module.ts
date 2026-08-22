import { Module } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { BudgetController } from './budget.controller';
import { CommonModule } from 'src/common/common.module';
import { SalaryModule } from 'src/salary/salary.module';

@Module({
  imports: [CommonModule, SalaryModule],
  providers: [BudgetService],
  controllers: [BudgetController],
})
export class BudgetModule {}
