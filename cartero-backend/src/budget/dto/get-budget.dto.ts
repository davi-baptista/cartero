import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class GetBudgetDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year: number;
}
