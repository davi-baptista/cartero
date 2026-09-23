import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { BudgetV2PeriodPreset } from '../budget-v2.types';
import { BudgetV2DrilldownBucket } from '../budget-v2-drilldown.types';

export const BUDGET_V2_DRILLDOWN_DEFAULT_LIMIT = 20;
export const BUDGET_V2_DRILLDOWN_MAX_LIMIT = 100;

export class GetBudgetV2DrilldownDto {
  @IsEnum(BudgetV2DrilldownBucket)
  bucket!: BudgetV2DrilldownBucket;

  @IsOptional()
  @IsEnum(BudgetV2PeriodPreset)
  preset?: BudgetV2PeriodPreset;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BUDGET_V2_DRILLDOWN_MAX_LIMIT)
  limit: number = BUDGET_V2_DRILLDOWN_DEFAULT_LIMIT;
}
