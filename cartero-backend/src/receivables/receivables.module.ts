import { Module } from '@nestjs/common';
import { CommonModule } from 'src/common/common.module';
import { ReceivablesService } from './receivables.service';
import { ReceivablesController } from './receivables.controller';
import { RecurringIncomeModule } from 'src/recurring-income/recurring-income.module';

@Module({
  imports: [CommonModule, RecurringIncomeModule],
  providers: [ReceivablesService],
  exports: [ReceivablesService],
  controllers: [ReceivablesController],
})
export class ReceivablesModule {}
