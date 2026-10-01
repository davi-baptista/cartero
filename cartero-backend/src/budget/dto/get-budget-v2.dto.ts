import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BudgetV2PeriodPreset } from '../budget-v2.types';

export class GetBudgetV2Dto {
  @IsOptional()
  @IsEnum(BudgetV2PeriodPreset)
  preset: BudgetV2PeriodPreset = BudgetV2PeriodPreset.THIS_MONTH;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  year?: number;
}
