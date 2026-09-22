import { IsEnum, IsOptional } from 'class-validator';
import { BudgetV2PeriodPreset } from '../budget-v2.types';

export class GetBudgetV2Dto {
  @IsOptional()
  @IsEnum(BudgetV2PeriodPreset)
  preset: BudgetV2PeriodPreset = BudgetV2PeriodPreset.LAST_30_DAYS;
}
