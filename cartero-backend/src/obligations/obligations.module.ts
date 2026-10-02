import { Module } from '@nestjs/common';
import { ObligationsController } from './obligations.controller';
import { ObligationsService } from './obligations.service';
import { RecurringIncomeModule } from 'src/recurring-income/recurring-income.module';

@Module({
  imports: [RecurringIncomeModule],
  controllers: [ObligationsController],
  providers: [ObligationsService],
})
export class ObligationsModule {}
